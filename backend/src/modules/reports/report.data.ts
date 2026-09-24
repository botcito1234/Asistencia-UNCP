/**
 * Obtencion y agregacion de datos para reportes.
 *
 * Un unico lugar decide QUE datos incluye cada tipo de reporte. Los
 * generadores de Excel y PDF solo se ocupan del formato, de modo que ambos
 * muestran siempre exactamente la misma informacion.
 */
import { prisma } from '../../infra/db/prisma.js';
import { dateOnlyValue, dateOnlyString, minutesToHHmm, formatLocal, startOfLocalDay, endOfLocalDay } from '../../core/time.js';
import { config } from '../../config/env.js';
import { errors } from '../../core/errors.js';

export type ReportKind =
  | 'diario'
  | 'semanal'
  | 'mensual'
  | 'rango'
  | 'practicante'
  | 'sede'
  | 'consolidado'
  | 'puntualidad'
  | 'tardanzas'
  | 'faltas'
  | 'entradas'
  | 'salidas'
  | 'pendientes'
  | 'incidencias';

export interface ReportRequest {
  kind: ReportKind;
  from: string;
  to: string;
  siteId?: string | undefined;
  internId?: string | undefined;
}

export interface ReportColumn {
  key: string;
  header: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export interface ReportTotals {
  jornadas: number;
  presentes: number;
  puntuales: number;
  tardanzas: number;
  ausentes: number;
  salidasRegistradas: number;
  salidasPendientes: number;
  minutosTardanza: number;
  eventosSeguridad: number;
  porcentajePuntualidad: number | null;
}

export interface ReportData {
  kind: ReportKind;
  title: string;
  subtitle: string;
  from: string;
  to: string;
  generatedAt: string;
  scope: { siteName: string | null; internName: string | null };
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: ReportTotals | null;
  /** Resumen por sede; solo lo llenan los reportes consolidados. */
  bySite: { sede: string; jornadas: number; puntuales: number; tardanzas: number; ausentes: number; pendientes: number }[];
}

const TITLES: Record<ReportKind, string> = {
  diario: 'Reporte diario de asistencia',
  semanal: 'Reporte semanal de asistencia',
  mensual: 'Reporte mensual de asistencia',
  rango: 'Reporte de asistencia por rango',
  practicante: 'Reporte individual de practicante',
  sede: 'Reporte de asistencia por sede',
  consolidado: 'Consolidado general de asistencia',
  puntualidad: 'Reporte de puntualidad',
  tardanzas: 'Reporte de tardanzas',
  faltas: 'Reporte de faltas',
  entradas: 'Reporte de entradas registradas',
  salidas: 'Reporte de salidas registradas',
  pendientes: 'Reporte de salidas pendientes',
  incidencias: 'Reporte de incidencias de seguridad',
};

const ATTENDANCE_COLUMNS: ReportColumn[] = [
  { key: 'fecha', header: 'Fecha', width: 12 },
  { key: 'dni', header: 'DNI', width: 12 },
  { key: 'practicante', header: 'Practicante', width: 32 },
  { key: 'sede', header: 'Sede', width: 24 },
  { key: 'area', header: 'Área / Grupo', width: 18 },
  { key: 'programada', header: 'Entrada programada', width: 12, align: 'center' },
  { key: 'entrada', header: 'Entrada real', width: 12, align: 'center' },
  { key: 'salida', header: 'Salida real', width: 12, align: 'center' },
  { key: 'estado', header: 'Estado', width: 14, align: 'center' },
  { key: 'puntualidad', header: 'Puntualidad', width: 13, align: 'center' },
  { key: 'tardanzaMin', header: 'Tardanza (min)', width: 12, align: 'right' },
  { key: 'minutosTrabajados', header: 'Permanencia (min)', width: 14, align: 'right' },
  { key: 'distanciaEntrada', header: 'Distancia entrada (m)', width: 16, align: 'right' },
  { key: 'distanciaSalida', header: 'Distancia salida (m)', width: 16, align: 'right' },
  { key: 'pendiente', header: 'Salida pendiente', width: 14, align: 'center' },
  { key: 'regularizado', header: 'Regularizado', width: 12, align: 'center' },
];

const INCIDENT_COLUMNS: ReportColumn[] = [
  { key: 'fechaHora', header: 'Fecha y hora', width: 20 },
  { key: 'tipo', header: 'Tipo de evento', width: 26 },
  { key: 'severidad', header: 'Severidad', width: 12, align: 'center' },
  { key: 'dni', header: 'DNI', width: 12 },
  { key: 'practicante', header: 'Practicante', width: 30 },
  { key: 'sede', header: 'Sede', width: 22 },
  { key: 'distancia', header: 'Distancia (m)', width: 12, align: 'right' },
  { key: 'precision', header: 'Precisión (m)', width: 12, align: 'right' },
  { key: 'mensaje', header: 'Detalle', width: 52 },
  { key: 'atendido', header: 'Atendido', width: 10, align: 'center' },
];

export async function buildReport(request: ReportRequest): Promise<ReportData> {
  if (request.from > request.to) {
    throw errors.validation('La fecha inicial no puede ser posterior a la final.');
  }

  const [site, intern] = await Promise.all([
    request.siteId ? prisma.site.findUnique({ where: { id: request.siteId }, select: { name: true } }) : null,
    request.internId
      ? prisma.intern.findUnique({ where: { id: request.internId }, select: { firstNames: true, lastNames: true } })
      : null,
  ]);

  if (request.siteId && !site) throw errors.notFound('Sede');
  if (request.internId && !intern) throw errors.notFound('Practicante');

  const scope = {
    siteName: site?.name ?? null,
    internName: intern ? intern.lastNames + ', ' + intern.firstNames : null,
  };

  const base: Omit<ReportData, 'columns' | 'rows' | 'totals' | 'bySite'> = {
    kind: request.kind,
    title: TITLES[request.kind],
    subtitle: buildSubtitle(request, scope),
    from: request.from,
    to: request.to,
    generatedAt: new Date().toISOString(),
    scope,
  };

  if (request.kind === 'incidencias') {
    const { rows, total } = await incidentRows(request);
    return {
      ...base,
      columns: INCIDENT_COLUMNS,
      rows,
      totals: null,
      bySite: [],
      subtitle: base.subtitle + ' - ' + total + ' evento(s)',
    };
  }

  const { rows, totals, bySite } = await attendanceRows(request);
  return { ...base, columns: ATTENDANCE_COLUMNS, rows, totals, bySite };
}

function buildSubtitle(request: ReportRequest, scope: { siteName: string | null; internName: string | null }): string {
  const parts: string[] = [];
  parts.push(request.from === request.to ? request.from : request.from + ' al ' + request.to);
  if (scope.siteName) parts.push('Sede: ' + scope.siteName);
  else parts.push('Todas las sedes');
  if (scope.internName) parts.push('Practicante: ' + scope.internName);
  return parts.join('  |  ');
}

async function attendanceRows(request: ReportRequest) {
  const where = {
    businessDate: { gte: dateOnlyValue(request.from), lte: dateOnlyValue(request.to) },
    ...(request.siteId ? { siteId: request.siteId } : {}),
    ...(request.internId ? { internId: request.internId } : {}),
    ...kindFilter(request.kind),
  };

  const days = await prisma.attendanceDay.findMany({
    where,
    orderBy: [{ businessDate: 'asc' }, { siteId: 'asc' }],
    include: {
      intern: { select: { dni: true, firstNames: true, lastNames: true, areaGroup: true } },
      site: { select: { name: true, timezone: true } },
      marks: true,
    },
  });

  const eventCount = await prisma.securityEvent.count({
    where: {
      createdAt: {
        gte: startOfLocalDay(request.from, config.APP_TIMEZONE),
        lte: endOfLocalDay(request.to, config.APP_TIMEZONE),
      },
      ...(request.siteId ? { siteId: request.siteId } : {}),
      ...(request.internId ? { internId: request.internId } : {}),
    },
  });

  const rows = days.map((d) => {
    const tz = d.site.timezone;
    const entrada = d.marks.find((m) => m.type === 'ENTRADA');
    const salida = d.marks.find((m) => m.type === 'SALIDA');

    return {
      fecha: dateOnlyString(d.businessDate),
      dni: d.intern.dni,
      practicante: d.intern.lastNames + ', ' + d.intern.firstNames,
      sede: d.site.name,
      area: d.intern.areaGroup ?? '',
      programada: minutesToHHmm(d.scheduledStartMinute) ?? '',
      entrada: entrada ? formatLocal(entrada.serverTime, tz, 'HH:mm') : '',
      salida: salida ? formatLocal(salida.serverTime, tz, 'HH:mm') : '',
      estado: d.status,
      puntualidad: d.punctuality ?? '',
      tardanzaMin: d.lateMinutes,
      minutosTrabajados:
        entrada && salida ? Math.round((salida.serverTime.getTime() - entrada.serverTime.getTime()) / 60000) : '',
      distanciaEntrada: entrada ? Number(entrada.distanceMeters) : '',
      distanciaSalida: salida ? Number(salida.distanceMeters) : '',
      pendiente: d.pendingExit ? 'SI' : 'NO',
      regularizado: d.regularized ? 'SI' : 'NO',
    } as Record<string, string | number | null>;
  });

  const jornadas = days.filter((d) => d.status !== 'NO_LABORABLE').length;
  const puntuales = days.filter((d) => d.punctuality === 'PUNTUAL').length;

  const totals: ReportTotals = {
    jornadas,
    presentes: days.filter((d) => d.status === 'PRESENTE').length,
    puntuales,
    tardanzas: days.filter((d) => d.punctuality === 'TARDANZA').length,
    ausentes: days.filter((d) => d.status === 'AUSENTE').length,
    salidasRegistradas: days.filter((d) => d.marks.some((m) => m.type === 'SALIDA')).length,
    salidasPendientes: days.filter((d) => d.pendingExit).length,
    minutosTardanza: days.reduce((a, d) => a + d.lateMinutes, 0),
    eventosSeguridad: eventCount,
    porcentajePuntualidad: jornadas > 0 ? Math.round((puntuales / jornadas) * 1000) / 10 : null,
  };

  const bySiteMap = new Map<string, ReportData['bySite'][number]>();
  for (const d of days) {
    const key = d.site.name;
    const current = bySiteMap.get(key) ?? { sede: key, jornadas: 0, puntuales: 0, tardanzas: 0, ausentes: 0, pendientes: 0 };
    if (d.status !== 'NO_LABORABLE') current.jornadas++;
    if (d.punctuality === 'PUNTUAL') current.puntuales++;
    if (d.punctuality === 'TARDANZA') current.tardanzas++;
    if (d.status === 'AUSENTE') current.ausentes++;
    if (d.pendingExit) current.pendientes++;
    bySiteMap.set(key, current);
  }

  return {
    rows,
    totals,
    bySite: Array.from(bySiteMap.values()).sort((a, b) => a.sede.localeCompare(b.sede)),
  };
}

/** Filtro adicional segun el tipo de reporte. */
function kindFilter(kind: ReportKind) {
  switch (kind) {
    case 'tardanzas':
      return { punctuality: 'TARDANZA' as const };
    case 'puntualidad':
      return { status: 'PRESENTE' as const };
    case 'faltas':
      return { status: 'AUSENTE' as const };
    case 'pendientes':
      return { pendingExit: true };
    case 'entradas':
      return { marks: { some: { type: 'ENTRADA' as const } } };
    case 'salidas':
      return { marks: { some: { type: 'SALIDA' as const } } };
    default:
      return {};
  }
}

async function incidentRows(request: ReportRequest) {
  const where = {
    createdAt: {
      gte: startOfLocalDay(request.from, config.APP_TIMEZONE),
      lte: endOfLocalDay(request.to, config.APP_TIMEZONE),
    },
    ...(request.siteId ? { siteId: request.siteId } : {}),
    ...(request.internId ? { internId: request.internId } : {}),
  };

  const [total, events] = await Promise.all([
    prisma.securityEvent.count({ where }),
    prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: {
        intern: { select: { dni: true, firstNames: true, lastNames: true } },
        site: { select: { name: true, timezone: true } },
      },
    }),
  ]);

  const rows = events.map((e) => ({
    fechaHora: formatLocal(e.createdAt, e.site?.timezone ?? 'America/Lima', 'yyyy-MM-dd HH:mm:ss'),
    tipo: e.type,
    severidad: e.severity,
    dni: e.intern?.dni ?? '',
    practicante: e.intern ? e.intern.lastNames + ', ' + e.intern.firstNames : '',
    sede: e.site?.name ?? '',
    distancia: e.distanceMeters !== null ? Number(e.distanceMeters) : '',
    precision: e.accuracyMeters !== null ? Number(e.accuracyMeters) : '',
    mensaje: e.message,
    atendido: e.acknowledgedAt ? 'SI' : 'NO',
  })) as Record<string, string | number | null>[];

  return { rows, total };
}

/** Nombre de archivo sugerido, sin caracteres problematicos. */
export function reportFilename(data: ReportData, extension: string): string {
  const scope = data.scope.internName ?? data.scope.siteName ?? 'general';
  const clean = scope
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .slice(0, 40);
  return ['asistencia', data.kind, clean, data.from, data.to].join('_') + '.' + extension;
}
