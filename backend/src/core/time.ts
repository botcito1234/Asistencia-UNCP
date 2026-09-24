/**
 * Manejo de tiempo y de "fecha de negocio".
 *
 * Reglas:
 *  - El reloj oficial es el del servidor. La hora del telefono solo se guarda
 *    como dato de auditoria.
 *  - En base de datos todo instante se guarda en UTC (timestamptz).
 *  - La "fecha de negocio" (que dia laboral es una marcacion) se calcula en la
 *    zona horaria de la SEDE, no en la del servidor ni en la del telefono.
 */
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/** Fecha de negocio en formato ISO corto (YYYY-MM-DD) segun la zona indicada. */
export function businessDateString(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
}

/**
 * Valor para una columna `date` de PostgreSQL.
 * Prisma serializa `@db.Date` tomando la parte UTC, por eso se construye el
 * instante a medianoche UTC del dia de negocio: asi la fecha almacenada es
 * exactamente la esperada sin corrimientos.
 */
export function businessDateValue(instant: Date, timeZone: string): Date {
  return new Date(businessDateString(instant, timeZone) + 'T00:00:00.000Z');
}

export function dateOnlyValue(isoDate: string): Date {
  return new Date(isoDate + 'T00:00:00.000Z');
}

export function dateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Minutos transcurridos desde la medianoche local de la zona indicada. */
export function localMinutesOfDay(instant: Date, timeZone: string): number {
  const hh = Number(formatInTimeZone(instant, timeZone, 'HH'));
  const mm = Number(formatInTimeZone(instant, timeZone, 'mm'));
  return hh * 60 + mm;
}

/** Dia de la semana ISO-8601: 1 = lunes ... 7 = domingo. */
export function isoWeekday(instant: Date, timeZone: string): number {
  const zoned = toZonedTime(instant, timeZone);
  const js = zoned.getDay(); // 0 = domingo
  return js === 0 ? 7 : js;
}

export function isoWeekdayFromDateString(isoDate: string): number {
  const js = new Date(isoDate + 'T00:00:00.000Z').getUTCDay();
  return js === 0 ? 7 : js;
}

/** Instante UTC correspondiente a una hora local (en minutos) de un dia de negocio. */
export function instantAtLocalMinutes(isoDate: string, minutes: number, timeZone: string): Date {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const local = isoDate + ' ' + pad2(h) + ':' + pad2(m) + ':00';
  return fromZonedTime(local, timeZone);
}

/**
 * Instante en que ARRANCA, en tiempo absoluto, un dia calendario local.
 *
 * El panel filtra por fechas ("del 22 al 22"), pero los eventos, la bitacora y
 * las regularizaciones se guardan con instante absoluto. Interpretar esas
 * fechas en UTC deja fuera del dia lo ocurrido despues de las 19:00 en Lima, y
 * lo mete en el dia siguiente: un incidente de las 22:55 no aparecia al
 * consultar su propio dia. Por eso el rango se construye siempre en la zona
 * horaria de la institucion.
 */
export function startOfLocalDay(isoDate: string, timeZone: string): Date {
  return instantAtLocalMinutes(isoDate, 0, timeZone);
}

/** Ultimo instante (inclusive) de un dia calendario local. */
export function endOfLocalDay(isoDate: string, timeZone: string): Date {
  return new Date(instantAtLocalMinutes(addDaysToDateString(isoDate, 1), 0, timeZone).getTime() - 1);
}

export function formatLocal(instant: Date, timeZone: string, pattern = 'yyyy-MM-dd HH:mm:ss'): string {
  return formatInTimeZone(instant, timeZone, pattern);
}

export function minutesToHHmm(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null;
  const norm = ((minutes % 1440) + 1440) % 1440;
  return pad2(Math.floor(norm / 60)) + ':' + pad2(norm % 60);
}

export function hhmmToMinutes(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error('Hora inválida, se esperaba HH:mm -> ' + value);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error('Hora fuera de rango -> ' + value);
  return h * 60 + min;
}

export function addDaysToDateString(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonthsToDateString(isoDate: string, months: number): string {
  const d = new Date(isoDate + 'T00:00:00.000Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Lista inclusiva de fechas entre dos extremos (ambos YYYY-MM-DD). */
export function eachDateString(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let cursor = fromIso;
  let guard = 0;
  while (cursor <= toIso && guard < 4000) {
    out.push(cursor);
    cursor = addDaysToDateString(cursor, 1);
    guard++;
  }
  return out;
}

export function startOfMonthString(year: number, month: number): string {
  return String(year) + '-' + pad2(month) + '-01';
}

export function endOfMonthString(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return n < 10 ? '0' + String(n) : String(n);
}

export { pad2 };
