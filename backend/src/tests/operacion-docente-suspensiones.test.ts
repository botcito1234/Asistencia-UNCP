import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { prisma } from '../infra/db/prisma.js';
import {
  createAdmin,
  createIntern,
  createSite,
  deviceHeaders,
  DEVICE_A,
  loginAs,
  resetDatabase,
  todayInSite,
} from './helpers.js';

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

describe('Operacion docente y suspensiones', () => {
  it('permite crear, asignar, reportar y revocar una cartera docente', async () => {
    const site = await createSite();
    const primero = await createIntern({ siteId: site.id, startMinute: null });
    const segundo = await createIntern({ siteId: site.id, startMinute: null });
    const admin = await createAdmin();
    const adminSession = await loginAs(app, admin.dni, admin.password);

    const alta = await request(app)
      .post('/api/v1/operacion/docentes')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({ dni: '70000001', displayName: 'Docente Conductor', email: 'docente@ejemplo.com' });

    expect(alta.status).toBe(201);
    expect(alta.body.temporaryPassword).toBeTruthy();

    const docente = await prisma.conductorProfile.findUnique({ where: { id: alta.body.conductorId } });
    expect(docente).not.toBeNull();

    const asignacion = await request(app)
      .post('/api/v1/operacion/docentes/' + alta.body.conductorId + '/asignaciones')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({ internIds: [primero.internId, segundo.internId] });

    expect(asignacion.status).toBe(201);

    const cambio = await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set('authorization', 'Bearer ' + (await loginAs(app, '70000001', alta.body.temporaryPassword)).accessToken)
      .send({ currentPassword: alta.body.temporaryPassword, newPassword: 'DocenteNuevo2026' });

    expect(cambio.status).toBe(200);
    const docenteSession = await loginAs(app, '70000001', 'DocenteNuevo2026');

    const misPracticantes = await request(app)
      .get('/api/v1/operacion/docentes/mis-practicantes')
      .set('authorization', 'Bearer ' + docenteSession.accessToken);

    expect(misPracticantes.status).toBe(200);
    expect(misPracticantes.body.items).toHaveLength(2);

    const reporte = await request(app)
      .post('/api/v1/operacion/seguimiento-docente')
      .set('authorization', 'Bearer ' + docenteSession.accessToken)
      .send({
        internId: primero.internId,
        category: 'METODOLOGIA',
        nature: 'OBSERVACION_DE_MEJORA',
        importance: 'MEDIO',
        detail: 'Requiere reforzar la planificación de la sesión.',
      });

    expect(reporte.status).toBe(201);

    const revocacion = await request(app)
      .post('/api/v1/operacion/docentes/' + alta.body.conductorId + '/asignaciones')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({ internIds: [] });

    expect(revocacion.status).toBe(201);
    expect(await prisma.internConductor.count({ where: { conductorId: alta.body.conductorId, revokedAt: null } })).toBe(0);
    expect(await prisma.teacherReport.count({ where: { conductorId: alta.body.conductorId } })).toBe(1);
  });

  it('suspende una sede y bloquea las acciones de marcacion del practicante', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: null });
    const admin = await createAdmin();
    const adminSession = await loginAs(app, admin.dni, admin.password);
    const fecha = todayInSite(site.timezone);

    const suspension = await request(app)
      .post('/api/v1/suspensiones')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({ scope: 'SITE', siteId: site.id, businessDate: fecha, reason: 'Actividad institucional programada' });

    expect(suspension.status).toBe(201);

    const internSession = await loginAs(app, intern.dni, intern.password, DEVICE_A);
    const estado = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + internSession.accessToken)
      .set(deviceHeaders(DEVICE_A));

    expect(estado.status).toBe(200);
    expect(estado.body.status).toBe('SUSPENDIDA');
    expect(estado.body.actions.canCheckIn).toBe(false);
    expect(estado.body.actions.canCheckOut).toBe(false);

    const filtroSuspendidas = await request(app)
      .get('/api/v1/asistencia')
      .query({ from: fecha, to: fecha, status: 'SUSPENDIDA' })
      .set('authorization', 'Bearer ' + adminSession.accessToken);

    expect(filtroSuspendidas.status).toBe(200);

    const duplicados = await request(app)
      .post('/api/v1/suspensiones')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({ scope: 'SELECTED_INTERNS', internIds: [intern.internId, intern.internId], businessDate: fecha, reason: 'Seleccion duplicada' });

    expect(duplicados.status).toBe(422);

    const alcanceInconsistente = await request(app)
      .post('/api/v1/suspensiones')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({ scope: 'SITE', siteId: site.id, internId: intern.internId, businessDate: fecha, reason: 'Alcance inconsistente' });

    expect(alcanceInconsistente.status).toBe(422);
  });
});
