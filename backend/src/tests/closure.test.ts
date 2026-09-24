/**
 * Cierre de jornada, faltas, salidas pendientes y regularizacion.
 * Cubre los casos obligatorios 18 y 19.
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
import { closeSiteDay } from '../modules/attendance/day-closure.service.js';
import { dateOnlyValue } from '../core/time.js';

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

async function marcarEntrada(token: string, site: { latitude: number; longitude: number }) {
  return request(app)
    .post('/api/v1/asistencia/entrada')
    .set('authorization', 'Bearer ' + token)
    .set(deviceHeaders(DEVICE_A))
    .field('latitude', String(site.latitude))
    .field('longitude', String(site.longitude))
    .field('accuracyMeters', '7')
    .field('mockLocationReported', 'false')
    .attach('foto', makeJpeg(), { filename: 'e.jpg', contentType: 'image/jpeg' });
}

describe('Falta - jornada cerrada sin entrada', () => {
  it('marca AUSENTE al practicante que no registró entrada', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });

    const resumen = await closeSiteDay(site.id, todayInSite(site.timezone));

    expect(resumen.ausentes).toBe(1);
    const day = await prisma.attendanceDay.findFirst({ where: { internId: intern.internId } });
    expect(day?.status).toBe('AUSENTE');
    expect(day?.closedAt).not.toBeNull();
  });

  it('genera el evento de falta y la notificación correspondiente', async () => {
    const site = await createSite();
    await createIntern({ siteId: site.id, startMinute: 480 });

    await closeSiteDay(site.id, todayInSite(site.timezone));

    const evento = await prisma.securityEvent.findFirst({ where: { type: 'FALTA_REGISTRADA' } });
    expect(evento).not.toBeNull();
  });

  it('un día sin horario no genera falta', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: null });

    const resumen = await closeSiteDay(site.id, todayInSite(site.timezone));

    expect(resumen.ausentes).toBe(0);
    expect(resumen.sinJornada).toBe(1);
    const day = await prisma.attendanceDay.findFirst({ where: { internId: intern.internId } });
    expect(day?.status).toBe('NO_LABORABLE');
  });

  it('es idempotente: reejecutar el cierre no duplica nada', async () => {
    const site = await createSite();
    await createIntern({ siteId: site.id, startMinute: 480 });

    await closeSiteDay(site.id, todayInSite(site.timezone));
    const segunda = await closeSiteDay(site.id, todayInSite(site.timezone));

    expect(segunda.yaCerrado).toBe(true);
    expect(await prisma.attendanceDay.count()).toBe(1);
    expect(await prisma.securityEvent.count({ where: { type: 'FALTA_REGISTRADA' } })).toBe(1);
  });
});

describe('Caso 18 - Salida pendiente', () => {
  it('marca la jornada como salida pendiente cuando hubo entrada y no salida', async () => {
    const site = await createSite();
    const intern = await createIntern({
      siteId: site.id,
      startMinute: minutesFromNowInSite(-20, site.timezone),
    });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const entrada = await marcarEntrada(session.accessToken, site);
    expect(entrada.status).toBe(201);

    const resumen = await closeSiteDay(site.id, todayInSite(site.timezone));

    expect(resumen.salidasPendientes).toBe(1);
    expect(resumen.ausentes).toBe(0);

    const day = await prisma.attendanceDay.findFirst({ where: { internId: intern.internId } });
    expect(day?.status).toBe('PRESENTE');
    expect(day?.pendingExit).toBe(true);
  });

  it('crea la alerta de salida pendiente', async () => {
    const site = await createSite();
    const intern = await createIntern({
      siteId: site.id,
      startMinute: minutesFromNowInSite(-20, site.timezone),
    });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);
    await marcarEntrada(session.accessToken, site);

    await closeSiteDay(site.id, todayInSite(site.timezone));

    const evento = await prisma.securityEvent.findFirst({ where: { type: 'SALIDA_PENDIENTE' } });
    expect(evento).not.toBeNull();
    expect(evento?.severity).toBe('ADVERTENCIA');
  });

  it('aparece en el tablero del administrador', async () => {
    const site = await createSite();
    const intern = await createIntern({
      siteId: site.id,
      startMinute: minutesFromNowInSite(-20, site.timezone),
    });
    const admin = await createAdmin();
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);
    const adminSession = await loginAs(app, admin.dni, admin.password);

    await marcarEntrada(session.accessToken, site);
    await closeSiteDay(site.id, todayInSite(site.timezone));

    const res = await request(app)
      .get('/api/v1/asistencia/tablero?date=' + todayInSite(site.timezone))
      .set('authorization', 'Bearer ' + adminSession.accessToken);

    expect(res.status).toBe(200);
    expect(res.body.totals.salidasPendientes).toBe(1);
    expect(res.body.totals.presentes).toBe(1);
  });

  it('la jornada completa no queda pendiente', async () => {
    const site = await createSite();
    const intern = await createIntern({
      siteId: site.id,
      startMinute: minutesFromNowInSite(-20, site.timezone),
    });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    await marcarEntrada(session.accessToken, site);
    await request(app)
      .post('/api/v1/asistencia/salida')
      .set('authorization', 'Bearer ' + session.accessToken)
      .set(deviceHeaders(DEVICE_A))
      .field('latitude', String(site.latitude))
      .field('longitude', String(site.longitude))
      .field('accuracyMeters', '7')
      .field('mockLocationReported', 'false')
      .attach('foto', makeJpeg(), { filename: 's.jpg', contentType: 'image/jpeg' });

    const resumen = await closeSiteDay(site.id, todayInSite(site.timezone));

    expect(resumen.salidasPendientes).toBe(0);
    expect(resumen.presentesCompletos).toBe(1);
  });
});

describe('Caso 19 - Regularización', () => {
  async function jornadaConEntrada() {
    const site = await createSite();
    const intern = await createIntern({
      siteId: site.id,
      startMinute: minutesFromNowInSite(-60, site.timezone),
    });
    const admin = await createAdmin();
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);
    const adminSession = await loginAs(app, admin.dni, admin.password);

    const entrada = await marcarEntrada(session.accessToken, site);
    return { site, intern, admin, adminSession, attendanceDayId: entrada.body.attendanceDayId };
  }

  it('exige un motivo y lo rechaza si es demasiado breve', async () => {
    const ctx = await jornadaConEntrada();

    const res = await request(app)
      .post('/api/v1/asistencia/' + ctx.attendanceDayId + '/regularizar')
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken)
      .send({ field: 'PUNTUALIDAD', newValue: 'PUNTUAL', reason: 'error' });

    expect(res.status).toBe(422);
  });

  it('conserva el valor anterior, el nuevo, el autor y el motivo', async () => {
    const ctx = await jornadaConEntrada();

    const res = await request(app)
      .post('/api/v1/asistencia/' + ctx.attendanceDayId + '/regularizar')
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken)
      .send({
        field: 'PUNTUALIDAD',
        newValue: 'PUNTUAL',
        reason: 'El practicante presento constancia medica de atención de emergencia.',
      });

    expect(res.status).toBe(201);
    expect(res.body.oldValue).toBe('TARDANZA');
    expect(res.body.newValue).toBe('PUNTUAL');

    const registro = await prisma.regularization.findFirst({ where: { attendanceDayId: ctx.attendanceDayId } });
    expect(registro?.oldValue).toBe('TARDANZA');
    expect(registro?.adminUserId).toBe(ctx.admin.userId);
    expect(registro?.reason).toContain('constancia medica');

    const day = await prisma.attendanceDay.findUnique({ where: { id: ctx.attendanceDayId } });
    expect(day?.punctuality).toBe('PUNTUAL');
    expect(day?.lateMinutes).toBe(0);
    expect(day?.regularized).toBe(true);
  });

  it('corregir la hora de entrada recalcula la puntualidad', async () => {
    const ctx = await jornadaConEntrada();
    const day = await prisma.attendanceDay.findUnique({ where: { id: ctx.attendanceDayId } });
    const programada = day!.scheduledStartMinute as number;
    const nuevaHora =
      String(Math.floor((programada - 5) / 60)).padStart(2, '0') + ':' + String((programada - 5) % 60).padStart(2, '0');

    const res = await request(app)
      .post('/api/v1/asistencia/' + ctx.attendanceDayId + '/regularizar')
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken)
      .send({
        field: 'ENTRADA_HORA',
        newValue: nuevaHora,
        reason: 'Se corrige la hora por incidencia registrada en el cuaderno de sede.',
      });

    expect(res.status).toBe(201);

    const actualizado = await prisma.attendanceDay.findUnique({ where: { id: ctx.attendanceDayId } });
    expect(actualizado?.punctuality).toBe('PUNTUAL');
    expect(actualizado?.lateMinutes).toBe(0);
  });

  it('no permite fabricar una marcación que nunca existio', async () => {
    const ctx = await jornadaConEntrada();

    const res = await request(app)
      .post('/api/v1/asistencia/' + ctx.attendanceDayId + '/regularizar')
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken)
      .send({
        field: 'SALIDA_HORA',
        newValue: '18:00',
        reason: 'Intento de crear una salida que nunca se registro con evidencia.',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('evidencia fotográfica');
  });

  it('no permite marcar AUSENTE una jornada con entrada registrada', async () => {
    const ctx = await jornadaConEntrada();

    const res = await request(app)
      .post('/api/v1/asistencia/' + ctx.attendanceDayId + '/regularizar')
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken)
      .send({
        field: 'ESTADO_DIA',
        newValue: 'AUSENTE',
        reason: 'Intento de anular una presencia que tiene evidencia fotográfica.',
      });

    expect(res.status).toBe(409);
  });

  it('la regularización queda en la auditoria y no se puede borrar', async () => {
    const ctx = await jornadaConEntrada();

    await request(app)
      .post('/api/v1/asistencia/' + ctx.attendanceDayId + '/regularizar')
      .set('authorization', 'Bearer ' + ctx.adminSession.accessToken)
      .send({
        field: 'PUNTUALIDAD',
        newValue: 'PUNTUAL',
        reason: 'Justificación aprobada por la coordinacion de la sede.',
      });

    const auditoria = await prisma.auditLog.findFirst({ where: { action: 'REGULARIZACION_APLICADA' } });
    expect(auditoria).not.toBeNull();

    // La base impide alterar la bitacora.
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM "audit_log" WHERE "id" = $1::uuid', auditoria!.id),
    ).rejects.toThrow(/AUDITORIA_INMUTABLE/);

    await expect(
      prisma.$executeRawUnsafe('UPDATE "regularization" SET "reason" = $1', 'motivo alterado'),
    ).rejects.toThrow(/AUDITORIA_INMUTABLE/);
  });

  it('un practicante no puede regularizar', async () => {
    const ctx = await jornadaConEntrada();
    const session = await loginAs(app, ctx.intern.dni, ctx.intern.password, DEVICE_A);

    const res = await request(app)
      .post('/api/v1/asistencia/' + ctx.attendanceDayId + '/regularizar')
      .set('authorization', 'Bearer ' + session.accessToken)
      .set(deviceHeaders(DEVICE_A))
      .send({ field: 'PUNTUALIDAD', newValue: 'PUNTUAL', reason: 'Quiero cambiar mi propia tardanza.' });

    expect(res.status).toBe(403);
  });
});

describe('Horarios con vigencia temporal', () => {
  it('cambiar el horario preserva la vigencia anterior', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const admin = await createAdmin();
    const adminSession = await loginAs(app, admin.dni, admin.password);

    const res = await request(app)
      .put('/api/v1/practicantes/' + intern.internId + '/horario')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({
        effectiveFrom: todayInSite(site.timezone),
        slots: [
          { weekday: 1, startTime: '09:00' },
          { weekday: 2, startTime: '09:00' },
          { weekday: 3, startTime: '07:30' },
        ],
      });

    expect(res.status).toBe(200);

    const historial = await prisma.scheduleEntry.findMany({ where: { internId: intern.internId } });
    const cerradas = historial.filter((h) => h.effectiveTo !== null);
    const vigentes = historial.filter((h) => h.effectiveTo === null);

    expect(cerradas.length).toBeGreaterThan(0); // se conserva el horario anterior
    expect(vigentes).toHaveLength(3);
    expect(vigentes.find((v) => v.weekday === 3)?.startMinute).toBe(450);
  });

  it('rechaza un horario con la salida antes de la entrada', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const admin = await createAdmin();
    const adminSession = await loginAs(app, admin.dni, admin.password);

    const res = await request(app)
      .put('/api/v1/practicantes/' + intern.internId + '/horario')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({
        effectiveFrom: todayInSite(site.timezone),
        slots: [{ weekday: 1, startTime: '09:00', endTime: '08:00' }],
      });

    expect(res.status).toBe(422);
  });

  it('la jornada guarda copia del horario que regia ese día', async () => {
    const site = await createSite();
    const startMinute = minutesFromNowInSite(-10, site.timezone);
    const intern = await createIntern({ siteId: site.id, startMinute });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    await marcarEntrada(session.accessToken, site);

    const day = await prisma.attendanceDay.findFirst({ where: { internId: intern.internId } });
    expect(day?.scheduledStartMinute).toBe(startMinute);

    // Aunque despues cambie el horario, la jornada mantiene su copia.
    await prisma.scheduleEntry.updateMany({ where: { internId: intern.internId }, data: { startMinute: 300 } });
    const despues = await prisma.attendanceDay.findFirst({ where: { internId: intern.internId } });
    expect(despues?.scheduledStartMinute).toBe(startMinute);
  });
});

describe('Restricciones de base de datos', () => {
  it('impide dos jornadas del mismo practicante y fecha', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const fecha = dateOnlyValue(todayInSite(site.timezone));

    await prisma.attendanceDay.create({
      data: { internId: intern.internId, siteId: site.id, businessDate: fecha, status: 'PROGRAMADO' },
    });

    await expect(
      prisma.attendanceDay.create({
        data: { internId: intern.internId, siteId: site.id, businessDate: fecha, status: 'PROGRAMADO' },
      }),
    ).rejects.toThrow();
  });

  it('impide dos vinculaciones activas del mismo usuario', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });

    await prisma.deviceBinding.create({
      data: { userId: intern.userId, deviceFingerprint: 'huella-1-aaaaaaaaaaaaaaaa', platform: 'android' },
    });

    await expect(
      prisma.deviceBinding.create({
        data: { userId: intern.userId, deviceFingerprint: 'huella-2-bbbbbbbbbbbbbbbb', platform: 'android' },
      }),
    ).rejects.toThrow();
  });

  it('rechaza coordenadas de sede fuera de rango', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "site" ("id","code","name","address","latitude","longitude","radius_meters","timezone","active","created_at","updated_at")
         VALUES (gen_random_uuid(),'MALA','Sede mala','Dir',999,0,50,'America/Lima',true,now(),now())`,
      ),
    ).rejects.toThrow();
  });

  it('rechaza un radio de geocerca absurdo', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "site" ("id","code","name","address","latitude","longitude","radius_meters","timezone","active","created_at","updated_at")
         VALUES (gen_random_uuid(),'RADIO','Sede radio','Dir',-12.04,-77.04,999999,'America/Lima',true,now(),now())`,
      ),
    ).rejects.toThrow();
  });
});
