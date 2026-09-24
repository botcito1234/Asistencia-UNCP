/**
 * Horarios por practicante y dia de la semana, con vigencia temporal.
 *
 * Regla no negociable: cambiar un horario NO sobrescribe el anterior. La fila
 * vigente se cierra con `effectiveTo` y se crea una nueva. De este modo, la
 * asistencia de marzo siempre se puede evaluar contra el horario que realmente
 * regia en marzo, aunque en abril se haya cambiado.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';
import { dateOnlyValue, dateOnlyString, minutesToHHmm, hhmmToMinutes, isoWeekdayFromDateString, addDaysToDateString } from '../../core/time.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';

export interface ScheduleSlotInput {
  /** 1 = lunes ... 7 = domingo. */
  weekday: number;
  /** Hora de entrada en formato HH:mm. */
  startTime: string;
  /** Hora de salida referencial, opcional. */
  endTime?: string | null;
}

export interface EffectiveSchedule {
  scheduleEntryId: string;
  weekday: number;
  startMinute: number;
  endMinute: number | null;
}

/**
 * Horario vigente para un practicante en una fecha concreta.
 * Devuelve null si ese dia no tiene jornada programada (fin de semana, por
 * ejemplo): ese dia no genera falta.
 */
export async function getEffectiveSchedule(
  internId: string,
  isoDate: string,
  tx?: Prisma.TransactionClient,
): Promise<EffectiveSchedule | null> {
  const client = tx ?? prisma;
  const weekday = isoWeekdayFromDateString(isoDate);
  const date = dateOnlyValue(isoDate);

  const entry = await client.scheduleEntry.findFirst({
    where: {
      internId,
      weekday,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (!entry) return null;
  return {
    scheduleEntryId: entry.id,
    weekday: entry.weekday,
    startMinute: entry.startMinute,
    endMinute: entry.endMinute,
  };
}

/** Horario semanal vigente hoy, para mostrarlo en la aplicacion y el panel. */
export async function getCurrentWeeklySchedule(internId: string, referenceIsoDate: string) {
  const date = dateOnlyValue(referenceIsoDate);
  const entries = await prisma.scheduleEntry.findMany({
    where: {
      internId,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: [{ weekday: 'asc' }, { effectiveFrom: 'desc' }],
  });

  // Para cada dia se queda la vigencia mas reciente.
  const byWeekday = new Map<number, (typeof entries)[number]>();
  for (const e of entries) if (!byWeekday.has(e.weekday)) byWeekday.set(e.weekday, e);

  return Array.from({ length: 7 }, (_, i) => {
    const weekday = i + 1;
    const e = byWeekday.get(weekday);
    return {
      weekday,
      weekdayName: WEEKDAY_NAMES[weekday] as string,
      startTime: e ? minutesToHHmm(e.startMinute) : null,
      endTime: e ? minutesToHHmm(e.endMinute) : null,
      scheduleEntryId: e?.id ?? null,
    };
  });
}

/** Historial completo, incluidas las vigencias cerradas. */
export async function getScheduleHistory(internId: string) {
  const entries = await prisma.scheduleEntry.findMany({
    where: { internId },
    orderBy: [{ effectiveFrom: 'desc' }, { weekday: 'asc' }],
  });
  return entries.map((e) => ({
    id: e.id,
    weekday: e.weekday,
    weekdayName: WEEKDAY_NAMES[e.weekday] as string,
    startTime: minutesToHHmm(e.startMinute),
    endTime: minutesToHHmm(e.endMinute),
    effectiveFrom: dateOnlyString(e.effectiveFrom),
    effectiveTo: e.effectiveTo ? dateOnlyString(e.effectiveTo) : null,
    vigente: e.effectiveTo === null,
    createdAt: e.createdAt.toISOString(),
  }));
}

export const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

/**
 * Reemplaza el horario semanal a partir de una fecha de vigencia.
 *
 * Los dias que no aparezcan en `slots` quedan sin jornada a partir de esa fecha
 * (se cierra su vigencia y no se crea reemplazo). El historial anterior queda
 * intacto.
 */
export async function replaceWeeklySchedule(
  internId: string,
  slots: ScheduleSlotInput[],
  effectiveFromIso: string,
  adminUserId: string,
  context: AuditContext,
): Promise<void> {
  const intern = await prisma.intern.findUnique({ where: { id: internId }, select: { id: true } });
  if (!intern) throw errors.notFound('Practicante');

  // Validacion previa: ningun dia repetido y horas coherentes.
  const seen = new Set<number>();
  const normalized = slots.map((s) => {
    if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7) {
      throw errors.validation('Día de la semana inválido: ' + s.weekday + '. Use 1 (lunes) a 7 (domingo).');
    }
    if (seen.has(s.weekday)) {
      throw errors.validation('El día ' + WEEKDAY_NAMES[s.weekday] + ' aparece más de una vez.');
    }
    seen.add(s.weekday);

    let startMinute: number;
    let endMinute: number | null = null;
    try {
      startMinute = hhmmToMinutes(s.startTime);
      if (s.endTime) endMinute = hhmmToMinutes(s.endTime);
    } catch (e) {
      throw errors.validation((e as Error).message);
    }
    if (endMinute !== null && endMinute <= startMinute) {
      throw errors.validation(
        'En ' + WEEKDAY_NAMES[s.weekday] + ' la hora de salida debe ser posterior a la de entrada.',
      );
    }
    return { weekday: s.weekday, startMinute, endMinute };
  });

  const effectiveFrom = dateOnlyValue(effectiveFromIso);
  // La vigencia anterior se cierra el dia previo al inicio de la nueva.
  const previousEnd = dateOnlyValue(addDaysToDateString(effectiveFromIso, -1));

  const before = await getCurrentWeeklySchedule(internId, effectiveFromIso);

  await prisma.$transaction(async (tx) => {
    // Cerrar las vigencias abiertas que se solapan con la nueva fecha.
    await tx.scheduleEntry.updateMany({
      where: { internId, effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
      data: { effectiveTo: previousEnd },
    });

    // Si ya existian filas que empiezan el mismo dia o despues, se eliminan:
    // todavia no rigieron ningun dia, asi que no hay historia que preservar.
    await tx.scheduleEntry.deleteMany({
      where: { internId, effectiveFrom: { gte: effectiveFrom } },
    });

    if (normalized.length > 0) {
      await tx.scheduleEntry.createMany({
        data: normalized.map((n) => ({
          internId,
          weekday: n.weekday,
          startMinute: n.startMinute,
          endMinute: n.endMinute,
          effectiveFrom,
          createdBy: adminUserId,
        })),
      });
    }
  });

  await recordAudit({
    ...context,
    actorUserId: adminUserId,
    action: 'HORARIO_ACTUALIZADO',
    entityType: 'Intern',
    entityId: internId,
    before: { horario: before },
    after: {
      vigenciaDesde: effectiveFromIso,
      horario: normalized.map((n) => ({
        dia: WEEKDAY_NAMES[n.weekday],
        entrada: minutesToHHmm(n.startMinute),
        salida: minutesToHHmm(n.endMinute),
      })),
    },
  });
}
