/**
 * Consultas de asistencia: estado del dia, historial, tableros.
 *
 * Todas las cifras del tablero se calculan sobre `attendance_day` y
 * `attendance_mark`, que contienen exclusivamente marcaciones VALIDAS. Los
 * intentos rechazados viven en `security_event` y se cuentan aparte, para que
 * nunca inflen los indicadores de asistencia.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';
import {
  businessDateString,
  dateOnlyValue,
  dateOnlyString,
  minutesToHHmm,
  localMinutesOfDay,
  formatLocal,
} from '../../core/time.js';
import { getEffectiveSchedule } from '../schedules/schedule.service.js';
import { getSettings } from '../settings/settings.service.js';
import { evaluateCheckInWindow } from '../../domain/attendance-rules.js';

// ---------------------------------------------------------------------------
// Estado del dia para la aplicacion del practicante
// ---------------------------------------------------------------------------

export interface TodayStatus {
  businessDate: string;
  serverTime: string;
  localTime: string;
  timezone: string;
  site: { id: string; name: string; code: string; latitude: number; longitude: number; radiusMeters: number };
  schedule: { startTime: string | null; endTime: string | null; hasSchedule: boolean };
  checkIn: MarkSummary | null;
  checkOut: MarkSummary | null;
  status: string;
  punctuality: 'PUNTUAL' | 'TARDANZA' | null;
  lateMinutes: number;
  pendingExit: boolean;
  /** Que puede hacer el practicante ahora mismo y por que. */
  actions: {
    canCheckIn: boolean;
    canCheckOut: boolean;
    checkInOpensAt: string | null;
    reason: string | null;
  };
  gpsRequirements: { maxAccuracyMeters: number; maxAgeSeconds: number };
}

export interface MarkSummary {
  id: string;
  time: string;
  localTime: string;
  distanceMeters: number;
  accuracyMeters: number;
  latitude: number;
  longitude: number;
  evidenceId: string;
}

export async function getTodayStatus(internId: string): Promise<TodayStatus> {
  const intern = await prisma.intern.findUnique({ where: { id: internId }, include: { site: true } });
  if (!intern) throw errors.notFound('Practicante');

  const settings = await getSettings();
  const serverTime = new Date();
  const timezone = intern.site.timezone;
  const businessDate = businessDateString(serverTime, timezone);
  const nowMinutes = localMinutesOfDay(serverTime, timezone);

  const [schedule, day] = await Promise.all([
    getEffectiveSchedule(internId, businessDate),
    prisma.attendanceDay.findUnique({
      where: { uq_attendance_day_intern_date: { internId, businessDate: dateOnlyValue(businessDate) } },
      include: { marks: { orderBy: { serverTime: 'asc' } } },
    }),
  ]);

  const checkInMark = day?.marks.find((m) => m.type === 'ENTRADA') ?? null;
  const checkOutMark = day?.marks.find((m) => m.type === 'SALIDA') ?? null;

  let canCheckIn = false;
  let canCheckOut = false;
  let checkInOpensAt: string | null = null;
  let reason: string | null = null;

  if (!schedule) {
    reason = 'Hoy no tiene una jornada programada.';
  } else if (checkInMark) {
    checkInOpensAt = minutesToHHmm(schedule.startMinute - settings.checkinEarlyWindowMinutes);
    if (checkOutMark) {
      reason = 'Ya registraste tu entrada y tu salida de hoy.';
    } else {
      canCheckOut = true;
      reason = null;
    }
  } else {
    const decision = evaluateCheckInWindow({
      nowMinutes,
      scheduledStartMinute: schedule.startMinute,
      earlyWindowMinutes: settings.checkinEarlyWindowMinutes,
    });
    checkInOpensAt = minutesToHHmm(decision.opensAtMinute);
    if (decision.allowed) {
      canCheckIn = true;
      reason =
        decision.punctuality === 'TARDANZA'
          ? 'Tu entrada se registrará como TARDANZA (' + decision.lateMinutes + ' min).'
          : null;
    } else {
      reason = 'Podrás marcar entrada a partir de las ' + checkInOpensAt + '.';
    }
  }

  return {
    businessDate,
    serverTime: serverTime.toISOString(),
    localTime: formatLocal(serverTime, timezone, 'HH:mm:ss'),
    timezone,
    site: {
      id: intern.site.id,
      name: intern.site.name,
      code: intern.site.code,
      latitude: Number(intern.site.latitude),
      longitude: Number(intern.site.longitude),
      radiusMeters: intern.site.radiusMeters,
    },
    schedule: {
      startTime: schedule ? minutesToHHmm(schedule.startMinute) : null,
      endTime: schedule ? minutesToHHmm(schedule.endMinute) : null,
      hasSchedule: Boolean(schedule),
    },
    checkIn: checkInMark ? toMarkSummary(checkInMark, timezone) : null,
    checkOut: checkOutMark ? toMarkSummary(checkOutMark, timezone) : null,
    status: day?.status ?? (schedule ? 'PROGRAMADO' : 'NO_LABORABLE'),
    punctuality: day?.punctuality ?? null,
    lateMinutes: day?.lateMinutes ?? 0,
    pendingExit: day?.pendingExit ?? false,
    actions: { canCheckIn, canCheckOut, checkInOpensAt, reason },
    gpsRequirements: {
      maxAccuracyMeters: Math.min(settings.gpsMaxAccuracyMeters, Math.max(10, Math.round(intern.site.radiusMeters * 0.7))),
      maxAgeSeconds: settings.gpsMaxAgeSeconds,
    },
  };
}

type MarkRow = Prisma.AttendanceMarkGetPayload<object>;

function toMarkSummary(mark: MarkRow, timezone: string): MarkSummary {
  return {
    id: mark.id,
    time: mark.serverTime.toISOString(),
    localTime: formatLocal(mark.serverTime, timezone, 'HH:mm'),
    distanceMeters: Number(mark.distanceMeters),
    accuracyMeters: Number(mark.accuracyMeters),
    latitude: Number(mark.latitude),
    longitude: Number(mark.longitude),
    evidenceId: mark.evidenceId,
  };
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

export interface AttendanceHistoryQuery {
  internId?: string;
  siteId?: string;
  from: string;
  to: string;
  status?: string;
  punctuality?: string;
  pendingExitOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export async function queryAttendance(q: AttendanceHistoryQuery) {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, q.pageSize ?? 50));

  const where = buildWhere(q);

  const [total, rows] = await Promise.all([
    prisma.attendanceDay.count({ where }),
    prisma.attendanceDay.findMany({
      where,
      orderBy: [{ businessDate: 'desc' }, { internId: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        intern: { select: { id: true, dni: true, firstNames: true, lastNames: true, areaGroup: true } },
        site: { select: { id: true, code: true, name: true, timezone: true } },
        marks: { orderBy: { serverTime: 'asc' } },
        regularizations: {
          orderBy: { createdAt: 'desc' },
          include: { admin: { select: { id: true, displayName: true } } },
        },
      },
    }),
  ]);

  return { total, page, pageSize, items: rows.map(serializeDay) };
}

function buildWhere(q: AttendanceHistoryQuery): Prisma.AttendanceDayWhereInput {
  const where: Prisma.AttendanceDayWhereInput = {
    businessDate: { gte: dateOnlyValue(q.from), lte: dateOnlyValue(q.to) },
  };
  if (q.internId) where.internId = q.internId;
  if (q.siteId) where.siteId = q.siteId;
  if (q.status) where.status = q.status as Prisma.EnumAttendanceDayStatusFilter['equals'];
  if (q.punctuality) where.punctuality = q.punctuality as Prisma.EnumPunctualityNullableFilter['equals'];
  if (q.pendingExitOnly) where.pendingExit = true;
  return where;
}

type DayRow = Prisma.AttendanceDayGetPayload<{
  include: {
    intern: { select: { id: true; dni: true; firstNames: true; lastNames: true; areaGroup: true } };
    site: { select: { id: true; code: true; name: true; timezone: true } };
    marks: true;
    regularizations: { include: { admin: { select: { id: true; displayName: true } } } };
  };
}>;

export function serializeDay(day: DayRow) {
  const tz = day.site.timezone;
  const checkIn = day.marks.find((m) => m.type === 'ENTRADA') ?? null;
  const checkOut = day.marks.find((m) => m.type === 'SALIDA') ?? null;

  return {
    id: day.id,
    businessDate: dateOnlyString(day.businessDate),
    intern: {
      id: day.intern.id,
      dni: day.intern.dni,
      fullName: day.intern.lastNames + ', ' + day.intern.firstNames,
      firstNames: day.intern.firstNames,
      lastNames: day.intern.lastNames,
      areaGroup: day.intern.areaGroup,
    },
    site: { id: day.site.id, code: day.site.code, name: day.site.name },
    scheduledStartTime: minutesToHHmm(day.scheduledStartMinute),
    scheduledEndTime: minutesToHHmm(day.scheduledEndMinute),
    status: day.status,
    punctuality: day.punctuality,
    lateMinutes: day.lateMinutes,
    pendingExit: day.pendingExit,
    regularized: day.regularized,
    archived: Boolean(day.archivedAt),
    checkIn: checkIn ? toMarkSummary(checkIn, tz) : null,
    checkOut: checkOut ? toMarkSummary(checkOut, tz) : null,
    workedMinutes:
      checkIn && checkOut ? Math.round((checkOut.serverTime.getTime() - checkIn.serverTime.getTime()) / 60000) : null,
    regularizations: day.regularizations.map((r) => ({
      id: r.id,
      field: r.field,
      oldValue: r.oldValue,
      newValue: r.newValue,
      reason: r.reason,
      admin: r.admin.displayName,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function getAttendanceDay(attendanceDayId: string) {
  const day = await prisma.attendanceDay.findUnique({
    where: { id: attendanceDayId },
    include: {
      intern: { select: { id: true, dni: true, firstNames: true, lastNames: true, areaGroup: true } },
      site: { select: { id: true, code: true, name: true, timezone: true } },
      marks: { orderBy: { serverTime: 'asc' } },
      regularizations: { orderBy: { createdAt: 'desc' }, include: { admin: { select: { id: true, displayName: true } } } },
    },
  });
  if (!day) throw errors.notFound('Jornada');

  const site = await prisma.site.findUnique({
    where: { id: day.siteId },
    select: { latitude: true, longitude: true, radiusMeters: true },
  });

  return {
    ...serializeDay(day),
    // Datos necesarios para dibujar el mapa de la marcacion.
    siteGeo: site
      ? { latitude: Number(site.latitude), longitude: Number(site.longitude), radiusMeters: site.radiusMeters }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Tablero
// ---------------------------------------------------------------------------

export interface DashboardQuery {
  date: string;
  siteId?: string;
}

export interface SiteBoard {
  siteId: string;
  siteCode: string;
  siteName: string;
  total: number;
  presentes: number;
  puntuales: number;
  tardanzas: number;
  ausentes: number;
  salidas: number;
  todaviaDentro: number;
  salidasPendientes: number;
  sinJornada: number;
  alertas: number;
}

export async function getDashboard(q: DashboardQuery) {
  const date = dateOnlyValue(q.date);
  const siteFilter: Prisma.SiteWhereInput = q.siteId ? { id: q.siteId, active: true } : { active: true };

  const sites = await prisma.site.findMany({
    where: siteFilter,
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true, timezone: true },
  });
  const siteIds = sites.map((s) => s.id);

  const [days, internCounts, events] = await Promise.all([
    prisma.attendanceDay.findMany({
      where: { businessDate: date, siteId: { in: siteIds } },
      select: {
        siteId: true,
        status: true,
        punctuality: true,
        pendingExit: true,
        marks: { select: { type: true } },
      },
    }),
    prisma.intern.groupBy({
      by: ['siteId'],
      where: { siteId: { in: siteIds }, active: true },
      _count: { _all: true },
    }),
    prisma.securityEvent.groupBy({
      by: ['siteId'],
      where: {
        siteId: { in: siteIds },
        acknowledgedAt: null,
        createdAt: { gte: startOfDayUtc(q.date), lte: endOfDayUtc(q.date) },
      },
      _count: { _all: true },
    }),
  ]);

  const internsBySite = new Map(internCounts.map((c) => [c.siteId, c._count._all]));
  const alertsBySite = new Map(events.map((c) => [c.siteId ?? '', c._count._all]));

  const boards: SiteBoard[] = sites.map((site) => {
    const siteDays = days.filter((d) => d.siteId === site.id);
    const total = internsBySite.get(site.id) ?? 0;

    const presentes = siteDays.filter((d) => d.status === 'PRESENTE').length;
    const puntuales = siteDays.filter((d) => d.punctuality === 'PUNTUAL').length;
    const tardanzas = siteDays.filter((d) => d.punctuality === 'TARDANZA').length;
    const ausentes = siteDays.filter((d) => d.status === 'AUSENTE').length;
    const sinJornada = siteDays.filter((d) => d.status === 'NO_LABORABLE').length;
    const salidas = siteDays.filter((d) => d.marks.some((m) => m.type === 'SALIDA')).length;
    const todaviaDentro = siteDays.filter(
      (d) => d.status === 'PRESENTE' && !d.marks.some((m) => m.type === 'SALIDA'),
    ).length;
    const salidasPendientes = siteDays.filter((d) => d.pendingExit).length;

    return {
      siteId: site.id,
      siteCode: site.code,
      siteName: site.name,
      total,
      presentes,
      puntuales,
      tardanzas,
      ausentes,
      salidas,
      todaviaDentro,
      salidasPendientes,
      sinJornada,
      alertas: alertsBySite.get(site.id) ?? 0,
    };
  });

  const totals = boards.reduce(
    (acc, b) => ({
      total: acc.total + b.total,
      presentes: acc.presentes + b.presentes,
      puntuales: acc.puntuales + b.puntuales,
      tardanzas: acc.tardanzas + b.tardanzas,
      ausentes: acc.ausentes + b.ausentes,
      salidas: acc.salidas + b.salidas,
      todaviaDentro: acc.todaviaDentro + b.todaviaDentro,
      salidasPendientes: acc.salidasPendientes + b.salidasPendientes,
      sinJornada: acc.sinJornada + b.sinJornada,
      alertas: acc.alertas + b.alertas,
    }),
    {
      total: 0,
      presentes: 0,
      puntuales: 0,
      tardanzas: 0,
      ausentes: 0,
      salidas: 0,
      todaviaDentro: 0,
      salidasPendientes: 0,
      sinJornada: 0,
      alertas: 0,
    },
  );

  return { date: q.date, totals, sites: boards };
}

function startOfDayUtc(isoDate: string): Date {
  return new Date(isoDate + 'T00:00:00.000Z');
}
function endOfDayUtc(isoDate: string): Date {
  return new Date(isoDate + 'T23:59:59.999Z');
}

/** Ficha resumida de un practicante con sus indicadores del periodo. */
export async function getInternSummary(internId: string, from: string, to: string) {
  const days = await prisma.attendanceDay.findMany({
    where: { internId, businessDate: { gte: dateOnlyValue(from), lte: dateOnlyValue(to) } },
    select: { status: true, punctuality: true, pendingExit: true, lateMinutes: true },
  });

  const eventos = await prisma.securityEvent.count({
    where: { internId, createdAt: { gte: startOfDayUtc(from), lte: endOfDayUtc(to) } },
  });

  const jornadas = days.filter((d) => d.status !== 'NO_LABORABLE');
  const tardanzas = days.filter((d) => d.punctuality === 'TARDANZA');

  return {
    from,
    to,
    jornadasProgramadas: jornadas.length,
    presentes: days.filter((d) => d.status === 'PRESENTE').length,
    puntuales: days.filter((d) => d.punctuality === 'PUNTUAL').length,
    tardanzas: tardanzas.length,
    minutosTardanzaTotal: tardanzas.reduce((a, d) => a + d.lateMinutes, 0),
    ausentes: days.filter((d) => d.status === 'AUSENTE').length,
    salidasPendientes: days.filter((d) => d.pendingExit).length,
    eventosSeguridad: eventos,
    porcentajePuntualidad:
      jornadas.length > 0
        ? Math.round((days.filter((d) => d.punctuality === 'PUNTUAL').length / jornadas.length) * 1000) / 10
        : null,
  };
}
