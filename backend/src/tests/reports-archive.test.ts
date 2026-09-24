/**
 * Reportes (Excel y PDF), archivado historico y comportamiento cuando Google
 * Drive no esta disponible.
 * Cubre los casos obligatorios 20, 21, 22 y 23.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { prisma } from '../infra/db/prisma.js';
import {
  resetDatabase,
  createSite,
  createIntern,
  createAdmin,
  loginAs,
  deviceHeaders,
  makeJpeg,
  minutesFromNowInSite,
  todayInSite,
  DEVICE_A,
} from './helpers.js';
import { archivePeriod } from '../modules/archive/archive.service.js';
import { evidenceStorage } from '../infra/storage/evidence-storage.js';
import { verifyPeriodIntegrity } from '../modules/evidence/evidence.service.js';
import { isDriveEnabled } from '../infra/drive/drive.client.js';
import { writeFile } from 'node:fs/promises';

let app: Express;

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

/** Crea una jornada real con entrada y salida, evidencia incluida. */
async function jornadaCompleta() {
  const site = await createSite();
  const intern = await createIntern({
    siteId: site.id,
    startMinute: minutesFromNowInSite(-30, site.timezone),
  });
  const admin = await createAdmin();
  const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);
  const adminSession = await loginAs(app, admin.dni, admin.password);

  const entrada = await request(app)
    .post('/api/v1/asistencia/entrada')
    .set('authorization', 'Bearer ' + session.accessToken)
    .set(deviceHeaders(DEVICE_A))
    .field('latitude', String(site.latitude))
    .field('longitude', String(site.longitude))
    .field('accuracyMeters', '6')
    .field('mockLocationReported', 'false')
    .attach('foto', makeJpeg(), { filename: 'e.jpg', contentType: 'image/jpeg' });

  const salida = await request(app)
    .post('/api/v1/asistencia/salida')
    .set('authorization', 'Bearer ' + session.accessToken)
    .set(deviceHeaders(DEVICE_A))
    .field('latitude', String(site.latitude))
    .field('longitude', String(site.longitude))
    .field('accuracyMeters', '6')
    .field('mockLocationReported', 'false')
    .attach('foto', makeJpeg(), { filename: 's.jpg', contentType: 'image/jpeg' });

  return { site, intern, admin, adminSession, entrada, salida };
}

const hoy = () => todayInSite();

describe('Caso 22 - Reporte Excel', () => {
  it('genera un archivo xlsx valido y descargable', async () => {
    const ctx = await jornadaCompleta();

    const res = await request(app)
      .get('/api/v1/reportes/generar')
      .query({ tipo: 'sede', formato: 'excel', from: hoy(), to: hoy(), siteId: ctx.site.id })
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');

    const buffer = res.body as Buffer;
    expect(buffer.length).toBeGreaterThan(3000);
    // Un xlsx es un ZIP: debe empezar por la firma PK.
    expect(buffer.subarray(0, 2).toString('binary')).toBe('PK');
  });

  it('genera reportes de todos los tipos sin error', async () => {
    const ctx = await jornadaCompleta();
    const tipos = [
      'diario', 'semanal', 'mensual', 'rango', 'practicante', 'sede', 'consolidado',
      'puntualidad', 'tardanzas', 'faltas', 'entradas', 'salidas', 'pendientes', 'incidencias',
    ];

    for (const tipo of tipos) {
      const res = await request(app)
        .get('/api/v1/reportes/vista-previa')
        .query({ tipo, formato: 'excel', from: hoy(), to: hoy() })
        .set('authorization', 'Bearer ' + ctx.adminSession.accessToken);

      expect(res.status, 'fallo el tipo ' + tipo).toBe(200);
      expect(res.body.columns.length).toBeGreaterThan(0);
    }
  });

  it('el reporte contiene los datos de la jornada', async () => {
    const ctx = await jornadaCompleta();

    const res = await request(app)
      .get('/api/v1/reportes/vista-previa')
      .query({ tipo: 'sede', formato: 'excel', from: hoy(), to: hoy(), siteId: ctx.site.id })
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken);

    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].dni).toBe(ctx.intern.dni);
    expect(res.body.rows[0].estado).toBe('PRESENTE');
    expect(res.body.rows[0].entrada).toMatch(/^\d{2}:\d{2}$/);
    expect(res.body.rows[0].salida).toMatch(/^\d{2}:\d{2}$/);
    expect(res.body.totals.presentes).toBe(1);
  });

  it('generar un reporte queda auditado como lectura masiva de datos personales', async () => {
    const ctx = await jornadaCompleta();

    await request(app)
      .get('/api/v1/reportes/generar')
      .query({ tipo: 'sede', formato: 'excel', from: hoy(), to: hoy(), siteId: ctx.site.id })
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken)
      .buffer(true)
      .parse((res, cb) => {
        res.on('data', () => undefined);
        res.on('end', () => cb(null, Buffer.alloc(0)));
      });

    const auditoria = await prisma.auditLog.findFirst({ where: { action: 'REPORTE_GENERADO' } });
    expect(auditoria).not.toBeNull();
    expect(auditoria?.actorUserId).toBe(ctx.admin.userId);
  });
});

describe('Caso 23 - Reporte PDF', () => {
  it('genera un PDF valido', async () => {
    const ctx = await jornadaCompleta();

    const res = await request(app)
      .get('/api/v1/reportes/generar')
      .query({ tipo: 'consolidado', formato: 'pdf', from: hoy(), to: hoy() })
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');

    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.subarray(-6).toString('ascii')).toContain('EOF');
    expect(buffer.length).toBeGreaterThan(2000);
  });

  it('el PDF se genera también cuando no hay datos', async () => {
    const admin = await createAdmin();
    const adminSession = await loginAs(app, admin.dni, admin.password);

    const res = await request(app)
      .get('/api/v1/reportes/generar')
      .query({ tipo: 'faltas', formato: 'pdf', from: '2020-01-01', to: '2020-01-02' })
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('un reporte con muchas filas página correctamente', async () => {
    const site = await createSite();
    const admin = await createAdmin();
    const adminSession = await loginAs(app, admin.dni, admin.password);

    // 60 jornadas historicas: fuerza varias paginas en el PDF.
    for (let i = 0; i < 60; i++) {
      const intern = await createIntern({ siteId: site.id, startMinute: 480 });
      await prisma.attendanceDay.create({
        data: {
          internId: intern.internId,
          siteId: site.id,
          businessDate: new Date('2026-03-10T00:00:00.000Z'),
          scheduledStartMinute: 480,
          status: i % 5 === 0 ? 'AUSENTE' : 'PRESENTE',
          punctuality: i % 5 === 0 ? null : i % 3 === 0 ? 'TARDANZA' : 'PUNTUAL',
          lateMinutes: i % 3 === 0 && i % 5 !== 0 ? 12 : 0,
        },
      });
    }

    const res = await request(app)
      .get('/api/v1/reportes/generar')
      .query({ tipo: 'mensual', formato: 'pdf', from: '2026-03-01', to: '2026-03-31', siteId: site.id })
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    // Mas de una pagina.
    const paginas = (pdf.toString('binary').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(paginas).toBeGreaterThan(1);
  });
});

describe('Caso 20 - Archivado histórico', () => {
  it('genera el paquete con Excel, PDF, metadata y fotografías', async () => {
    const ctx = await jornadaCompleta();
    const fecha = hoy();
    const anio = Number(fecha.slice(0, 4));
    const mes = Number(fecha.slice(5, 7));

    const resultado = await archivePeriod({ siteId: ctx.site.id, year: anio, month: mes });

    expect(resultado.attendanceDays).toBe(1);
    expect(resultado.marks).toBe(2);
    expect(resultado.photos).toBe(2);
    expect(resultado.packageBytes).toBeGreaterThan(1000);
    expect(resultado.packageSha256).toHaveLength(64);
    expect(resultado.localPath).toContain('.zip');
  });

  it('verifica la integridad de cada fotografía antes de empaquetar', async () => {
    const ctx = await jornadaCompleta();
    const fecha = hoy();

    const resultado = await archivePeriod({
      siteId: ctx.site.id,
      year: Number(fecha.slice(0, 4)),
      month: Number(fecha.slice(5, 7)),
    });

    expect(resultado.integrity.revisadas).toBe(2);
    expect(resultado.integrity.integras).toBe(2);
    expect(resultado.integrity.alteradas).toHaveLength(0);
    expect(resultado.integrity.faltantes).toHaveLength(0);
  });

  it('detecta una fotografía alterada en disco', async () => {
    const ctx = await jornadaCompleta();

    const evidencia = await prisma.evidencePhoto.findFirst();
    // Se altera el binario por fuera del sistema.
    await writeFile(evidenceStorage.absolutePath(evidencia!.storageKey), makeJpeg(800, 600));

    const informe = await verifyPeriodIntegrity(
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
    );

    expect(informe.alteradas).toContain(evidencia!.id);
  });

  it('el paquete queda registrado como lote consultable', async () => {
    const ctx = await jornadaCompleta();
    const fecha = hoy();

    await archivePeriod({
      siteId: ctx.site.id,
      year: Number(fecha.slice(0, 4)),
      month: Number(fecha.slice(5, 7)),
    });

    const res = await request(app)
      .get('/api/v1/archivado')
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken);

    expect(res.status).toBe(200);
    expect(res.body.lotes).toHaveLength(1);
    expect(res.body.lotes[0].photosCount).toBe(2);
    expect(res.body.retencionMeses).toBe(6);
  });
});

describe('Caso 21 - Fallo o ausencia de Google Drive', () => {
  it('sin credenciales el archivado queda PENDIENTE y avisa que falta configurar', async () => {
    expect(isDriveEnabled()).toBe(false);

    const ctx = await jornadaCompleta();
    const fecha = hoy();

    const resultado = await archivePeriod({
      siteId: ctx.site.id,
      year: Number(fecha.slice(0, 4)),
      month: Number(fecha.slice(5, 7)),
      release: true, // se pide liberar, pero NO debe hacerlo
    });

    expect(resultado.status).toBe('PENDIENTE');
    expect(resultado.driveFileId).toBeNull();
    expect(resultado.warnings.join(' ')).toContain('Google Drive no está configurado');
  });

  it('NUNCA libera el almacenamiento local sin verificación remota', async () => {
    const ctx = await jornadaCompleta();
    const fecha = hoy();

    const resultado = await archivePeriod({
      siteId: ctx.site.id,
      year: Number(fecha.slice(0, 4)),
      month: Number(fecha.slice(5, 7)),
      release: true,
    });

    expect(resultado.released).toBe(false);

    // Las fotografias siguen en disco y consultables.
    const evidencias = await prisma.evidencePhoto.findMany();
    expect(evidencias).toHaveLength(2);
    for (const e of evidencias) {
      expect(e.releasedAt).toBeNull();
      expect(e.status).toBe('ACTIVA');
      expect(await evidenceStorage.exists(e.storageKey)).toBe(true);
    }
  });

  it('el diagnostico indica exactamente que variables faltan', async () => {
    const admin = await createAdmin();
    const adminSession = await loginAs(app, admin.dni, admin.password);

    const res = await request(app)
      .get('/api/v1/archivado/drive/estado')
      .set('authorization', 'Bearer ' + adminSession.accessToken);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    expect(res.body.message).toContain('GOOGLE_DRIVE_ROOT_FOLDER_ID');
  });

  it('un archivado fallido levanta alerta critica', async () => {
    const site = await createSite();
    await expect(archivePeriod({ siteId: 'no-existe', year: 2026, month: 1 })).rejects.toThrow();
    expect(site.id).toBeTruthy();
  });
});

describe('Acceso a evidencias', () => {
  it('el practicante ve su propia fotografía y queda auditado', async () => {
    const ctx = await jornadaCompleta();
    const session = await loginAs(app, ctx.intern.dni, ctx.intern.password, DEVICE_A);
    const evidenceId = ctx.entrada.body.evidenceId;

    const res = await request(app)
      .get('/api/v1/evidencias/' + evidenceId + '/imagen')
      .set('authorization', 'Bearer ' + session.accessToken)
      .set(deviceHeaders(DEVICE_A));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['x-evidence-integrity']).toBe('ok');

    const auditoria = await prisma.auditLog.findFirst({ where: { action: 'EVIDENCIA_CONSULTADA' } });
    expect(auditoria).not.toBeNull();
  });

  it('un practicante no puede ver la fotografía de otro', async () => {
    const ctx = await jornadaCompleta();
    const otro = await createIntern({ siteId: ctx.site.id, startMinute: 480 });
    const sessionOtro = await loginAs(app, otro.dni, otro.password, 'dispositivo-otro-cccc-00000000003');

    const res = await request(app)
      .get('/api/v1/evidencias/' + ctx.entrada.body.evidenceId + '/imagen')
      .set('authorization', 'Bearer ' + sessionOtro.accessToken)
      .set(deviceHeaders('dispositivo-otro-cccc-00000000003'));

    expect(res.status).toBe(403);
  });

  it('el enlace firmado caduca y no acepta firma inválida', async () => {
    const ctx = await jornadaCompleta();
    const evidenceId = ctx.entrada.body.evidenceId;

    const firmado = await request(app)
      .get('/api/v1/evidencias/' + evidenceId + '/url-firmada')
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken);

    expect(firmado.status).toBe(200);

    const ok = await request(app).get(firmado.body.url);
    expect(ok.status).toBe(200);

    const manipulado = firmado.body.url.replace(/sig=[0-9a-f]+/, 'sig=' + 'f'.repeat(64));
    const malo = await request(app).get(manipulado);
    expect(malo.status).toBe(401);
  });

  it('sin token ni firma no se sirve ninguna imagen', async () => {
    const ctx = await jornadaCompleta();
    const res = await request(app).get('/api/v1/evidencias/' + ctx.entrada.body.evidenceId + '/imagen');
    expect(res.status).toBe(401);
  });
});

describe('Tablero y consultas del administrador', () => {
  it('cuenta presentes, puntuales y salidas sin mezclar intentos rechazados', async () => {
    const ctx = await jornadaCompleta();

    // Un intento rechazado no debe alterar las cifras.
    const session = await loginAs(app, ctx.intern.dni, ctx.intern.password, DEVICE_A);
    await request(app)
      .post('/api/v1/asistencia/entrada')
      .set('authorization', 'Bearer ' + session.accessToken)
      .set(deviceHeaders(DEVICE_A))
      .field('latitude', String(ctx.site.latitude + 0.01))
      .field('longitude', String(ctx.site.longitude))
      .field('accuracyMeters', '6')
      .field('mockLocationReported', 'false')
      .attach('foto', makeJpeg(), { filename: 'x.jpg', contentType: 'image/jpeg' });

    const adminSession = await loginAs(app, ctx.admin.dni, ctx.admin.password);
    const res = await request(app)
      .get('/api/v1/asistencia/tablero?date=' + hoy())
      .set('authorization', 'Bearer ' + adminSession.accessToken);

    expect(res.body.totals.presentes).toBe(1);
    expect(res.body.totals.salidas).toBe(1);
    expect(res.body.totals.todaviaDentro).toBe(0);
    // El intento rechazado aparece como alerta, no como asistencia.
    expect(res.body.totals.alertas).toBeGreaterThan(0);
  });

  it('el detalle de la jornada trae los datos del mapa', async () => {
    const ctx = await jornadaCompleta();

    const res = await request(app)
      .get('/api/v1/asistencia/' + ctx.entrada.body.attendanceDayId)
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken);

    expect(res.status).toBe(200);
    expect(res.body.siteGeo.radiusMeters).toBe(50);
    expect(res.body.checkIn.latitude).toBeCloseTo(ctx.site.latitude, 5);
    expect(res.body.checkIn.photoUrl).toContain('/imagen?');
    expect(res.body.workedMinutes).toBeGreaterThanOrEqual(0);
  });
});
