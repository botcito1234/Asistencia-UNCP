/**
 * Cierre de jornada.
 *
 * Al terminar el dia laboral de cada sede (hora local configurable) se
 * consolida lo ocurrido:
 *   - Practicante con jornada programada y sin entrada -> AUSENTE (falta).
 *   - Practicante con entrada y sin salida -> SALIDA PENDIENTE.
 *   - Dia sin horario vigente -> NO_LABORABLE (no genera falta).
 *
 * Es idempotente: reejecutarlo sobre la misma sede y fecha no duplica avisos ni
 * altera lo ya consolidado. Se apoya en `JobRun` con clave unica.
 */
import { prisma } from '../../infra/db/prisma.js';
import { logger } from '../../core/logger.js';
import { businessDateString, dateOnlyValue, minutesToHHmm } from '../../core/time.js';
import { resolveDayClosure } from '../../domain/attendance-rules.js';
import { getEffectiveSchedule } from '../schedules/schedule.service.js';
import { recordSecurityEvent } from '../security/security-event.service.js';
import { notify } from '../notifications/notification.service.js';
import { broadcast } from '../notifications/realtime.js';
import { recordAudit } from '../audit/audit.service.js';

export interface ClosureSummary {
  siteId: string;
  siteName: string;
  businessDate: string;
  evaluados: number;
  ausentes: number;
  salidasPendientes: number;
  presentesCompletos: number;
  sinJornada: number;
  yaCerrado: boolean;
}

const JOB_NAME = 'cierre-jornada';

/**
 * Cierra la jornada de una sede para una fecha.
 * @param force reejecuta aunque ya exista una corrida previa registrada.
 */
export async function closeSiteDay(siteId: string, businessDate: string, force = false): Promise<ClosureSummary> {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw new Error('Sede no encontrada: ' + siteId);

  const runKey = siteId + ':' + businessDate;

  if (!force) {
    const previous = await prisma.jobRun.findUnique({ where: { uq_job_run: { jobName: JOB_NAME, runKey } } });
    if (previous && previous.success) {
      return {
        siteId,
        siteName: site.name,
        businessDate,
        evaluados: 0,
        ausentes: 0,
        salidasPendientes: 0,
        presentesCompletos: 0,
        sinJornada: 0,
        yaCerrado: true,
      };
    }
  }

  const run = await prisma.jobRun.upsert({
    where: { uq_job_run: { jobName: JOB_NAME, runKey } },
    create: { jobName: JOB_NAME, runKey },
    update: { startedAt: new Date(), finishedAt: null, success: null, error: null },
  });

  const summary: ClosureSummary = {
    siteId,
    siteName: site.name,
    businessDate,
    evaluados: 0,
    ausentes: 0,
    salidasPendientes: 0,
    presentesCompletos: 0,
    sinJornada: 0,
    yaCerrado: false,
  };

  try {
    const interns = await prisma.intern.findMany({
      where: { siteId, active: true, user: { status: 'ACTIVO' } },
      select: { id: true, dni: true, firstNames: true, lastNames: true },
    });

    const dateValue = dateOnlyValue(businessDate);

    for (const intern of interns) {
      summary.evaluados++;

      const [schedule, day] = await Promise.all([
        getEffectiveSchedule(intern.id, businessDate),
        prisma.attendanceDay.findUnique({
          where: { uq_attendance_day_intern_date: { internId: intern.id, businessDate: dateValue } },
          include: { marks: { select: { type: true } } },
        }),
      ]);

      const hasCheckIn = day?.marks.some((m) => m.type === 'ENTRADA') ?? false;
      const hasCheckOut = day?.marks.some((m) => m.type === 'SALIDA') ?? false;
      const closure = resolveDayClosure({ hasCheckIn, hasCheckOut, hasSchedule: Boolean(schedule) });

      const nombre = intern.firstNames + ' ' + intern.lastNames;
      const yaCerrado = Boolean(day?.closedAt);

      if (closure.status === 'NO_LABORABLE') {
        summary.sinJornada++;
        if (!day) {
          await prisma.attendanceDay.create({
            data: {
              internId: intern.id,
              siteId,
              businessDate: dateValue,
              status: 'NO_LABORABLE',
              closedAt: new Date(),
            },
          });
        } else if (!yaCerrado) {
          await prisma.attendanceDay.update({
            where: { id: day.id },
            data: { status: 'NO_LABORABLE', closedAt: new Date() },
          });
        }
        continue;
      }

      if (closure.status === 'AUSENTE') {
        summary.ausentes++;
        const created = day
          ? await prisma.attendanceDay.update({
              where: { id: day.id },
              data: { status: 'AUSENTE', pendingExit: false, closedAt: new Date() },
            })
          : await prisma.attendanceDay.create({
              data: {
                internId: intern.id,
                siteId,
                businessDate: dateValue,
                scheduledStartMinute: schedule?.startMinute ?? null,
                scheduledEndMinute: schedule?.endMinute ?? null,
                scheduleEntryId: schedule?.scheduleEntryId ?? null,
                status: 'AUSENTE',
                closedAt: new Date(),
              },
            });

        if (!yaCerrado) {
          await recordSecurityEvent({
            type: 'FALTA_REGISTRADA',
            severity: 'INFO',
            message:
              'La jornada del ' + businessDate + ' cerro sin registro de entrada (hora programada ' +
              (minutesToHHmm(schedule?.startMinute ?? null) ?? 'n/d') + ').',
            internId: intern.id,
            siteId,
            details: { attendanceDayId: created.id, businessDate },
          });
          broadcast('asistencia', {
            internId: intern.id,
            internName: nombre,
            siteId,
            businessDate,
            status: 'AUSENTE',
          });
        }
        continue;
      }

      // PRESENTE
      if (closure.pendingExit) {
        summary.salidasPendientes++;
        if (day && !yaCerrado) {
          await prisma.attendanceDay.update({
            where: { id: day.id },
            data: { pendingExit: true, closedAt: new Date() },
          });
          await recordSecurityEvent({
            type: 'SALIDA_PENDIENTE',
            severity: 'ADVERTENCIA',
            message: 'Registro entrada el ' + businessDate + ' pero la jornada cerro sin marcar salida.',
            internId: intern.id,
            siteId,
            details: { attendanceDayId: day.id, businessDate },
          });
          broadcast('asistencia', {
            internId: intern.id,
            internName: nombre,
            siteId,
            businessDate,
            pendingExit: true,
          });
        }
      } else {
        summary.presentesCompletos++;
        if (day && !yaCerrado) {
          await prisma.attendanceDay.update({
            where: { id: day.id },
            data: { pendingExit: false, closedAt: new Date() },
          });
        }
      }
    }

    await prisma.jobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), success: true, summary: summary as unknown as object },
    });

    await recordAudit({
      action: 'JORNADA_CERRADA',
      entityType: 'Site',
      entityId: siteId,
      after: summary as unknown as Record<string, unknown>,
    });

    logger.info({ summary }, 'Jornada cerrada.');
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), success: false, error: message.slice(0, 600) },
    });
    logger.error({ err: e, siteId, businessDate }, 'Fallo el cierre de jornada.');
    throw e;
  }
}

/**
 * Cierra todas las sedes cuya hora local ya alcanzo la hora de cierre.
 * Lo invoca el planificador cada 30 minutos; asi cada sede cierra a SU hora
 * local aunque el servidor este en otra zona horaria.
 */
export async function closeDueSites(closeLocalTime: string): Promise<ClosureSummary[]> {
  const sites = await prisma.site.findMany({ where: { active: true } });
  const now = new Date();
  const results: ClosureSummary[] = [];

  const [closeH, closeM] = closeLocalTime.split(':').map(Number);
  const closeMinutes = (closeH ?? 23) * 60 + (closeM ?? 30);

  for (const site of sites) {
    const localMinutes = localMinutesOf(now, site.timezone);
    if (localMinutes < closeMinutes) continue;

    const businessDate = businessDateString(now, site.timezone);
    try {
      const summary = await closeSiteDay(site.id, businessDate);
      if (!summary.yaCerrado) results.push(summary);
    } catch (e) {
      logger.error({ err: e, siteId: site.id }, 'No se pudo cerrar la jornada de la sede.');
    }
  }

  // Aviso agregado, para no enviar una notificacion por practicante.
  const totalAusentes = results.reduce((a, r) => a + r.ausentes, 0);
  const totalPendientes = results.reduce((a, r) => a + r.salidasPendientes, 0);

  if (totalAusentes > 0 || totalPendientes > 0) {
    await notify({
      type: totalPendientes > 0 ? 'SALIDA_PENDIENTE' : 'FALTA_REGISTRADA',
      severity: 'ADVERTENCIA',
      title: 'Cierre de jornada',
      body:
        'Se cerraron ' + results.length + ' sede(s): ' + totalAusentes + ' falta(s) y ' + totalPendientes +
        ' salida(s) pendiente(s).',
      data: { sedes: results.map((r) => ({ sede: r.siteName, ausentes: r.ausentes, pendientes: r.salidasPendientes })) },
    });
  }

  return results;
}

function localMinutesOf(instant: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}
