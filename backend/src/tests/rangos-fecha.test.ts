/**
 * Rangos de fecha del panel: "del dia X al dia X" se interpreta en la zona
 * horaria de la institucion, no en UTC.
 *
 * Regresion de un defecto encontrado probando en un telefono real: un incidente
 * de las 22:55 (hora de Lima) no aparecia al filtrar por su propio dia, porque
 * el rango se construia con `new Date(fecha + 'T00:00:00Z')`. En UTC-5 eso deja
 * fuera todo lo ocurrido despues de las 19:00 y lo mete en el dia siguiente:
 * justo el turno tarde, donde mas incidentes hay.
 *
 * Las fechas de estas pruebas son fijas a proposito, para que el resultado no
 * dependa de la hora a la que se ejecuten.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { prisma } from '../infra/db/prisma.js';
import { config } from '../config/env.js';
import { instantAtLocalMinutes } from '../core/time.js';
import { resetDatabase, createAdmin, loginAs } from './helpers.js';

let app: Express;

const DIA = '2026-03-10';
const DIA_ANTERIOR = '2026-03-09';
const TZ = config.APP_TIMEZONE;

/** 22:55 locales de ese dia: ya es el dia siguiente en UTC si la zona es UTC-5. */
const NOCHE = instantAtLocalMinutes(DIA, 22 * 60 + 55, TZ);
/** 23:30 locales del dia anterior: pertenece al dia anterior, no al consultado. */
const VISPERA = instantAtLocalMinutes(DIA_ANTERIOR, 23 * 60 + 30, TZ);

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('Rangos de fecha en zona horaria local', () => {
  it('un evento de seguridad de las 22:55 aparece en su propio día', async () => {
    const admin = await createAdmin();
    const sesion = await loginAs(app, admin.dni, admin.password);

    await prisma.securityEvent.create({
      data: { type: 'GPS_IMPRECISO', severity: 'INFO', message: 'Incidente de la noche.', createdAt: NOCHE },
    });
    await prisma.securityEvent.create({
      data: { type: 'GPS_IMPRECISO', severity: 'INFO', message: 'Incidente de la víspera.', createdAt: VISPERA },
    });

    const res = await request(app)
      .get('/api/v1/seguridad/eventos')
      .query({ from: DIA, to: DIA, pageSize: 50 })
      .set('authorization', 'Bearer ' + sesion.accessToken);

    expect(res.status).toBe(200);
    const mensajes = (res.body.items as { message: string }[]).map((e) => e.message);
    expect(mensajes).toContain('Incidente de la noche.');
    expect(mensajes).not.toContain('Incidente de la víspera.');
  });

  it('el resumen cuenta ese mismo evento', async () => {
    const admin = await createAdmin();
    const sesion = await loginAs(app, admin.dni, admin.password);

    await prisma.securityEvent.create({
      data: { type: 'FUERA_DE_GEOCERCA', severity: 'ADVERTENCIA', message: 'Fuera del radio.', createdAt: NOCHE },
    });

    const res = await request(app)
      .get('/api/v1/seguridad/resumen')
      .query({ from: DIA, to: DIA })
      .set('authorization', 'Bearer ' + sesion.accessToken);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('la bitácora de auditoría respeta el día local', async () => {
    const admin = await createAdmin();
    const sesion = await loginAs(app, admin.dni, admin.password);

    await prisma.auditLog.create({
      data: { action: 'ENTRADA_REGISTRADA', entityType: 'AttendanceMark', entityId: 'x', createdAt: NOCHE },
    });
    await prisma.auditLog.create({
      data: { action: 'SALIDA_REGISTRADA', entityType: 'AttendanceMark', entityId: 'y', createdAt: VISPERA },
    });

    const res = await request(app)
      .get('/api/v1/seguridad/auditoria')
      .query({ from: DIA, to: DIA, pageSize: 100 })
      .set('authorization', 'Bearer ' + sesion.accessToken);

    expect(res.status).toBe(200);
    const acciones = (res.body.items as { action: string }[]).map((a) => a.action);
    expect(acciones).toContain('ENTRADA_REGISTRADA');
    expect(acciones).not.toContain('SALIDA_REGISTRADA');
  });

  it('el reporte de incidencias incluye los eventos de la noche', async () => {
    const admin = await createAdmin();
    const sesion = await loginAs(app, admin.dni, admin.password);

    await prisma.securityEvent.create({
      data: { type: 'UBICACION_SIMULADA', severity: 'CRITICO', message: 'Ubicación simulada.', createdAt: NOCHE },
    });

    const res = await request(app)
      .get('/api/v1/reportes/vista-previa')
      .query({ tipo: 'incidencias', formato: 'excel', from: DIA, to: DIA })
      .set('authorization', 'Bearer ' + sesion.accessToken);

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
  });
});
