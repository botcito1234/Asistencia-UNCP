/**
 * Acceso a las evidencias fotograficas.
 *
 * Ninguna foto se expone por URL publica ni predecible. Para verla hay que:
 *   1. estar autenticado,
 *   2. tener derecho sobre ella (el practicante solo ve las suyas),
 *   3. quedar registrado en la auditoria: leer una evidencia es una lectura
 *      sensible y se audita igual que una escritura.
 *
 * Adicionalmente se ofrecen enlaces firmados de vida corta para poder mostrar
 * la imagen en una etiqueta <img> del panel sin exponer el token de sesion en
 * la URL. La firma es HMAC sobre (id, expiracion, usuario).
 */
import type { UserRole } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';
import { config } from '../../config/env.js';
import { hmacHex, safeEquals } from '../../core/crypto.js';
import { evidenceStorage } from '../../infra/storage/evidence-storage.js';
import { leerEvidencia, verificarEvidenciaRemota } from './evidence-remote.service.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';

export interface EvidenceAccess {
  userId: string;
  role: UserRole;
  /** Id de practicante del solicitante, si lo es. */
  internId?: string | null;
}

export interface EvidenceContent {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  filename: string;
  integrityOk: boolean;
}

async function loadAndAuthorize(evidenceId: string, access: EvidenceAccess) {
  const evidence = await prisma.evidencePhoto.findUnique({
    where: { id: evidenceId },
    include: {
      intern: { select: { id: true, dni: true, siteId: true, firstNames: true, lastNames: true } },
      mark: { select: { id: true, type: true, serverTime: true, attendanceDayId: true } },
    },
  });
  if (!evidence) throw errors.notFound('Evidencia');

  // Un practicante solo puede ver sus propias fotografias.
  if (access.role === 'PRACTICANTE' && evidence.internId !== access.internId) {
    throw errors.forbidden('No tiene permiso para ver esta evidencia.');
  }

  return evidence;
}

export async function getEvidenceMetadata(evidenceId: string, access: EvidenceAccess) {
  const evidence = await loadAndAuthorize(evidenceId, access);
  return {
    id: evidence.id,
    kind: evidence.kind,
    status: evidence.status,
    mimeType: evidence.mimeType,
    sizeBytes: evidence.sizeBytes,
    width: evidence.width,
    height: evidence.height,
    sha256: evidence.sha256,
    capturedAt: evidence.capturedAt?.toISOString() ?? null,
    uploadedAt: evidence.uploadedAt.toISOString(),
    captureSource: evidence.captureSource,
    archived: Boolean(evidence.archivedAt),
    driveFileId: evidence.driveFileId,
    released: Boolean(evidence.releasedAt),
    intern: {
      id: evidence.intern.id,
      dni: evidence.intern.dni,
      fullName: evidence.intern.lastNames + ', ' + evidence.intern.firstNames,
    },
    mark: evidence.mark
      ? { id: evidence.mark.id, type: evidence.mark.type, serverTime: evidence.mark.serverTime.toISOString() }
      : null,
  };
}

export async function readEvidence(
  evidenceId: string,
  access: EvidenceAccess,
  context: AuditContext,
  options: { download?: boolean } = {},
): Promise<EvidenceContent> {
  const evidence = await loadAndAuthorize(evidenceId, access);

  if (evidence.releasedAt) {
    throw errors.conflict(
      'CONFLICTO',
      'La fotografía ya fue archivada y liberada del almacenamiento operativo. Consultela en el archivo histórico.',
    );
  }

  // La fotografia puede estar en disco o, si ya se subio y se libero la copia
  // local, en Drive. Se lee siempre por aqui para que la lectura quede
  // auditada, este donde este el binario.
  const buffer = await leerEvidencia(evidence);
  const { sha256Hex } = await import('../../core/crypto.js');
  const actualHash = sha256Hex(buffer);
  const integrityOk = actualHash === evidence.sha256;

  await recordAudit({
    ...context,
    actorUserId: access.userId,
    actorRole: access.role,
    action: options.download ? 'EVIDENCIA_DESCARGADA' : 'EVIDENCIA_CONSULTADA',
    entityType: 'EvidencePhoto',
    entityId: evidence.id,
    after: { internId: evidence.internId, integrityOk },
  });

  const ext = evidence.mimeType === 'image/png' ? 'png' : evidence.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const filename =
    'evidencia_' + evidence.intern.dni + '_' + evidence.uploadedAt.toISOString().slice(0, 10) + '.' + ext;

  return {
    buffer,
    mimeType: evidence.mimeType,
    sizeBytes: buffer.length,
    sha256: actualHash,
    filename,
    integrityOk,
  };
}

// ---------------------------------------------------------------------------
// Enlaces firmados de vida corta
// ---------------------------------------------------------------------------

export function signEvidenceUrl(evidenceId: string, userId: string): { url: string; expiresAt: string } {
  const expiresAt = Date.now() + config.EVIDENCE_URL_TTL_MINUTES * 60_000;
  const signature = buildSignature(evidenceId, userId, expiresAt);
  const url =
    '/api/v1/evidencias/' + evidenceId + '/imagen?exp=' + expiresAt + '&uid=' + userId + '&sig=' + signature;
  return { url, expiresAt: new Date(expiresAt).toISOString() };
}

export function verifyEvidenceSignature(
  evidenceId: string,
  userId: string,
  expiresAt: number,
  signature: string,
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = buildSignature(evidenceId, userId, expiresAt);
  return safeEquals(expected, signature);
}

function buildSignature(evidenceId: string, userId: string, expiresAt: number): string {
  return hmacHex(config.JWT_SECRET, [evidenceId, userId, String(expiresAt)].join('|'));
}

// ---------------------------------------------------------------------------
// Verificacion de integridad del conjunto
// ---------------------------------------------------------------------------

export interface IntegrityReport {
  revisadas: number;
  integras: number;
  alteradas: string[];
  faltantes: string[];
}

/**
 * Recorre las evidencias activas de un periodo y compara el hash almacenado con
 * el del archivo en disco. Se ejecuta antes de archivar: nunca se sube ni se
 * libera nada sin comprobar integridad.
 */
export async function verifyPeriodIntegrity(from: Date, to: Date, siteId?: string): Promise<IntegrityReport> {
  const evidences = await prisma.evidencePhoto.findMany({
    where: {
      status: 'ACTIVA',
      releasedAt: null,
      uploadedAt: { gte: from, lte: to },
      ...(siteId ? { intern: { siteId } } : {}),
    },
    select: {
      id: true,
      storageKey: true,
      sha256: true,
      sizeBytes: true,
      remoteFileId: true,
      remoteMd5: true,
      localReleasedAt: true,
    },
  });

  const report: IntegrityReport = { revisadas: evidences.length, integras: 0, alteradas: [], faltantes: [] };

  for (const e of evidences) {
    if (await evidenceStorage.exists(e.storageKey)) {
      if (await evidenceStorage.verifyIntegrity(e.storageKey, e.sha256)) report.integras++;
      else report.alteradas.push(e.id);
      continue;
    }

    // Sin copia local: se comprueba contra Drive por MD5, sin descargar el
    // binario. Descargar miles de fotografias para verificarlas seria lento y
    // no diria nada que el MD5 no diga.
    if (e.remoteFileId && (await verificarEvidenciaRemota(e))) {
      report.integras++;
      continue;
    }

    report.faltantes.push(e.id);
  }

  return report;
}
