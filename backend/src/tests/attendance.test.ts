/**
 * Pruebas de extremo a extremo del flujo de marcacion contra PostgreSQL real.
 *
 * Cubre los casos de prueba obligatorios 1 a 9, 11, 13 a 17 y 24.
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
  loginAs,
  deviceHeaders,
  makeJpeg,
  makeNotAnImage,
  pointAtMeters,
  minutesFromNowInSite,
  DEVICE_A,
  DEVICE_B,
  SEDE_LIMA,
  type CreatedSite,
  type CreatedIntern,
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

interface Ctx {
  site: CreatedSite;
  intern: CreatedIntern;
  token: string;
}

/** Prepara sede, practicante con horario relativo a la hora actual, y sesion. */
async function setupIntern(scheduleOffsetMinutes: number, siteOverrides = {}): Promise<Ctx> {
  const site = await createSite(siteOverrides);
  const intern = await createIntern({
    siteId: site.id,
    startMinute: minutesFromNowInSite(scheduleOffsetMinutes, site.timezone),
  });
  const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);
  return { site, intern, token: session.accessToken };
}

interface MarkOptions {
  point?: { latitude: number; longitude: number };
  accuracy?: number;
  mock?: boolean;
  device?: string;
  photo?: Buffer | null;
  idempotencyKey?: string;
  locationAgeMs?: number;
}

function mark(ctx: Ctx, type: 'entrada' | 'salida', options: MarkOptions = {}) {
  const point = options.point ?? { latitude: ctx.site.latitude, longitude: ctx.site.longitude };
  const req = request(app)
    .post('/api/v1/asistencia/' + type)
    .set('authorization', 'Bearer ' + ctx.token)
    .set(deviceHeaders(options.device ?? DEVICE_A))
    .field('latitude', String(point.latitude))
    .field('longitude', String(point.longitude))
    .field('accuracyMeters', String(options.accuracy ?? 8))
    .field('mockLocationReported', options.mock ? 'true' : 'false')
    .field('locationAgeMs', String(options.locationAgeMs ?? 1500));

  if (options.idempotencyKey) req.field('idempotencyKey', options.idempotencyKey);

  const photo = options.photo === undefined ? makeJpeg() : options.photo;
  if (photo) req.attach('foto', photo, { filename: 'evidencia.jpg', contentType: 'image/jpeg' });

  return req;
}

// ---------------------------------------------------------------------------

describe('Caso 1 - Entrada puntual', () => {
  it('registra la entrada como PUNTUAL y deja la jornada PRESENTE', async () => {
    // Hora programada dentro de 5 minutos: estamos en la ventana anticipada.
    const ctx = await setupIntern(5);

    const res = await mark(ctx, 'entrada');

    expect(res.status).toBe(201);
    expect(res.body.punctuality).toBe('PUNTUAL');
    expect(res.body.lateMinutes).toBe(0);
    expect(res.body.type).toBe('ENTRADA');
    expect(res.body.distanceMeters).toBeLessThan(1);

    const day = await prisma.attendanceDay.findFirst({ where: { internId: ctx.intern.internId } });
    expect(day?.status).toBe('PRESENTE');
    expect(day?.punctuality).toBe('PUNTUAL');
    expect(day?.pendingExit).toBe(true);
  });

  it('almacena la evidencia con su hash y la vincula a la marcación', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada');

    const evidence = await prisma.evidencePhoto.findUnique({ where: { id: res.body.evidenceId } });
    expect(evidence).not.toBeNull();
    expect(evidence?.sha256).toHaveLength(64);
    expect(evidence?.mimeType).toBe('image/jpeg');
    expect(evidence?.captureSource).toBe('CAMARA');
    expect(evidence?.internId).toBe(ctx.intern.internId);

    const mark1 = await prisma.attendanceMark.findUnique({ where: { id: res.body.markId } });
    expect(mark1?.evidenceId).toBe(evidence?.id);
  });

  it('deja registro en la bitacora de auditoria', async () => {
    const ctx = await setupIntern(5);
    await mark(ctx, 'entrada');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'ENTRADA_REGISTRADA' } });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(ctx.intern.userId);
  });

  it('genera notificación de entrada para el administrador', async () => {
    const ctx = await setupIntern(5);
    await mark(ctx, 'entrada');

    const notification = await prisma.notification.findFirst({ where: { type: 'ENTRADA_REGISTRADA' } });
    expect(notification).not.toBeNull();
  });
});

describe('Caso 2 - Entrada exactamente 15 minutos antes', () => {
  it('acepta la marcación en el limite de la ventana y la clasifica PUNTUAL', async () => {
    const ctx = await setupIntern(15);
    const res = await mark(ctx, 'entrada');

    expect(res.status).toBe(201);
    expect(res.body.punctuality).toBe('PUNTUAL');
  });
});

describe('Caso 3 - Intento demasiado temprano', () => {
  it('rechaza la marcación e informa a partir de que hora se puede', async () => {
    // Hora programada dentro de 40 minutos: la ventana abre en 25.
    const ctx = await setupIntern(40);
    const res = await mark(ctx, 'entrada');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FUERA_DE_VENTANA');
    expect(res.body.error.meta.opensAt).toMatch(/^\d{2}:\d{2}$/);

    // No se creo ninguna asistencia.
    expect(await prisma.attendanceMark.count()).toBe(0);
  });

  it('registra el intento como evento de seguridad, no como asistencia', async () => {
    const ctx = await setupIntern(40);
    await mark(ctx, 'entrada');

    const event = await prisma.securityEvent.findFirst({ where: { type: 'MARCACION_FUERA_DE_VENTANA' } });
    expect(event).not.toBeNull();
    expect(event?.internId).toBe(ctx.intern.internId);
    expect(await prisma.attendanceDay.count()).toBe(0);
  });
});

describe('Caso 4 - Entrada tardia', () => {
  it('registra TARDANZA y cuenta los minutos de retraso', async () => {
    // Hora programada hace 30 minutos.
    const ctx = await setupIntern(-30);
    const res = await mark(ctx, 'entrada');

    expect(res.status).toBe(201);
    expect(res.body.punctuality).toBe('TARDANZA');
    expect(res.body.lateMinutes).toBeGreaterThanOrEqual(29);
    expect(res.body.lateMinutes).toBeLessThanOrEqual(31);
  });

  it('no bloquea una llegada muy tardia el mismo día', async () => {
    const ctx = await setupIntern(-300); // cinco horas tarde
    const res = await mark(ctx, 'entrada');

    expect(res.status).toBe(201);
    expect(res.body.punctuality).toBe('TARDANZA');
  });

  it('notifica la tardanza con severidad de advertencia', async () => {
    const ctx = await setupIntern(-30);
    await mark(ctx, 'entrada');

    const notification = await prisma.notification.findFirst({ where: { type: 'TARDANZA_REGISTRADA' } });
    expect(notification).not.toBeNull();
    expect(notification?.severity).toBe('ADVERTENCIA');
  });
});

describe('Caso 5 - Fuera de la geocerca', () => {
  it('rechaza una marcación a 200 metros de la sede', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { point: pointAtMeters(SEDE_LIMA, 200) });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FUERA_DE_GEOCERCA');
    expect(res.body.error.meta.distanceMeters).toBeGreaterThan(190);
    expect(res.body.error.meta.radiusMeters).toBe(50);
    expect(await prisma.attendanceMark.count()).toBe(0);
  });

  it('levanta alerta y notifica al administrador de inmediato', async () => {
    const ctx = await setupIntern(5);
    await mark(ctx, 'entrada', { point: pointAtMeters(SEDE_LIMA, 200) });

    const event = await prisma.securityEvent.findFirst({ where: { type: 'FUERA_DE_GEOCERCA' } });
    expect(event).not.toBeNull();
    expect(Number(event?.distanceMeters)).toBeGreaterThan(190);

    const notification = await prisma.notification.findFirst({ where: { type: 'FUERA_DE_GEOCERCA' } });
    expect(notification).not.toBeNull();
  });
});

describe('Caso 6 - Limite cercano a 50 metros', () => {
  it('acepta a 45 metros del centro', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { point: pointAtMeters(SEDE_LIMA, 45) });

    expect(res.status).toBe(201);
    expect(res.body.distanceMeters).toBeGreaterThan(43);
    expect(res.body.distanceMeters).toBeLessThan(47);
  });

  it('rechaza a 55 metros del centro', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { point: pointAtMeters(SEDE_LIMA, 55) });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FUERA_DE_GEOCERCA');
  });

  it('respeta un radio ampliado administrativamente', async () => {
    const ctx = await setupIntern(5, { radiusMeters: 150 });
    const res = await mark(ctx, 'entrada', { point: pointAtMeters(SEDE_LIMA, 120) });

    expect(res.status).toBe(201);
  });
});

describe('Caso 7 - GPS impreciso', () => {
  it('rechaza una lectura con precisión de 80 metros', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { accuracy: 80 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('GPS_IMPRECISO');
    expect(res.body.error.meta.maxAccuracyMeters).toBe(35);
    expect(await prisma.attendanceMark.count()).toBe(0);
  });

  it('acepta justo en el umbral de 35 metros', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { accuracy: 35 });
    expect(res.status).toBe(201);
  });

  it('rechaza una lectura demasiado antigua', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { locationAgeMs: 300_000 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('GPS_OBSOLETO');
  });
});

describe('Caso 8 - Ubicación simulada', () => {
  it('rechaza la marcación y la clasifica como incidente critico', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { mock: true });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UBICACION_SIMULADA');

    const event = await prisma.securityEvent.findFirst({ where: { type: 'UBICACION_SIMULADA' } });
    expect(event?.severity).toBe('CRITICO');
    expect(await prisma.attendanceMark.count()).toBe(0);
  });

  it('la ubicación simulada prevalece sobre cualquier otra validación', async () => {
    const ctx = await setupIntern(5);
    // Coordenadas perfectas, precision perfecta, pero simulada.
    const res = await mark(ctx, 'entrada', { mock: true, accuracy: 3 });
    expect(res.body.error.code).toBe('UBICACION_SIMULADA');
  });
});

describe('Caso 9 - Cámara cancelada o evidencia inválida', () => {
  it('rechaza la marcación sin fotografía', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { photo: null });

    expect(res.status).toBe(422);
    expect(await prisma.attendanceMark.count()).toBe(0);
  });

  it('rechaza un archivo que no es una imagen', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { photo: makeNotAnImage() });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('EVIDENCIA_INVALIDA');
    expect(await prisma.evidencePhoto.count()).toBe(0);
  });

  it('rechaza una imagen de resolución insuficiente para servir de evidencia', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { photo: makeJpeg(100, 100) });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('EVIDENCIA_INVALIDA');
  });
});

describe('Caso 11 - Dispositivo incorrecto', () => {
  it('rechaza la marcación desde un teléfono distinto al vinculado', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'entrada', { device: DEVICE_B });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DISPOSITIVO_NO_AUTORIZADO');
    expect(res.body.error.message).toContain('Solicite autorización al administrador');
    expect(await prisma.attendanceMark.count()).toBe(0);
  });
});

describe('Caso 13 - Entrada duplicada', () => {
  it('impide una segunda entrada el mismo día', async () => {
    const ctx = await setupIntern(5);

    const primera = await mark(ctx, 'entrada');
    expect(primera.status).toBe(201);

    const segunda = await mark(ctx, 'entrada');
    expect(segunda.status).toBe(409);
    expect(segunda.body.error.code).toBe('ENTRADA_DUPLICADA');
    expect(segunda.body.error.message).toBe('Ya registraste tu entrada de hoy.');

    expect(await prisma.attendanceMark.count({ where: { type: 'ENTRADA' } })).toBe(1);
  });

  it('la doble pulsacion con la misma clave de idempotencia no duplica', async () => {
    const ctx = await setupIntern(5);
    const key = 'clave-idempotente-0001';

    const a = await mark(ctx, 'entrada', { idempotencyKey: key });
    const b = await mark(ctx, 'entrada', { idempotencyKey: key });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.deduplicated).toBe(true);
    expect(b.body.markId).toBe(a.body.markId);
    // El reintento devuelve la hora real de la marcacion, no la programada.
    expect(b.body.localTime).toBe(a.body.localTime);
    expect(b.body.serverTime).toBe(a.body.serverTime);
    expect(await prisma.attendanceMark.count()).toBe(1);
  });
});

describe('Casos 14, 16 y 17 - Salida', () => {
  it('registra la salida después de la entrada y cierra la jornada', async () => {
    const ctx = await setupIntern(-10);
    await mark(ctx, 'entrada');

    const res = await mark(ctx, 'salida');
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('SALIDA');

    const day = await prisma.attendanceDay.findFirst({ where: { internId: ctx.intern.internId } });
    expect(day?.pendingExit).toBe(false);
  });

  it('caso 16 - impide una segunda salida', async () => {
    const ctx = await setupIntern(-10);
    await mark(ctx, 'entrada');
    await mark(ctx, 'salida');

    const res = await mark(ctx, 'salida');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SALIDA_DUPLICADA');
    expect(await prisma.attendanceMark.count({ where: { type: 'SALIDA' } })).toBe(1);
  });

  it('caso 17 - rechaza la salida fuera de la sede', async () => {
    const ctx = await setupIntern(-10);
    await mark(ctx, 'entrada');

    const res = await mark(ctx, 'salida', { point: pointAtMeters(SEDE_LIMA, 300) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FUERA_DE_GEOCERCA');

    const day = await prisma.attendanceDay.findFirst({ where: { internId: ctx.intern.internId } });
    expect(day?.pendingExit).toBe(true);
  });

  it('la salida no tiene permanencia mínima ni hora limite', async () => {
    const ctx = await setupIntern(-1);
    await mark(ctx, 'entrada');
    // Salida inmediata, sin esperar.
    const res = await mark(ctx, 'salida');
    expect(res.status).toBe(201);
  });
});

describe('Caso 15 - Salida sin entrada', () => {
  it('rechaza la salida cuando no hay entrada registrada', async () => {
    const ctx = await setupIntern(5);
    const res = await mark(ctx, 'salida');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SALIDA_SIN_ENTRADA');

    const event = await prisma.securityEvent.findFirst({ where: { type: 'SALIDA_SIN_ENTRADA' } });
    expect(event).not.toBeNull();
  });

  it('la base de datos también lo impide: el trigger rechaza la insercion directa', async () => {
    const ctx = await setupIntern(5);

    // Se crea una jornada y una evidencia a mano, saltandose la logica de negocio.
    const day = await prisma.attendanceDay.create({
      data: {
        internId: ctx.intern.internId,
        siteId: ctx.site.id,
        businessDate: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'),
        status: 'PROGRAMADO',
      },
    });
    const evidence = await prisma.evidencePhoto.create({
      data: {
        internId: ctx.intern.internId,
        kind: 'MARCACION_SALIDA',
        storageKey: 'prueba/salida-sin-entrada.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        sha256: 'a'.repeat(64),
      },
    });

    await expect(
      prisma.attendanceMark.create({
        data: {
          attendanceDayId: day.id,
          type: 'SALIDA',
          serverTime: new Date(),
          latitude: ctx.site.latitude,
          longitude: ctx.site.longitude,
          accuracyMeters: 5,
          distanceMeters: 0,
          evidenceId: evidence.id,
        },
      }),
    ).rejects.toThrow(/SALIDA_SIN_ENTRADA/);
  });
});

describe('Caso 24 - Concurrencia', () => {
  it('dos entradas simultaneas solo producen una marcación', async () => {
    const ctx = await setupIntern(5);

    const [a, b] = await Promise.all([mark(ctx, 'entrada'), mark(ctx, 'entrada')]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.attendanceMark.count({ where: { type: 'ENTRADA' } })).toBe(1);
    expect(await prisma.attendanceDay.count()).toBe(1);
  });

  it('cinco intentos simultaneos siguen produciendo una sola marcación', async () => {
    const ctx = await setupIntern(5);

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => mark(ctx, 'entrada')));
    const exitosas = results.filter((r) => r.status === 201);

    expect(exitosas).toHaveLength(1);
    expect(await prisma.attendanceMark.count()).toBe(1);
  });

  it('no deja evidencias huerfanas cuando la marcación se rechaza por carrera', async () => {
    const ctx = await setupIntern(5);
    await Promise.all([1, 2, 3].map(() => mark(ctx, 'entrada')));

    // Una sola evidencia: las de los intentos perdedores se descartan.
    expect(await prisma.evidencePhoto.count()).toBe(1);
  });
});

describe('Incidentes detectados en el teléfono', () => {
  it('la ubicación simulada detectada por la app queda registrada como critica y se notifica', async () => {
    const ctx = await setupIntern(5);

    const res = await request(app)
      .post('/api/v1/asistencia/incidente')
      .set('authorization', 'Bearer ' + ctx.token)
      .set(deviceHeaders(DEVICE_A))
      .send({ tipo: 'UBICACION_SIMULADA', tipoMarcacion: 'ENTRADA', latitude: -12.05, longitude: -77.04, accuracyMeters: 3 });

    expect(res.status).toBe(202);

    const evento = await prisma.securityEvent.findFirst({ where: { type: 'UBICACION_SIMULADA' } });
    expect(evento?.severity).toBe('CRITICO');
    expect(evento?.internId).toBe(ctx.intern.internId);
    expect((evento?.details as Record<string, unknown>).origen).toBe('telefono');

    const aviso = await prisma.notification.findFirst({ where: { type: 'UBICACION_SIMULADA' } });
    expect(aviso).not.toBeNull();

    // Un incidente nunca crea asistencia.
    expect(await prisma.attendanceDay.count()).toBe(0);
  });

  it('el GPS sin precisión suficiente queda registrado como informativo', async () => {
    const ctx = await setupIntern(5);

    const res = await request(app)
      .post('/api/v1/asistencia/incidente')
      .set('authorization', 'Bearer ' + ctx.token)
      .set(deviceHeaders(DEVICE_A))
      .send({ tipo: 'GPS_IMPRECISO', tipoMarcacion: 'ENTRADA', accuracyMeters: 200, intentos: 3 });

    expect(res.status).toBe(202);
    const evento = await prisma.securityEvent.findFirst({ where: { type: 'GPS_IMPRECISO' } });
    expect(evento?.severity).toBe('INFO');
    expect(evento?.message).toContain('200 m');
  });

  it('el intento fuera del radio queda registrado aunque la app lo corte antes de enviar', async () => {
    const ctx = await setupIntern(5);

    const lejos = pointAtMeters(ctx.site, 2000);
    const res = await request(app)
      .post('/api/v1/asistencia/incidente')
      .set('authorization', 'Bearer ' + ctx.token)
      .set(deviceHeaders(DEVICE_A))
      .send({
        tipo: 'FUERA_DE_GEOCERCA',
        tipoMarcacion: 'ENTRADA',
        latitude: lejos.latitude,
        longitude: lejos.longitude,
        accuracyMeters: 12,
      });

    expect(res.status).toBe(202);

    const evento = await prisma.securityEvent.findFirst({ where: { type: 'FUERA_DE_GEOCERCA' } });
    expect(evento?.internId).toBe(ctx.intern.internId);
    // La distancia es la que calcula el servidor con las coordenadas recibidas.
    expect(Number(evento?.distanceMeters)).toBeGreaterThan(1900);
    expect(evento?.message).toMatch(/a 19\d\d m|a 20\d\d m/);
    expect((evento?.details as Record<string, unknown>).origen).toBe('telefono');

    // El administrador se entera, y no se crea ninguna asistencia.
    expect(await prisma.notification.count({ where: { type: 'FUERA_DE_GEOCERCA' } })).toBe(1);
    expect(await prisma.attendanceDay.count()).toBe(0);
  });

  it('la distancia del aviso la recalcula el servidor, no la cree del teléfono', async () => {
    const ctx = await setupIntern(5);
    const lejos = pointAtMeters(ctx.site, 2000);

    const res = await request(app)
      .post('/api/v1/asistencia/incidente')
      .set('authorization', 'Bearer ' + ctx.token)
      .set(deviceHeaders(DEVICE_A))
      .send({
        tipo: 'FUERA_DE_GEOCERCA',
        tipoMarcacion: 'ENTRADA',
        latitude: lejos.latitude,
        longitude: lejos.longitude,
        accuracyMeters: 8,
        // El telefono miente: dice estar a 5 m de la sede.
        distanceMeters: 5,
      });

    expect(res.status).toBe(202);

    const evento = await prisma.securityEvent.findFirst({ where: { type: 'FUERA_DE_GEOCERCA' } });
    expect(Number(evento?.distanceMeters)).toBeGreaterThan(1900);
    expect(evento?.message).not.toContain('a 5 m');
    // Lo que dijo el telefono se conserva aparte, como dato del incidente.
    expect((evento?.details as Record<string, unknown>).distanciaInformadaPorElTelefono).toBe(5);
  });

  it('avisar de muchos intentos rechazados no consume el cupo para marcar', async () => {
    const ctx = await setupIntern(5);

    // Alguien peleando con un GPS malo fuera de la sede: un aviso por intento,
    // mas que el cupo de marcaciones (20 en 5 minutos).
    for (let i = 0; i < 21; i++) {
      const aviso = await request(app)
        .post('/api/v1/asistencia/incidente')
        .set('authorization', 'Bearer ' + ctx.token)
        .set(deviceHeaders(DEVICE_A))
        .send({ tipo: 'GPS_IMPRECISO', tipoMarcacion: 'ENTRADA', accuracyMeters: 180, intentos: 3 });
      expect(aviso.status, 'aviso numero ' + (i + 1)).toBe(202);
    }

    // Y cuando por fin entra a la sede con una lectura buena, puede marcar.
    const entrada = await mark(ctx, 'entrada');
    expect(entrada.status).toBe(201);
  });

  it('se rechaza desde un teléfono que no es el vinculado', async () => {
    const ctx = await setupIntern(5);
    const res = await request(app)
      .post('/api/v1/asistencia/incidente')
      .set('authorization', 'Bearer ' + ctx.token)
      .set(deviceHeaders(DEVICE_B))
      .send({ tipo: 'UBICACION_SIMULADA', tipoMarcacion: 'ENTRADA' });

    expect(res.status).toBe(401);
    expect(await prisma.securityEvent.count({ where: { type: 'UBICACION_SIMULADA' } })).toBe(0);
  });

  it('rechaza tipos de incidente no previstos', async () => {
    const ctx = await setupIntern(5);
    const res = await request(app)
      .post('/api/v1/asistencia/incidente')
      .set('authorization', 'Bearer ' + ctx.token)
      .set(deviceHeaders(DEVICE_A))
      .send({ tipo: 'CUALQUIER_COSA', tipoMarcacion: 'ENTRADA' });

    expect(res.status).toBe(422);
  });
});

describe('Marcación desde un teléfono que no es el vinculado', () => {
  it('queda como evento crítico con aviso al administrador, y no crea asistencia', async () => {
    const ctx = await setupIntern(5);

    // Token valido, telefono distinto: la señal de una credencial robada.
    const res = await mark(ctx, 'entrada', { device: DEVICE_B });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DISPOSITIVO_NO_AUTORIZADO');

    const evento = await prisma.securityEvent.findFirst({ where: { type: 'DISPOSITIVO_NO_AUTORIZADO' } });
    expect(evento).not.toBeNull();
    expect(evento?.severity).toBe('CRITICO');
    expect(evento?.userId).toBe(ctx.intern.userId);
    expect((evento?.details as Record<string, unknown>).ruta).toBe('/api/v1/asistencia/entrada');

    expect(await prisma.notification.count({ where: { type: 'DISPOSITIVO_NO_AUTORIZADO' } })).toBe(1);
    expect(await prisma.attendanceDay.count()).toBe(0);
  });

  it('sin encabezado de dispositivo también queda registrado', async () => {
    const ctx = await setupIntern(5);

    const res = await request(app)
      .post('/api/v1/asistencia/entrada')
      .set('authorization', 'Bearer ' + ctx.token)
      .field('latitude', String(ctx.site.latitude))
      .field('longitude', String(ctx.site.longitude))
      .field('accuracyMeters', '5')
      .attach('foto', makeJpeg(), { filename: 'e.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(401);
    const evento = await prisma.securityEvent.findFirst({ where: { type: 'DISPOSITIVO_NO_AUTORIZADO' } });
    expect(evento?.message).toContain('sin identificar el teléfono');
  });
});

describe('Estado del día', () => {
  it('indica que aún no puede marcar y a partir de que hora podra', async () => {
    const ctx = await setupIntern(40);

    const res = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + ctx.token)
      .set(deviceHeaders(DEVICE_A));

    expect(res.status).toBe(200);
    expect(res.body.actions.canCheckIn).toBe(false);
    expect(res.body.actions.checkInOpensAt).toMatch(/^\d{2}:\d{2}$/);
    expect(res.body.gpsRequirements.maxAccuracyMeters).toBe(35);
  });

  it('tras la entrada habilita la salida', async () => {
    const ctx = await setupIntern(-5);
    await mark(ctx, 'entrada');

    const res = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + ctx.token)
      .set(deviceHeaders(DEVICE_A));

    expect(res.body.actions.canCheckIn).toBe(false);
    expect(res.body.actions.canCheckOut).toBe(true);
    expect(res.body.checkIn).not.toBeNull();
  });

  it('un día sin horario no habilita marcación', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: null });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const res = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + session.accessToken)
      .set(deviceHeaders(DEVICE_A));

    expect(res.body.schedule.hasSchedule).toBe(false);
    expect(res.body.actions.canCheckIn).toBe(false);
  });
});
