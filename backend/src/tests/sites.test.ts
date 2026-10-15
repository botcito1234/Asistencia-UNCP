/** Pruebas de integracion del registro y consulta de sedes. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { prisma } from '../infra/db/prisma.js';
import { createAdmin, loginAs, resetDatabase } from './helpers.js';

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

describe('Registro de sedes', () => {
  it('permite al administrador registrar una sede y consultarla', async () => {
    const admin = await createAdmin();
    const { accessToken } = await loginAs(app, admin.dni, admin.password);
    const sede = {
      code: 'PRUEBA-SEDE-01',
      name: 'Sede de prueba de registro',
      address: 'Av. Ejemplo 123, Huancayo',
      latitude: -12.046374,
      longitude: -77.042793,
      radiusMeters: 75,
      timezone: 'America/Lima',
    };

    const creada = await request(app)
      .post('/api/v1/sedes')
      .set('Authorization', 'Bearer ' + accessToken)
      .send(sede);

    expect(creada.status).toBe(201);
    expect(creada.body).toMatchObject({ ...sede, active: true });
    expect(creada.body.id).toEqual(expect.any(String));

    const listado = await request(app)
      .get('/api/v1/sedes')
      .set('Authorization', 'Bearer ' + accessToken);

    expect(listado.status).toBe(200);
    expect(listado.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: creada.body.id, code: sede.code, name: sede.name }),
    ]));

    const auditoria = await prisma.auditLog.findFirst({
      where: { entityId: creada.body.id, action: 'SEDE_CREADA' },
    });
    expect(auditoria).not.toBeNull();
  });

  it('rechaza códigos fuera del formato y no crea la sede', async () => {
    const admin = await createAdmin();
    const { accessToken } = await loginAs(app, admin.dni, admin.password);

    const res = await request(app)
      .post('/api/v1/sedes')
      .set('Authorization', 'Bearer ' + accessToken)
      .send({
        code: 'sede inválida',
        name: 'Sede inválida',
        address: 'Av. Ejemplo 123',
        latitude: -12.046374,
        longitude: -77.042793,
      });

    expect(res.status).toBe(422);
    expect(await prisma.site.count()).toBe(0);
  });
});
