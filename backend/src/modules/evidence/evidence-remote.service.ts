/**
 * Copia remota de las fotografias de evidencia.
 *
 * Con EVIDENCE_REMOTE_STORAGE la fotografia termina viviendo en Google Drive y
 * el disco del servidor pasa a ser un paso intermedio. Eso permite hospedar la
 * API sin volumen persistente, que es lo que encarece el despliegue.
 *
 * El orden importa y no es negociable:
 *
 *   1. La marcacion guarda la fotografia en disco y responde. Marcar NUNCA
 *      espera a Google: si la subida fuera sincrona, un corte de Drive dejaria
 *      a toda la sede sin poder registrar asistencia.
 *   2. Una tarea periodica sube lo pendiente y compara el MD5 que devuelve
 *      Drive con el del binario local.
 *   3. Recien con esa confirmacion se borra la copia local, y no antes de que
 *      pase el margen de gracia: mientras haya una sola copia, esa copia se
 *      queda donde el servidor la controla.
 *
 * Leer una fotografia sigue pasando por el backend, para que cada lectura quede
 * auditada aunque el binario ya no este en el servidor.
 */
import { createHash } from 'node:crypto';
import type { EvidencePhoto } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { config } from '../../config/env.js';
import { logger } from '../../core/logger.js';
import { evidenceStorage } from '../../infra/storage/evidence-storage.js';
import { isDriveEnabled, ensureFolder, uploadFile, verifyUpload, downloadFile } from '../../infra/drive/drive.client.js';
import { errors } from '../../core/errors.js';

/** Intentos antes de dejar de reintentar una fotografia y avisar en el log. */
const MAX_INTENTOS = 5;

export function isRemoteEvidenceEnabled(): boolean {
  return config.EVIDENCE_REMOTE_STORAGE && isDriveEnabled();
}

/**
 * Carpeta de destino, con la misma jerarquia que la clave local:
 * evidencias / SEDE / AÑO / MES.
 */
async function carpetaDestino(storageKey: string): Promise<string> {
  const partes = storageKey.split('/');
  // evidencias/<sede>/<anio>/<mes>/<archivo>
  const [raiz, sede, anio, mes] = partes;
  let carpeta = await ensureFolder(raiz ?? 'evidencias', config.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  for (const nivel of [sede, anio, mes]) {
    if (!nivel) continue;
    carpeta = await ensureFolder(nivel, carpeta);
  }
  return carpeta;
}

function md5De(buffer: Buffer): string {
  return createHash('md5').update(buffer).digest('hex');
}

export interface ResultadoSubida {
  revisadas: number;
  subidas: number;
  fallidas: number;
}

/**
 * Sube las fotografias que todavia no tienen copia remota verificada.
 *
 * Nunca lanza: es una tarea de fondo y un fallo de red no puede tumbar el
 * planificador. Lo que no se sube queda pendiente para la proxima vuelta.
 */
export async function subirEvidenciasPendientes(limite = 25): Promise<ResultadoSubida> {
  if (!isRemoteEvidenceEnabled()) return { revisadas: 0, subidas: 0, fallidas: 0 };

  const pendientes = await prisma.evidencePhoto.findMany({
    where: { remoteAt: null, status: 'ACTIVA', remoteAttempts: { lt: MAX_INTENTOS } },
    orderBy: { uploadedAt: 'asc' },
    take: limite,
  });

  let subidas = 0;
  let fallidas = 0;

  for (const foto of pendientes) {
    try {
      const binario = await evidenceStorage.read(foto.storageKey);

      // La copia local se comprueba antes de subir: si el disco se corrompio,
      // subir esa version seria consolidar el dano.
      const sha = createHash('sha256').update(binario).digest('hex');
      if (sha !== foto.sha256) {
        throw new Error('La copia local no coincide con su hash registrado.');
      }

      const carpeta = await carpetaDestino(foto.storageKey);
      const nombre = foto.storageKey.split('/').pop() ?? foto.id;
      const subido = await uploadFile({
        buffer: binario,
        filename: nombre,
        mimeType: foto.mimeType,
        parentFolderId: carpeta,
      });

      const comprobacion = await verifyUpload(subido.fileId);
      const md5Local = md5De(binario);
      if (!comprobacion.exists || comprobacion.size !== binario.length || comprobacion.md5Checksum !== md5Local) {
        throw new Error(
          'Drive no devolvio la misma huella: tamaño ' +
            comprobacion.size +
            ' frente a ' +
            binario.length +
            ', md5 ' +
            (comprobacion.md5Checksum ?? 'ninguno') +
            ' frente a ' +
            md5Local +
            '.',
        );
      }

      await prisma.evidencePhoto.update({
        where: { id: foto.id },
        data: {
          remoteFileId: subido.fileId,
          remoteMd5: md5Local,
          remoteAt: new Date(),
          remoteError: null,
          remoteAttempts: { increment: 1 },
        },
      });
      subidas++;
    } catch (e) {
      fallidas++;
      const mensaje = e instanceof Error ? e.message : String(e);
      await prisma.evidencePhoto.update({
        where: { id: foto.id },
        data: { remoteAttempts: { increment: 1 }, remoteError: mensaje.slice(0, 300) },
      });
      logger.error({ evidenciaId: foto.id, intentos: foto.remoteAttempts + 1, err: mensaje },
        'No se pudo subir la evidencia a Drive; la copia local se conserva.');
    }
  }

  if (subidas > 0 || fallidas > 0) {
    logger.info({ revisadas: pendientes.length, subidas, fallidas }, 'Subida de evidencias a Drive.');
  }
  return { revisadas: pendientes.length, subidas, fallidas };
}

/**
 * Borra las copias locales cuya copia remota ya esta verificada y lleva un rato
 * en Drive. El margen evita borrar una fotografia que el panel podria estar
 * mostrando en ese mismo instante desde el disco.
 */
export async function liberarCopiasLocales(limite = 100): Promise<number> {
  if (!isRemoteEvidenceEnabled()) return 0;

  const corte = new Date(Date.now() - config.EVIDENCE_LOCAL_RETENTION_MINUTES * 60_000);
  const candidatas = await prisma.evidencePhoto.findMany({
    where: { remoteAt: { not: null, lte: corte }, localReleasedAt: null },
    orderBy: { remoteAt: 'asc' },
    take: limite,
  });

  let liberadas = 0;
  for (const foto of candidatas) {
    try {
      await evidenceStorage.release(foto.storageKey);
      await prisma.evidencePhoto.update({
        where: { id: foto.id },
        data: { localReleasedAt: new Date() },
      });
      liberadas++;
    } catch (e) {
      logger.warn({ evidenciaId: foto.id, err: e }, 'No se pudo borrar la copia local de la evidencia.');
    }
  }

  if (liberadas > 0) logger.info({ liberadas }, 'Copias locales de evidencia liberadas.');
  return liberadas;
}

/**
 * Devuelve el binario de una fotografia, este donde este.
 *
 * Prefiere el disco por rapidez; si ya se libero, lo trae de Drive y comprueba
 * el SHA-256 antes de entregarlo. Una evidencia que no coincide con su hash no
 * se muestra: es preferible un error visible a una prueba silenciosamente
 * alterada.
 */
export async function leerEvidencia(foto: Pick<EvidencePhoto, 'id' | 'storageKey' | 'sha256' | 'remoteFileId'>): Promise<Buffer> {
  if (await evidenceStorage.exists(foto.storageKey)) {
    return evidenceStorage.read(foto.storageKey);
  }

  if (!foto.remoteFileId) {
    throw errors.notFound('Archivo de evidencia');
  }

  const binario = await downloadFile(foto.remoteFileId);
  const sha = createHash('sha256').update(binario).digest('hex');
  if (sha !== foto.sha256) {
    logger.error({ evidenciaId: foto.id }, 'La evidencia descargada de Drive no coincide con su hash.');
    throw errors.validation('La evidencia almacenada no coincide con su huella registrada.');
  }
  return binario;
}

/**
 * Verifica una evidencia que ya solo existe en Drive, sin descargarla: compara
 * el MD5 guardado al subirla con el que Drive informa ahora.
 */
export async function verificarEvidenciaRemota(
  foto: Pick<EvidencePhoto, 'remoteFileId' | 'remoteMd5' | 'sizeBytes'>,
): Promise<boolean> {
  if (!foto.remoteFileId || !foto.remoteMd5) return false;
  try {
    const estado = await verifyUpload(foto.remoteFileId);
    return estado.exists && estado.size === foto.sizeBytes && estado.md5Checksum === foto.remoteMd5;
  } catch {
    return false;
  }
}
