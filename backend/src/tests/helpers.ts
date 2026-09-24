/**
 * Utilidades compartidas por las pruebas de integracion.
 */
import type { Express } from 'express';
import request from 'supertest';
import { prisma } from '../infra/db/prisma.js';
import { hashPassword } from '../core/crypto.js';
import { dateOnlyValue, businessDateString } from '../core/time.js';

export const SEDE_LIMA = { latitude: -12.046374, longitude: -77.042793 };
/** Grados de latitud por metro, para construir puntos a distancias conocidas. */
export const DEG_PER_METER = 1 / 111_194.9266;

/** Punto desplazado N metros al norte del centro indicado. */
export function pointAtMeters(center: { latitude: number; longitude: number }, meters: number) {
  return { latitude: center.latitude + meters * DEG_PER_METER, longitude: center.longitude };
}

/**
 * Fotografia sintetica para las pruebas.
 *
 * Construye un JPEG con cabecera SOI + APP0 + SOF0 real, que es exactamente lo
 * que inspecciona el validador del servidor (firma binaria y dimensiones). No
 * contiene datos de imagen porque ninguna parte del sistema decodifica pixeles.
 */
export function makeJpeg(width = 640, height = 480): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0); // SOF0
  sof.writeUInt16BE(17, 2); // longitud del segmento
  sof.writeUInt8(8, 4); // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(3, 9); // componentes
  // Tres componentes: id, muestreo, tabla de cuantizacion.
  sof.writeUInt8(1, 10); sof.writeUInt8(0x22, 11); sof.writeUInt8(0, 12);
  sof.writeUInt8(2, 13); sof.writeUInt8(0x11, 14); sof.writeUInt8(1, 15);
  sof.writeUInt8(3, 16); sof.writeUInt8(0x11, 17); sof.writeUInt8(1, 18);

  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);

  // Relleno para que el archivo tenga un tamano verosimil.
  const payload = Buffer.alloc(2048, 0x5a);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    app0,
    sof,
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), // SOS
    payload,
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

/** Archivo que no es una imagen: sirve para probar el rechazo de evidencia. */
export function makeNotAnImage(): Buffer {
  return Buffer.from('Esto no es una imagen, es texto plano disfrazado.', 'utf8');
}

// ---------------------------------------------------------------------------
// Limpieza entre pruebas
// ---------------------------------------------------------------------------

/**
 * Vacia las tablas respetando el orden de dependencias.
 * Se usa TRUNCATE ... CASCADE por velocidad; RESTART IDENTITY no hace falta
 * porque todas las claves son UUID.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_log", "regularization", "attendance_mark", "attendance_day",
      "evidence_photo", "notification_delivery", "notification", "security_event",
      "schedule_entry", "device_change_authorization", "device_binding",
      "push_token", "session", "archive_batch", "job_run", "intern",
      "site", "user_account", "app_setting"
    RESTART IDENTITY CASCADE;
  `);
}

// ---------------------------------------------------------------------------
// Factorias
// ---------------------------------------------------------------------------

export interface CreatedSite {
  id: string;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  timezone: string;
}

export async function createSite(overrides: Partial<CreatedSite> = {}): Promise<CreatedSite> {
  const code = overrides.code ?? 'SEDE' + Math.floor(Math.random() * 100000);
  const site = await prisma.site.create({
    data: {
      code,
      name: overrides.name ?? 'Sede de prueba ' + code,
      address: 'Av. Siempre Viva 742',
      latitude: overrides.latitude ?? SEDE_LIMA.latitude,
      longitude: overrides.longitude ?? SEDE_LIMA.longitude,
      radiusMeters: overrides.radiusMeters ?? 50,
      timezone: overrides.timezone ?? TEST_TIMEZONE,
      active: true,
    },
  });
  return {
    id: site.id,
    code: site.code,
    name: site.name,
    latitude: Number(site.latitude),
    longitude: Number(site.longitude),
    radiusMeters: site.radiusMeters,
    timezone: site.timezone,
  };
}

export interface CreatedIntern {
  internId: string;
  userId: string;
  dni: string;
  password: string;
  siteId: string;
}

let dniCounter = 10000000;

export async function createIntern(params: {
  siteId: string;
  dni?: string;
  password?: string;
  /** Horario para todos los dias de la semana, en minutos desde medianoche. */
  startMinute?: number | null;
  mustChangePassword?: boolean;
  active?: boolean;
}): Promise<CreatedIntern> {
  const dni = params.dni ?? String(dniCounter++);
  const password = params.password ?? 'Practica2026';

  const user = await prisma.userAccount.create({
    data: {
      dni,
      passwordHash: await hashPassword(password),
      role: 'PRACTICANTE',
      status: params.active === false ? 'INACTIVO' : 'ACTIVO',
      mustChangePassword: params.mustChangePassword ?? false,
      displayName: 'Practicante ' + dni,
    },
  });

  const intern = await prisma.intern.create({
    data: {
      userId: user.id,
      dni,
      firstNames: 'Nombre' + dni.slice(-3),
      lastNames: 'Apellido' + dni.slice(-3),
      siteId: params.siteId,
      areaGroup: 'Aula A',
      active: params.active !== false,
      consentAcceptedAt: new Date(),
      consentPolicyVersion: '1.0',
    },
  });

  if (params.startMinute !== null && params.startMinute !== undefined) {
    await prisma.scheduleEntry.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        internId: intern.id,
        weekday,
        startMinute: params.startMinute as number,
        endMinute: Math.min(1439, (params.startMinute as number) + 480),
        effectiveFrom: dateOnlyValue('2020-01-01'),
      })),
    });
  }

  return { internId: intern.id, userId: user.id, dni, password, siteId: params.siteId };
}

export async function createAdmin(params: { dni?: string; password?: string } = {}) {
  const dni = params.dni ?? String(dniCounter++);
  const password = params.password ?? 'Administra2026';
  const user = await prisma.userAccount.create({
    data: {
      dni,
      passwordHash: await hashPassword(password),
      role: 'ADMINISTRADOR',
      status: 'ACTIVO',
      mustChangePassword: false,
      displayName: 'Administrador ' + dni,
      email: 'admin' + dni + '@ejemplo.com',
    },
  });
  return { userId: user.id, dni, password };
}

// ---------------------------------------------------------------------------
// Sesion
// ---------------------------------------------------------------------------

export const DEVICE_A = 'dispositivo-prueba-aaaa-0000000000001';
export const DEVICE_B = 'dispositivo-prueba-bbbb-0000000000002';

export function deviceHeaders(fingerprint: string): Record<string, string> {
  return {
    'x-device-id': fingerprint,
    'x-device-platform': 'android',
    'x-device-model': 'Pixel Prueba',
    'x-device-os': 'Android 14',
    'x-app-version': '1.0.0',
  };
}

export async function loginAs(
  app: Express,
  dni: string,
  password: string,
  fingerprint?: string,
): Promise<{ accessToken: string; refreshToken: string; body: Record<string, unknown> }> {
  const req = request(app).post('/api/v1/auth/login').send({ dni, password });
  if (fingerprint) req.set(deviceHeaders(fingerprint));

  const res = await req;
  if (res.status !== 200) {
    throw new Error('Login fallido (' + res.status + '): ' + JSON.stringify(res.body));
  }
  return {
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
    body: res.body,
  };
}

/**
 * Zona horaria en la que la hora local actual cae en mitad de la jornada.
 *
 * Las pruebas construyen horarios relativos a "ahora" (por ejemplo, entrada
 * programada hace 60 minutos). Si la suite se ejecuta de madrugada, ese calculo
 * se saldria del dia y las pruebas fallarian por la hora del reloj y no por un
 * defecto del sistema. Elegir una zona donde ahora mismo sean las 09:00-18:00
 * hace la suite reproducible a cualquier hora, sin falsear el reloj.
 */
export function midDayTimezone(): string {
  const candidatas = [
    'America/Lima',
    'America/Sao_Paulo',
    'Atlantic/Azores',
    'Europe/Madrid',
    'Europe/Moscow',
    'Asia/Karachi',
    'Asia/Dhaka',
    'Asia/Bangkok',
    'Asia/Tokyo',
    'Australia/Brisbane',
    'Pacific/Auckland',
    'Pacific/Kiritimati',
    'America/Anchorage',
    'America/Los_Angeles',
    'America/Chicago',
  ];
  const now = new Date();
  for (const tz of candidatas) {
    const hora = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(now),
    );
    if (hora >= 9 && hora <= 18) return tz;
  }
  return 'America/Lima';
}

export const TEST_TIMEZONE = midDayTimezone();

/** Fija la hora del horario de forma que "ahora" caiga donde la prueba necesita. */
export function minutesFromNowInSite(offsetMinutes: number, timezone = TEST_TIMEZONE): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const current = h * 60 + m;
  // Se mantiene dentro del dia para no cruzar la medianoche durante la prueba.
  return Math.min(1439, Math.max(0, current + offsetMinutes));
}

export function todayInSite(timezone = TEST_TIMEZONE): string {
  return businessDateString(new Date(), timezone);
}
