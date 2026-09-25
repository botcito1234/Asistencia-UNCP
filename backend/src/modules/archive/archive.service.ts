/**
 * Archivado historico y liberacion de almacenamiento.
 *
 * Secuencia obligatoria (no se puede saltar ningun paso):
 *   1. GENERANDO   - se arma el paquete: Excel + PDF + metadata.json + fotos.
 *   2. (integridad)- se verifica el hash de cada foto contra el registrado.
 *   3. SUBIENDO    - se sube el paquete a Google Drive.
 *   4. VERIFICANDO - se relee desde Drive y se compara tamano y checksum.
 *   5. COMPLETADO  - se guarda el id de Drive en la base de datos.
 *   6. LIBERADO    - solo entonces, y solo si se pidio, se borran los binarios
 *                    locales. Los metadatos NUNCA se borran.
 *
 * Si Drive no esta configurado o falla, el paquete queda generado y verificado
 * en disco y el lote se marca como PENDIENTE o FALLIDO. Jamas se libera nada.
 */
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ArchiveStatus } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { config } from '../../config/env.js';
import { logger } from '../../core/logger.js';
import { errors } from '../../core/errors.js';
import { sha256Hex } from '../../core/crypto.js';
import { evidenceStorage } from '../../infra/storage/evidence-storage.js';
import { leerEvidencia, verificarEvidenciaRemota } from '../evidence/evidence-remote.service.js';
import { dateOnlyValue, startOfMonthString, endOfMonthString, addMonthsToDateString, businessDateString, startOfLocalDay, endOfLocalDay } from '../../core/time.js';
import { buildReport } from '../reports/report.data.js';
import { generateExcel } from '../reports/excel.generator.js';
import { generatePdf } from '../reports/pdf.generator.js';
import { isDriveEnabled, ensureArchivePath, uploadFile, verifyUpload } from '../../infra/drive/drive.client.js';
import { recordSecurityEvent } from '../security/security-event.service.js';
import { notify } from '../notifications/notification.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { getSettings } from '../settings/settings.service.js';

export interface ArchiveRequest {
  siteId: string;
  year: number;
  month: number;
  /** Libera los binarios locales tras verificar la subida. */
  release?: boolean;
  actorUserId?: string | null;
}

export interface ArchiveResult {
  batchId: string;
  status: ArchiveStatus;
  siteName: string;
  period: string;
  attendanceDays: number;
  marks: number;
  photos: number;
  events: number;
  packageBytes: number;
  packageSha256: string;
  localPath: string;
  driveFileId: string | null;
  driveWebLink: string | null;
  released: boolean;
  integrity: { revisadas: number; integras: number; alteradas: string[]; faltantes: string[] };
  warnings: string[];
}

export async function archivePeriod(request: ArchiveRequest): Promise<ArchiveResult> {
  const site = await prisma.site.findUnique({ where: { id: request.siteId } });
  if (!site) throw errors.notFound('Sede');

  const from = startOfMonthString(request.year, request.month);
  const to = endOfMonthString(request.year, request.month);
  const period = request.year + '-' + String(request.month).padStart(2, '0');
  const warnings: string[] = [];

  const batch = await prisma.archiveBatch.upsert({
    where: { uq_archive_site_period: { siteId: site.id, year: request.year, month: request.month } },
    create: {
      siteId: site.id,
      year: request.year,
      month: request.month,
      periodStart: dateOnlyValue(from),
      periodEnd: dateOnlyValue(to),
      status: 'GENERANDO',
      startedAt: new Date(),
    },
    update: { status: 'GENERANDO', startedAt: new Date(), lastError: null, attempts: { increment: 1 } },
  });

  if (batch.releasedAt) {
    throw errors.conflict('CONFLICTO', 'Este periodo ya fue archivado y liberado el ' + batch.releasedAt.toISOString() + '.');
  }

  try {
    // --- 1. Datos del periodo ---------------------------------------------
    const days = await prisma.attendanceDay.findMany({
      where: { siteId: site.id, businessDate: { gte: dateOnlyValue(from), lte: dateOnlyValue(to) } },
      include: {
        intern: { select: { id: true, dni: true, firstNames: true, lastNames: true, areaGroup: true } },
        marks: { include: { evidence: true } },
        regularizations: true,
      },
      orderBy: { businessDate: 'asc' },
    });

    const events = await prisma.securityEvent.findMany({
      where: {
        siteId: site.id,
        createdAt: { gte: startOfLocalDay(from, site.timezone), lte: endOfLocalDay(to, site.timezone) },
      },
      orderBy: { createdAt: 'asc' },
    });

    const evidences = days.flatMap((d) => d.marks.map((m) => m.evidence)).filter((e) => e !== null);

    // --- 2. Verificacion de integridad ANTES de empacar --------------------
    const integrity = { revisadas: evidences.length, integras: 0, alteradas: [] as string[], faltantes: [] as string[] };
    const usableEvidences: typeof evidences = [];

    for (const e of evidences) {
      if (e.releasedAt) continue; // ya liberada en un archivado anterior

      if (await evidenceStorage.exists(e.storageKey)) {
        if (await evidenceStorage.verifyIntegrity(e.storageKey, e.sha256)) {
          integrity.integras++;
          usableEvidences.push(e);
        } else {
          integrity.alteradas.push(e.id);
          usableEvidences.push(e); // se archiva igual, marcada como alterada
        }
        continue;
      }

      // Sin copia local: con almacenamiento remoto activo la fotografia vive en
      // Drive. Se comprueba por MD5 y, si esta bien, se traera al empaquetar.
      if (e.remoteFileId && (await verificarEvidenciaRemota(e))) {
        integrity.integras++;
        usableEvidences.push(e);
        continue;
      }

      integrity.faltantes.push(e.id);
    }

    if (integrity.alteradas.length > 0) {
      warnings.push(integrity.alteradas.length + ' fotografía(s) no coinciden con su hash registrado.');
      await recordSecurityEvent({
        type: 'EVIDENCIA_INVALIDA',
        severity: 'CRITICO',
        message:
          'Se detectaron ' + integrity.alteradas.length + ' evidencia(s) alteradas al archivar el periodo ' + period + '.',
        siteId: site.id,
        details: { batchId: batch.id, evidencias: integrity.alteradas.slice(0, 50) },
      });
    }
    if (integrity.faltantes.length > 0) {
      warnings.push(integrity.faltantes.length + ' fotografía(s) no se encontraron en el almacenamiento.');
    }

    // --- 3. Reportes del periodo ------------------------------------------
    const reportData = await buildReport({ kind: 'sede', from, to, siteId: site.id });
    const [excel, pdf] = await Promise.all([generateExcel(reportData), generatePdf(reportData)]);

    // --- 4. metadata.json --------------------------------------------------
    const metadata = {
      generadoPor: config.APP_NAME,
      generadoEn: new Date().toISOString(),
      sede: { id: site.id, codigo: site.code, nombre: site.name, direccion: site.address, timezone: site.timezone },
      periodo: { anio: request.year, mes: request.month, desde: from, hasta: to },
      totales: {
        jornadas: days.length,
        marcaciones: days.reduce((a, d) => a + d.marks.length, 0),
        fotografias: usableEvidences.length,
        eventosSeguridad: events.length,
        regularizaciones: days.reduce((a, d) => a + d.regularizations.length, 0),
      },
      integridad: integrity,
      jornadas: days.map((d) => ({
        id: d.id,
        fecha: d.businessDate.toISOString().slice(0, 10),
        practicante: { dni: d.intern.dni, nombres: d.intern.firstNames, apellidos: d.intern.lastNames, area: d.intern.areaGroup },
        horaProgramada: d.scheduledStartMinute,
        estado: d.status,
        puntualidad: d.punctuality,
        minutosTardanza: d.lateMinutes,
        salidaPendiente: d.pendingExit,
        regularizado: d.regularized,
        marcaciones: d.marks.map((m) => ({
          id: m.id,
          tipo: m.type,
          horaServidor: m.serverTime.toISOString(),
          latitud: Number(m.latitude),
          longitud: Number(m.longitude),
          precisionM: Number(m.accuracyMeters),
          distanciaM: Number(m.distanceMeters),
          ubicacionSimulada: m.mockLocationReported,
          evidencia: m.evidence
            ? { id: m.evidence.id, archivo: archivePhotoName(m.evidence.id, d.intern.dni, m.type, m.serverTime, m.evidence.mimeType), sha256: m.evidence.sha256 }
            : null,
        })),
        regularizaciones: d.regularizations.map((r) => ({
          campo: r.field,
          valorAnterior: r.oldValue,
          valorNuevo: r.newValue,
          motivo: r.reason,
          fecha: r.createdAt.toISOString(),
        })),
      })),
      eventosSeguridad: events.map((e) => ({
        id: e.id,
        tipo: e.type,
        severidad: e.severity,
        mensaje: e.message,
        fecha: e.createdAt.toISOString(),
        distanciaM: e.distanceMeters !== null ? Number(e.distanceMeters) : null,
        precisionM: e.accuracyMeters !== null ? Number(e.accuracyMeters) : null,
        atendido: Boolean(e.acknowledgedAt),
      })),
    };

    // --- 5. Empaquetado ZIP -------------------------------------------------
    const outDir = path.resolve(config.STORAGE_ROOT, 'archivos', sanitize(site.code), String(request.year));
    await mkdir(outDir, { recursive: true });
    const zipName = 'asistencias_' + sanitize(site.code) + '_' + period + '.zip';
    const zipPath = path.join(outDir, zipName);

    const evidenceIndex = new Map<string, { name: string }>();
    for (const d of days) {
      for (const m of d.marks) {
        if (m.evidence) {
          evidenceIndex.set(m.evidence.id, {
            name: archivePhotoName(m.evidence.id, d.intern.dni, m.type, m.serverTime, m.evidence.mimeType),
          });
        }
      }
    }

    // El paquete debe ser autocontenido: lo que ya no esta en disco se descarga
    // de Drive para incluirlo, y si no se puede, se anota en las advertencias.
    const evidencesParaZip = [];
    for (const e of usableEvidences) {
      const name = evidenceIndex.get(e.id)?.name ?? e.id + '.jpg';
      if (await evidenceStorage.exists(e.storageKey)) {
        evidencesParaZip.push({ storageKey: e.storageKey, name, buffer: null });
        continue;
      }
      try {
        evidencesParaZip.push({ storageKey: e.storageKey, name, buffer: await leerEvidencia(e) });
      } catch (err) {
        warnings.push('No se pudo recuperar de Drive la fotografía ' + e.id + '.');
        logger.warn({ err, evidenciaId: e.id }, 'Evidencia remota no recuperable al archivar.');
      }
    }

    await buildZip(zipPath, { excel, pdf, metadata, evidences: evidencesParaZip });

    const zipBuffer = await readFile(zipPath);
    const zipStat = await stat(zipPath);
    const packageSha256 = sha256Hex(zipBuffer);
    const packageMd5 = createHash('md5').update(zipBuffer).digest('hex');

    await prisma.archiveBatch.update({
      where: { id: batch.id },
      data: {
        attendanceDays: days.length,
        marksCount: days.reduce((a, d) => a + d.marks.length, 0),
        photosCount: usableEvidences.length,
        eventsCount: events.length,
        packageBytes: zipStat.size,
        packageSha256,
        status: isDriveEnabled() ? 'SUBIENDO' : 'PENDIENTE',
      },
    });

    // --- 6. Subida a Drive --------------------------------------------------
    let driveFileId: string | null = null;
    let driveWebLink: string | null = null;
    let driveFolderId: string | null = null;
    let verified = false;

    if (isDriveEnabled()) {
      try {
        driveFolderId = await ensureArchivePath(site.name, request.year, request.month);
        const uploaded = await uploadFile({
          buffer: zipBuffer,
          filename: zipName,
          mimeType: 'application/zip',
          parentFolderId: driveFolderId,
        });
        driveFileId = uploaded.fileId;
        driveWebLink = uploaded.webViewLink;

        await prisma.archiveBatch.update({
          where: { id: batch.id },
          data: { status: 'VERIFICANDO', driveFolderId, driveFileId, driveWebLink, uploadedAt: new Date() },
        });

        // --- 7. Verificacion de la subida ---------------------------------
        const check = await verifyUpload(driveFileId);
        const sizeOk = check.exists && check.size === zipStat.size;
        const checksumOk = !check.md5Checksum || check.md5Checksum === packageMd5;
        verified = sizeOk && checksumOk;

        if (!verified) {
          warnings.push(
            'La verificación en Drive fallo (tamaño local ' + zipStat.size + ' vs remoto ' + check.size + ').',
          );
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        warnings.push('No se pudo subir a Google Drive: ' + message);
        logger.error({ err: e, batchId: batch.id }, 'Fallo la subida a Drive.');
        await recordSecurityEvent({
          type: 'ARCHIVADO_FALLIDO',
          severity: 'CRITICO',
          message: 'Fallo la subida del archivado ' + period + ' de la sede ' + site.name + ': ' + message,
          siteId: site.id,
          details: { batchId: batch.id, zipPath },
        });
      }
    } else {
      warnings.push(
        'Google Drive no está configurado: el paquete quedo verificado en disco local y pendiente de subida.',
      );
    }

    // --- 8. Estado final y liberacion --------------------------------------
    const finalStatus: ArchiveStatus = verified ? 'COMPLETADO' : isDriveEnabled() ? 'FALLIDO' : 'PENDIENTE';

    await prisma.archiveBatch.update({
      where: { id: batch.id },
      data: {
        status: finalStatus,
        verifiedAt: verified ? new Date() : null,
        driveChecksum: verified ? packageMd5 : null,
        lastError: verified ? null : warnings.join(' | ').slice(0, 600) || null,
      },
    });

    let released = false;

    // La liberacion exige verificacion remota confirmada. Sin eso, no se borra
    // absolutamente nada.
    if (request.release && verified && driveFileId) {
      await prisma.$transaction(async (tx) => {
        for (const e of usableEvidences) {
          await tx.evidencePhoto.update({
            where: { id: e.id },
            data: {
              status: 'LIBERADA',
              archivedAt: new Date(),
              releasedAt: new Date(),
              driveFileId,
              archiveBatchId: batch.id,
            },
          });
        }
        await tx.attendanceDay.updateMany({
          where: { siteId: site.id, businessDate: { gte: dateOnlyValue(from), lte: dateOnlyValue(to) } },
          data: { archivedAt: new Date() },
        });
        await tx.archiveBatch.update({
          where: { id: batch.id },
          data: { status: 'LIBERADO', releasedAt: new Date() },
        });
      });

      for (const e of usableEvidences) {
        await evidenceStorage.release(e.storageKey);
      }
      released = true;
    } else if (verified && driveFileId) {
      // Archivado sin liberar: se marcan como archivadas pero siguen disponibles.
      await prisma.evidencePhoto.updateMany({
        where: { id: { in: usableEvidences.map((e) => e.id) } },
        data: { status: 'ARCHIVADA', archivedAt: new Date(), driveFileId, archiveBatchId: batch.id },
      });
    }

    await recordAudit({
      actorUserId: request.actorUserId ?? null,
      action: released ? 'ARCHIVADO_LIBERADO' : 'ARCHIVADO_EJECUTADO',
      entityType: 'ArchiveBatch',
      entityId: batch.id,
      after: {
        sede: site.name,
        periodo: period,
        estado: released ? 'LIBERADO' : finalStatus,
        fotos: usableEvidences.length,
        driveFileId,
        packageSha256,
        warnings,
      },
    });

    await notify({
      type: 'ARCHIVADO',
      severity: warnings.length > 0 ? 'ADVERTENCIA' : 'INFO',
      title: 'Archivado ' + period + ' - ' + site.name,
      body:
        'Estado: ' + (released ? 'LIBERADO' : finalStatus) + '. ' +
        days.length + ' jornada(s), ' + usableEvidences.length + ' fotografía(s). ' +
        (warnings.length > 0 ? 'Avisos: ' + warnings.join(' ') : 'Sin incidencias.'),
      data: { batchId: batch.id, siteId: site.id, periodo: period, driveFileId },
    });

    return {
      batchId: batch.id,
      status: released ? 'LIBERADO' : finalStatus,
      siteName: site.name,
      period,
      attendanceDays: days.length,
      marks: days.reduce((a, d) => a + d.marks.length, 0),
      photos: usableEvidences.length,
      events: events.length,
      packageBytes: zipStat.size,
      packageSha256,
      localPath: zipPath,
      driveFileId,
      driveWebLink,
      released,
      integrity,
      warnings,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.archiveBatch.update({
      where: { id: batch.id },
      data: { status: 'FALLIDO', lastError: message.slice(0, 600) },
    });
    await recordSecurityEvent({
      type: 'ARCHIVADO_FALLIDO',
      severity: 'CRITICO',
      message: 'Fallo el archivado de ' + site.name + ' periodo ' + period + ': ' + message,
      siteId: site.id,
      details: { batchId: batch.id },
    });
    logger.error({ err: e, siteId: site.id, period }, 'Fallo el archivado.');
    throw e;
  }
}

function archivePhotoName(evidenceId: string, dni: string, type: string, when: Date, mime: string): string {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const stamp = when.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return 'fotos/' + stamp + '_' + sanitize(dni) + '_' + type.toLowerCase() + '_' + evidenceId.slice(0, 8) + '.' + ext;
}

function sanitize(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
  return cleaned.length > 0 ? cleaned : 'sin_dato';
}

async function buildZip(
  zipPath: string,
  content: {
    excel: Buffer;
    pdf: Buffer;
    metadata: unknown;
    evidences: { storageKey: string; name: string; buffer: Buffer | null }[];
  },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (w) => logger.warn({ warning: w }, 'Aviso al empaquetar el archivado.'));

    archive.pipe(output);
    archive.append(content.excel, { name: 'asistencias.xlsx' });
    archive.append(content.pdf, { name: 'reporte.pdf' });
    archive.append(JSON.stringify(content.metadata, null, 2), { name: 'metadata.json' });

    for (const e of content.evidences) {
      try {
        if (e.buffer) {
          // Evidencia que ya solo vive en Drive: se trajo para empaquetarla,
          // de modo que el paquete siga siendo autocontenido.
          archive.append(e.buffer, { name: e.name });
        } else {
          archive.file(evidenceStorage.absolutePath(e.storageKey), { name: e.name });
        }
      } catch (err) {
        logger.warn({ err, storageKey: e.storageKey }, 'No se pudo incluir una evidencia en el paquete.');
      }
    }

    void archive.finalize();
  });
}

// ---------------------------------------------------------------------------
// Retencion automatica
// ---------------------------------------------------------------------------

/**
 * Archiva y libera los periodos que superaron la ventana de retencion.
 * Solo toca meses ya cerrados por completo.
 */
export async function runRetentionSweep(): Promise<ArchiveResult[]> {
  const settings = await getSettings();
  const today = businessDateString(new Date(), config.APP_TIMEZONE);
  const cutoff = addMonthsToDateString(today, -settings.retentionMonths);
  const cutoffYear = Number(cutoff.slice(0, 4));
  const cutoffMonth = Number(cutoff.slice(5, 7));

  const sites = await prisma.site.findMany({ select: { id: true, name: true } });
  const results: ArchiveResult[] = [];

  for (const site of sites) {
    const oldest = await prisma.attendanceDay.findFirst({
      where: { siteId: site.id, archivedAt: null },
      orderBy: { businessDate: 'asc' },
      select: { businessDate: true },
    });
    if (!oldest) continue;

    const y = oldest.businessDate.getUTCFullYear();
    const m = oldest.businessDate.getUTCMonth() + 1;

    // Solo periodos anteriores al corte de retencion.
    if (y > cutoffYear || (y === cutoffYear && m >= cutoffMonth)) continue;

    try {
      results.push(await archivePeriod({ siteId: site.id, year: y, month: m, release: true }));
    } catch (e) {
      logger.error({ err: e, siteId: site.id, y, m }, 'Fallo el archivado automático por retención.');
    }
  }

  return results;
}

export async function listArchives(params: { siteId?: string; year?: number } = {}) {
  const batches = await prisma.archiveBatch.findMany({
    where: {
      ...(params.siteId ? { siteId: params.siteId } : {}),
      ...(params.year ? { year: params.year } : {}),
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    include: { site: { select: { id: true, code: true, name: true } } },
  });

  return batches.map((b) => ({
    id: b.id,
    site: b.site,
    year: b.year,
    month: b.month,
    period: b.year + '-' + String(b.month).padStart(2, '0'),
    status: b.status,
    attendanceDays: b.attendanceDays,
    marksCount: b.marksCount,
    photosCount: b.photosCount,
    eventsCount: b.eventsCount,
    packageBytes: b.packageBytes,
    packageSha256: b.packageSha256,
    driveFileId: b.driveFileId,
    driveWebLink: b.driveWebLink,
    startedAt: b.startedAt?.toISOString() ?? null,
    uploadedAt: b.uploadedAt?.toISOString() ?? null,
    verifiedAt: b.verifiedAt?.toISOString() ?? null,
    releasedAt: b.releasedAt?.toISOString() ?? null,
    lastError: b.lastError,
    attempts: b.attempts,
  }));
}
