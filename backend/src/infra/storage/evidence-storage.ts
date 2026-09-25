/**
 * Almacenamiento de evidencias fotograficas.
 *
 * Decision: sistema de archivos privado del servidor, fuera de cualquier
 * carpeta publica. Para la escala del sistema (60 practicantes, ~120 fotos
 * diarias) no se justifica un almacen de objetos; la interfaz esta aislada
 * detras de este modulo para poder sustituirlo por S3 sin tocar el dominio.
 *
 * Ninguna foto se sirve por URL directa. El acceso pasa siempre por un endpoint
 * autenticado que ademas deja registro de auditoria de la lectura.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { config } from '../../config/env.js';
import { sha256Hex, newId } from '../../core/crypto.js';
import { errors } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

export interface StoredEvidence {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Firmas binarias reales; no se confia en el content-type declarado. */
export function sniffMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Lee dimensiones sin dependencias nativas. Devuelve null si no se puede. */
export function readDimensions(buffer: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buffer[offset + 1] as number;
        // SOF0..SOF15 excepto DHT (c4), JPGA (c8) y DAC (cc)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
      return null;
    }
    if (mime === 'image/webp') {
      if (buffer.toString('ascii', 12, 16) === 'VP8X') {
        return {
          width: 1 + (buffer.readUIntLE(24, 3) & 0xffffff),
          height: 1 + (buffer.readUIntLE(27, 3) & 0xffffff),
        };
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
  return cleaned.length > 0 ? cleaned : 'sin_dato';
}

export class EvidenceStorage {
  constructor(private readonly root: string = config.STORAGE_ROOT) {}

  /**
   * Clave de almacenamiento particionada por sede/anio/mes.
   * La misma jerarquia se reutiliza al archivar en Google Drive, de modo que la
   * estructura en disco y en la nube coinciden.
   */
  buildKey(params: { siteCode: string; isoDate: string; internDni: string; kind: string; mime: string }): string {
    const year = params.isoDate.slice(0, 4);
    const month = params.isoDate.slice(5, 7);
    const ext = EXTENSION_BY_MIME[params.mime] ?? '.bin';
    const file = params.isoDate + '_' + sanitizeSegment(params.internDni) + '_' + params.kind + '_' + newId() + ext;
    return ['evidencias', sanitizeSegment(params.siteCode), year, month, file].join('/');
  }

  absolutePath(storageKey: string): string {
    const normalized = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, '');
    const rootResolved = path.resolve(this.root);
    const full = path.resolve(rootResolved, normalized);
    // Defensa contra path traversal: el resultado debe seguir dentro de la raiz.
    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
      throw errors.validation('Ruta de evidencia inválida.');
    }
    return full;
  }

  /**
   * Valida y persiste el binario. Devuelve el hash SHA-256 calculado SOBRE LO
   * QUE QUEDO EN DISCO, no sobre lo recibido: es la unica forma de afirmar que
   * la evidencia se almaceno integra.
   */
  async save(params: { buffer: Buffer; storageKey: string }): Promise<StoredEvidence> {
    const { buffer, storageKey } = params;

    if (buffer.length === 0) throw errors.validation('La fotografía llego vacia.');
    if (buffer.length > config.EVIDENCE_MAX_BYTES) {
      throw errors.validation(
        'La fotografía supera el tamaño máximo permitido (' +
          Math.round(config.EVIDENCE_MAX_BYTES / 1024) +
          ' KB).',
      );
    }

    const sniffed = sniffMime(buffer);
    if (!sniffed) throw errors.validation('El archivo recibido no es una imagen válida.');
    if (!config.evidenceAllowedMime.includes(sniffed)) {
      throw errors.validation('Formato de imagen no permitido: ' + sniffed);
    }

    const dimensions = readDimensions(buffer, sniffed);
    if (dimensions && (dimensions.width < 240 || dimensions.height < 240)) {
      throw errors.validation('La fotografía tiene una resolución demasiado baja para servir como evidencia.');
    }

    const full = this.absolutePath(storageKey);
    await mkdir(path.dirname(full), { recursive: true });
    await pipeline(Readable.from(buffer), createWriteStream(full, { mode: 0o600 }));

    // Verificacion de escritura: releer desde disco y comparar.
    const onDisk = await readFile(full);
    const hash = sha256Hex(onDisk);
    if (onDisk.length !== buffer.length || hash !== sha256Hex(buffer)) {
      await rm(full, { force: true });
      throw errors.internal('La evidencia no se almaceno integra; se cancelo la operación.');
    }

    return {
      storageKey,
      sizeBytes: onDisk.length,
      sha256: hash,
      mimeType: sniffed,
      width: dimensions ? dimensions.width : null,
      height: dimensions ? dimensions.height : null,
    };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.absolutePath(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await access(this.absolutePath(storageKey), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async size(storageKey: string): Promise<number> {
    const s = await stat(this.absolutePath(storageKey));
    return s.size;
  }

  /** Verifica que el binario en disco siga correspondiendo al hash registrado. */
  async verifyIntegrity(storageKey: string, expectedSha256: string): Promise<boolean> {
    try {
      const buf = await this.read(storageKey);
      return sha256Hex(buf) === expectedSha256;
    } catch {
      return false;
    }
  }

  /**
   * Libera el binario local. Solo debe invocarse cuando el archivado remoto ya
   * fue verificado: el llamador es responsable de esa precondicion.
   */
  async release(storageKey: string): Promise<void> {
    try {
      await rm(this.absolutePath(storageKey), { force: true });
    } catch (e) {
      logger.warn({ storageKey, err: e }, 'No se pudo liberar el binario de evidencia.');
    }
  }
}

export const evidenceStorage = new EvidenceStorage();
