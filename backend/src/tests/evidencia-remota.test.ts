/**
 * Evidencias guardadas en Google Drive.
 *
 * Lo que se prueba aqui no es la API de Google, sino la regla que protege la
 * prueba de asistencia: **la copia local solo se borra cuando la remota esta
 * verificada**. Mientras haya una sola copia, esa copia se queda donde el
 * servidor la controla.
 *
 * Drive se sustituye por un doble en memoria. Interesa el comportamiento del
 * sistema ante subidas correctas, corruptas y caidas, no la biblioteca de
 * Google.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { prisma } from '../infra/db/prisma.js';
import { evidenceStorage } from '../infra/storage/evidence-storage.js';
import { resetDatabase, makeJpeg } from './helpers.js';

// --- Doble de Google Drive ---------------------------------------------------
const nube = new Map<string, Buffer>();
let fallarSubida = false;

vi.mock('../infra/drive/drive.client.js', () => ({
  isDriveEnabled: () => true,
  driveIdentity: () => 'prueba',
  ensureFolder: async (nombre: string) => 'carpeta-' + nombre,
  uploadFile: async (params: { buffer: Buffer }) => {
    if (fallarSubida) throw new Error('Drive no disponible');
    const id = 'archivo-' + (nube.size + 1);
    nube.set(id, params.buffer);
    return { fileId: id, webViewLink: 'https://drive.example/' + id, size: params.buffer.length };
  },
  verifyUpload: async (fileId: string) => {
    const bytes = nube.get(fileId);
    if (!bytes) return { exists: false, size: 0, md5Checksum: null };
    return { exists: true, size: bytes.length, md5Checksum: createHash('md5').update(bytes).digest('hex') };
  },
  downloadFile: async (fileId: string) => {
    const bytes = nube.get(fileId);
    if (!bytes) throw new Error('No existe en Drive');
    return bytes;
  },
  checkDriveAccess: async () => ({ ok: true, message: 'ok' }),
}));

vi.mock('../config/env.js', async (original) => {
  const modulo = await original<typeof import('../config/env.js')>();
  return {
    ...modulo,
    config: { ...modulo.config, EVIDENCE_REMOTE_STORAGE: true, EVIDENCE_LOCAL_RETENTION_MINUTES: 0 },
  };
});

const { subirEvidenciasPendientes, liberarCopiasLocales, leerEvidencia, verificarEvidenciaRemota } = await import(
  '../modules/evidence/evidence-remote.service.js'
);

let app: Express;

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  nube.clear();
  fallarSubida = false;
});

/** Crea una evidencia real en disco, con su fila en base de datos. */
async function crearEvidencia() {
  const intern = await prisma.intern.create({
    data: {
      dni: '70000001',
      firstNames: 'Prueba',
      lastNames: 'Remota',
      site: {
        create: {
          code: 'REMOTA',
          name: 'Sede remota',
          address: 'Dirección de prueba',
          latitude: -12.04,
          longitude: -77.04,
          radiusMeters: 50,
          timezone: 'America/Lima',
        },
      },
      user: {
        create: { dni: '70000001', passwordHash: 'x', role: 'PRACTICANTE', displayName: 'Prueba Remota' },
      },
    },
  });

  const bytes = makeJpeg();
  const storageKey = evidenceStorage.buildKey({
    siteCode: 'REMOTA',
    isoDate: '2026-03-10',
    internDni: intern.dni,
    kind: 'MARCACION_ENTRADA',
    mime: 'image/jpeg',
  });
  const guardada = await evidenceStorage.save({ buffer: bytes, storageKey });

  return prisma.evidencePhoto.create({
    data: {
      internId: intern.id,
      kind: 'MARCACION_ENTRADA',
      storageKey: guardada.storageKey,
      mimeType: 'image/jpeg',
      sizeBytes: guardada.sizeBytes,
      sha256: guardada.sha256,
    },
  });
}

describe('Evidencias en Google Drive', () => {
  it('sube, verifica y recién entonces permite liberar la copia local', async () => {
    const foto = await crearEvidencia();

    const resultado = await subirEvidenciasPendientes();
    expect(resultado.subidas).toBe(1);

    const subida = await prisma.evidencePhoto.findUniqueOrThrow({ where: { id: foto.id } });
    expect(subida.remoteFileId).not.toBeNull();
    expect(subida.remoteMd5).not.toBeNull();
    expect(subida.remoteAt).not.toBeNull();
    // Mientras no se libere, la copia local sigue estando.
    expect(await evidenceStorage.exists(foto.storageKey)).toBe(true);
    expect(subida.localReleasedAt).toBeNull();

    const liberadas = await liberarCopiasLocales();
    expect(liberadas).toBe(1);
    expect(await evidenceStorage.exists(foto.storageKey)).toBe(false);
  });

  it('si Drive falla, la copia local NO se borra', async () => {
    const foto = await crearEvidencia();
    fallarSubida = true;

    const resultado = await subirEvidenciasPendientes();
    expect(resultado.fallidas).toBe(1);

    const tras = await prisma.evidencePhoto.findUniqueOrThrow({ where: { id: foto.id } });
    expect(tras.remoteAt).toBeNull();
    expect(tras.remoteError).toContain('Drive no disponible');
    expect(tras.remoteAttempts).toBe(1);

    // Lo esencial: la evidencia sigue en el servidor.
    expect(await evidenceStorage.exists(foto.storageKey)).toBe(true);
    expect(await liberarCopiasLocales()).toBe(0);
  });

  it('la base de datos impide declarar liberada una copia sin respaldo remoto', async () => {
    const foto = await crearEvidencia();

    await expect(
      prisma.evidencePhoto.update({ where: { id: foto.id }, data: { localReleasedAt: new Date() } }),
    ).rejects.toThrow();
  });

  it('una evidencia liberada se lee desde Drive y se comprueba su hash', async () => {
    const foto = await crearEvidencia();
    await subirEvidenciasPendientes();
    await liberarCopiasLocales();

    const actualizada = await prisma.evidencePhoto.findUniqueOrThrow({ where: { id: foto.id } });
    const bytes = await leerEvidencia(actualizada);

    expect(createHash('sha256').update(bytes).digest('hex')).toBe(foto.sha256);
  });

  it('no entrega una evidencia que Drive devuelve alterada', async () => {
    const foto = await crearEvidencia();
    await subirEvidenciasPendientes();
    await liberarCopiasLocales();

    const actualizada = await prisma.evidencePhoto.findUniqueOrThrow({ where: { id: foto.id } });
    // Alguien cambia el archivo en Drive.
    nube.set(actualizada.remoteFileId as string, Buffer.from('contenido distinto'));

    await expect(leerEvidencia(actualizada)).rejects.toThrow(/no coincide/i);
    expect(await verificarEvidenciaRemota(actualizada)).toBe(false);
  });

  it('no sube una fotografía cuya copia local está corrupta', async () => {
    const foto = await crearEvidencia();
    // Se corrompe el archivo en disco, sin tocar el hash registrado.
    await evidenceStorage.save({ buffer: makeJpeg(320, 240), storageKey: foto.storageKey });

    const resultado = await subirEvidenciasPendientes();
    expect(resultado.fallidas).toBe(1);
    expect(nube.size).toBe(0);

    const tras = await prisma.evidencePhoto.findUniqueOrThrow({ where: { id: foto.id } });
    expect(tras.remoteError).toContain('no coincide');
  });
});
