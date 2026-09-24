/**
 * Regularizacion administrativa de una jornada.
 *
 * Regla no negociable: nunca se sobrescribe en silencio. Toda correccion deja
 * el valor anterior, el nuevo, quien la hizo, cuando y por que (motivo
 * obligatorio). La jornada queda marcada como `regularized` para que cualquier
 * reporte lo muestre.
 *
 * Alcance deliberadamente limitado: el administrador corrige la hora de una
 * marcacion existente, el estado del dia o la clasificacion de puntualidad.
 * NO puede crear una marcacion desde cero, porque una marcacion es evidencia
 * (foto + GPS + dispositivo) y fabricarla destruiria el valor probatorio del
 * sistema. Para un dia sin marcacion, el estado correcto se fija con
 * ESTADO_DIA + motivo.
 */
import type { Prisma, RegularizationField } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';
import { hhmmToMinutes, minutesToHHmm, instantAtLocalMinutes, dateOnlyString, formatLocal } from '../../core/time.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';
import { notify } from '../notifications/notification.service.js';
import { broadcast } from '../notifications/realtime.js';

export interface RegularizationInput {
  attendanceDayId: string;
  field: RegularizationField;
  /** Nuevo valor. Formato segun el campo: HH:mm, PUNTUAL/TARDANZA, estado, texto. */
  newValue: string;
  reason: string;
  adminUserId: string;
  context: AuditContext;
}

const VALID_DAY_STATUS = ['PROGRAMADO', 'PRESENTE', 'AUSENTE', 'NO_LABORABLE'] as const;
const VALID_PUNCTUALITY = ['PUNTUAL', 'TARDANZA'] as const;

export async function regularize(input: RegularizationInput) {
  const reason = input.reason?.trim() ?? '';
  if (reason.length < 10) {
    throw errors.validation('El motivo de la regularización es obligatorio y debe explicar el cambio (mínimo 10 caracteres).');
  }

  const day = await prisma.attendanceDay.findUnique({
    where: { id: input.attendanceDayId },
    include: { marks: true, site: { select: { timezone: true, name: true } }, intern: { select: { id: true, firstNames: true, lastNames: true } } },
  });
  if (!day) throw errors.notFound('Jornada');
  if (day.archivedAt) {
    throw errors.conflict('CONFLICTO', 'La jornada ya fue archivada y no admite cambios. Consulte el histórico.');
  }

  const timezone = day.site.timezone;
  const businessDate = dateOnlyString(day.businessDate);

  let oldValue: string | null = null;
  const dayUpdate: Prisma.AttendanceDayUpdateInput = { regularized: true };
  let markUpdate: { id: string; serverTime: Date } | null = null;

  switch (input.field) {
    case 'ENTRADA_HORA':
    case 'SALIDA_HORA': {
      const type = input.field === 'ENTRADA_HORA' ? 'ENTRADA' : 'SALIDA';
      const mark = day.marks.find((m) => m.type === type);
      if (!mark) {
        throw errors.conflict(
          'CONFLICTO',
          'No existe una marcación de ' +
            type.toLowerCase() +
            ' que corregir. Una marcación no puede crearse manualmente porque incluye evidencia fotográfica y GPS.',
        );
      }

      let minutes: number;
      try {
        minutes = hhmmToMinutes(input.newValue);
      } catch (e) {
        throw errors.validation((e as Error).message);
      }

      const newInstant = instantAtLocalMinutes(businessDate, minutes, timezone);
      oldValue = formatLocal(mark.serverTime, timezone, 'HH:mm');
      markUpdate = { id: mark.id, serverTime: newInstant };

      // Corregir la hora de entrada puede cambiar la puntualidad: se recalcula
      // con el horario que regia ese dia, no con el actual.
      if (type === 'ENTRADA' && day.scheduledStartMinute !== null) {
        const late = Math.max(0, minutes - day.scheduledStartMinute);
        dayUpdate.punctuality = late > 0 ? 'TARDANZA' : 'PUNTUAL';
        dayUpdate.lateMinutes = late;
      }
      break;
    }

    case 'PUNTUALIDAD': {
      const value = input.newValue.toUpperCase();
      if (!VALID_PUNCTUALITY.includes(value as (typeof VALID_PUNCTUALITY)[number])) {
        throw errors.validation('Puntualidad inválida. Valores admitidos: PUNTUAL, TARDANZA.');
      }
      oldValue = day.punctuality;
      dayUpdate.punctuality = value as (typeof VALID_PUNCTUALITY)[number];
      if (value === 'PUNTUAL') dayUpdate.lateMinutes = 0;
      break;
    }

    case 'ESTADO_DIA': {
      const value = input.newValue.toUpperCase();
      if (!VALID_DAY_STATUS.includes(value as (typeof VALID_DAY_STATUS)[number])) {
        throw errors.validation('Estado inválido. Valores admitidos: ' + VALID_DAY_STATUS.join(', ') + '.');
      }
      const hasCheckIn = day.marks.some((m) => m.type === 'ENTRADA');
      if (value === 'AUSENTE' && hasCheckIn) {
        throw errors.conflict(
          'CONFLICTO',
          'No se puede marcar AUSENTE una jornada con entrada registrada. La evidencia demuestra la presencia.',
        );
      }
      oldValue = day.status;
      dayUpdate.status = value as (typeof VALID_DAY_STATUS)[number];
      break;
    }

    case 'JUSTIFICACION': {
      // Solo deja constancia documental; no altera cifras.
      oldValue = null;
      break;
    }

    default:
      throw errors.validation('Campo de regularización no soportado.');
  }

  const result = await prisma.$transaction(async (tx) => {
    if (markUpdate) {
      await tx.attendanceMark.update({ where: { id: markUpdate.id }, data: { serverTime: markUpdate.serverTime } });
    }

    const updatedDay = await tx.attendanceDay.update({ where: { id: day.id }, data: dayUpdate });

    // Si se corrigio la salida, la jornada deja de estar pendiente.
    if (input.field === 'SALIDA_HORA') {
      await tx.attendanceDay.update({ where: { id: day.id }, data: { pendingExit: false } });
    }

    const record = await tx.regularization.create({
      data: {
        attendanceDayId: day.id,
        adminUserId: input.adminUserId,
        field: input.field,
        oldValue,
        newValue: input.newValue.slice(0, 255),
        reason: reason.slice(0, 500),
      },
    });

    await recordAudit(
      {
        ...input.context,
        actorUserId: input.adminUserId,
        actorRole: 'ADMINISTRADOR',
        action: 'REGULARIZACION_APLICADA',
        entityType: 'AttendanceDay',
        entityId: day.id,
        before: {
          campo: input.field,
          valorAnterior: oldValue,
          estado: day.status,
          puntualidad: day.punctuality,
          lateMinutes: day.lateMinutes,
        },
        after: { campo: input.field, valorNuevo: input.newValue },
        reason,
      },
      tx,
    );

    return { record, updatedDay };
  });

  const nombre = day.intern.firstNames + ' ' + day.intern.lastNames;

  await notify({
    type: 'REGULARIZACION',
    severity: 'ADVERTENCIA',
    title: 'Jornada regularizada',
    body:
      nombre +
      ' (' +
      day.site.name +
      ') - ' +
      businessDate +
      ': ' +
      input.field +
      ' cambió de "' +
      (oldValue ?? 'sin valor') +
      '" a "' +
      input.newValue +
      '".',
    data: { attendanceDayId: day.id, internId: day.intern.id, field: input.field, reason },
  });

  broadcast('asistencia', { attendanceDayId: day.id, internId: day.intern.id, regularized: true, businessDate });

  return {
    id: result.record.id,
    attendanceDayId: day.id,
    field: input.field,
    oldValue,
    newValue: input.newValue,
    reason,
    createdAt: result.record.createdAt.toISOString(),
  };
}

export async function listRegularizations(params: { attendanceDayId?: string; internId?: string; from?: Date; to?: Date }) {
  const where: Prisma.RegularizationWhereInput = {};
  if (params.attendanceDayId) where.attendanceDayId = params.attendanceDayId;
  if (params.internId) where.attendanceDay = { internId: params.internId };
  if (params.from || params.to) {
    where.createdAt = {};
    if (params.from) where.createdAt.gte = params.from;
    if (params.to) where.createdAt.lte = params.to;
  }

  const rows = await prisma.regularization.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      admin: { select: { id: true, displayName: true } },
      attendanceDay: {
        select: {
          id: true,
          businessDate: true,
          intern: { select: { id: true, dni: true, firstNames: true, lastNames: true } },
          site: { select: { id: true, name: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    field: r.field,
    oldValue: r.oldValue,
    newValue: r.newValue,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    admin: r.admin.displayName,
    businessDate: dateOnlyString(r.attendanceDay.businessDate),
    intern: {
      id: r.attendanceDay.intern.id,
      dni: r.attendanceDay.intern.dni,
      fullName: r.attendanceDay.intern.lastNames + ', ' + r.attendanceDay.intern.firstNames,
    },
    site: r.attendanceDay.site.name,
  }));
}

export { minutesToHHmm };
