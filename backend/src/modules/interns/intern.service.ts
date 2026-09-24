/**
 * Practicantes.
 *
 * Un practicante es una persona con cuenta de acceso (UserAccount) y ficha
 * (Intern). Se crean juntos en una transaccion: no debe existir una ficha sin
 * credenciales ni credenciales huerfanas.
 *
 * Nunca se elimina: se desactiva. Su historial de asistencia, evidencias y
 * eventos debe permanecer consultable.
 *
 * El alta es individual por decision de alcance: no hay importacion masiva
 * desde Excel en esta version.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';
import { hashPassword, generateTemporaryPassword } from '../../core/crypto.js';
import { validatePasswordStrength } from '../../domain/attendance-rules.js';
import { config } from '../../config/env.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';
import { replaceWeeklySchedule, getCurrentWeeklySchedule, type ScheduleSlotInput } from '../schedules/schedule.service.js';
import { revokeAllSessionsForUser } from '../auth/token.service.js';
import { businessDateString, startOfLocalDay, endOfLocalDay } from '../../core/time.js';

export interface CreateInternInput {
  dni: string;
  firstNames: string;
  lastNames: string;
  siteId: string;
  areaGroup?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Si se omite, se genera una contrasena temporal y se devuelve una sola vez. */
  password?: string | null;
  /** Horario semanal inicial, opcional. */
  schedule?: ScheduleSlotInput[];
}

const DNI_PATTERN = /^[0-9]{8,12}$/;

export async function createIntern(input: CreateInternInput, adminUserId: string, context: AuditContext) {
  const dni = input.dni.trim();
  if (!DNI_PATTERN.test(dni)) {
    throw errors.validation('El DNI debe tener entre 8 y 12 digitos numericos.');
  }
  if (!input.firstNames.trim() || !input.lastNames.trim()) {
    throw errors.validation('Nombres y apellidos son obligatorios.');
  }

  const site = await prisma.site.findUnique({ where: { id: input.siteId } });
  if (!site) throw errors.notFound('Sede');
  if (!site.active) throw errors.validation('No se puede asignar un practicante a una sede inactiva.');

  const clash = await prisma.userAccount.findUnique({ where: { dni } });
  if (clash) throw errors.conflict('CONFLICTO', 'Ya existe un usuario registrado con el DNI ' + dni + '.');

  const temporaryPassword = input.password?.trim() || generateTemporaryPassword(10);
  if (input.password) {
    const policy = validatePasswordStrength(input.password, config.PASSWORD_MIN_LENGTH, dni);
    if (!policy.ok) throw errors.validation('La contraseña no cumple la política: ' + policy.problems.join(' '));
  }

  const passwordHash = await hashPassword(temporaryPassword);
  const displayName = input.firstNames.trim() + ' ' + input.lastNames.trim();

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.userAccount.create({
      data: {
        dni,
        passwordHash,
        role: 'PRACTICANTE',
        status: 'ACTIVO',
        mustChangePassword: true,
        displayName,
        email: input.email?.trim() || null,
      },
    });

    const intern = await tx.intern.create({
      data: {
        userId: user.id,
        dni,
        firstNames: input.firstNames.trim(),
        lastNames: input.lastNames.trim(),
        siteId: input.siteId,
        areaGroup: input.areaGroup?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
      },
    });

    return { user, intern };
  });

  if (input.schedule && input.schedule.length > 0) {
    const today = businessDateString(new Date(), site.timezone);
    await replaceWeeklySchedule(created.intern.id, input.schedule, today, adminUserId, context);
  }

  await recordAudit({
    ...context,
    actorUserId: adminUserId,
    actorRole: 'ADMINISTRADOR',
    action: 'PRACTICANTE_CREADO',
    entityType: 'Intern',
    entityId: created.intern.id,
    after: { dni, displayName, siteId: input.siteId, areaGroup: input.areaGroup },
  });

  return {
    intern: await getIntern(created.intern.id),
    // Se entrega una unica vez para que el administrador la comunique fuera de
    // banda. No se guarda en ningun log ni en la auditoria.
    temporaryPassword,
  };
}

export interface UpdateInternInput {
  firstNames?: string;
  lastNames?: string;
  siteId?: string;
  areaGroup?: string | null;
  phone?: string | null;
  email?: string | null;
  active?: boolean;
}

export async function updateIntern(
  internId: string,
  input: UpdateInternInput,
  adminUserId: string,
  context: AuditContext,
) {
  const before = await prisma.intern.findUnique({ where: { id: internId }, include: { site: true, user: true } });
  if (!before) throw errors.notFound('Practicante');

  if (input.siteId && input.siteId !== before.siteId) {
    const site = await prisma.site.findUnique({ where: { id: input.siteId } });
    if (!site) throw errors.notFound('Sede');
    if (!site.active) throw errors.validation('No se puede asignar a una sede inactiva.');
  }

  const internData: Prisma.InternUpdateInput = {};
  if (input.firstNames !== undefined) internData.firstNames = input.firstNames.trim();
  if (input.lastNames !== undefined) internData.lastNames = input.lastNames.trim();
  if (input.siteId !== undefined) internData.site = { connect: { id: input.siteId } };
  if (input.areaGroup !== undefined) internData.areaGroup = input.areaGroup?.trim() || null;
  if (input.phone !== undefined) internData.phone = input.phone?.trim() || null;
  if (input.email !== undefined) internData.email = input.email?.trim() || null;
  if (input.active !== undefined) internData.active = input.active;

  await prisma.$transaction(async (tx) => {
    await tx.intern.update({ where: { id: internId }, data: internData });

    const userData: Prisma.UserAccountUpdateInput = {};
    if (input.firstNames !== undefined || input.lastNames !== undefined) {
      const first = input.firstNames?.trim() ?? before.firstNames;
      const last = input.lastNames?.trim() ?? before.lastNames;
      userData.displayName = first + ' ' + last;
    }
    if (input.email !== undefined) userData.email = input.email?.trim() || null;
    if (input.active !== undefined) userData.status = input.active ? 'ACTIVO' : 'INACTIVO';

    if (Object.keys(userData).length > 0) {
      await tx.userAccount.update({ where: { id: before.userId }, data: userData });
    }
  });

  // Desactivar debe cortar el acceso de inmediato.
  if (input.active === false) {
    await revokeAllSessionsForUser(before.userId, 'PRACTICANTE_DESACTIVADO');
  }

  await recordAudit({
    ...context,
    actorUserId: adminUserId,
    actorRole: 'ADMINISTRADOR',
    action: input.active === false ? 'PRACTICANTE_DESACTIVADO' : 'PRACTICANTE_ACTUALIZADO',
    entityType: 'Intern',
    entityId: internId,
    before: {
      firstNames: before.firstNames,
      lastNames: before.lastNames,
      siteId: before.siteId,
      areaGroup: before.areaGroup,
      active: before.active,
    },
    after: input as unknown as Record<string, unknown>,
  });

  return getIntern(internId);
}

export async function getIntern(internId: string) {
  const intern = await prisma.intern.findUnique({
    where: { id: internId },
    include: {
      site: true,
      user: {
        select: {
          id: true,
          dni: true,
          status: true,
          mustChangePassword: true,
          lastLoginAt: true,
          lockedUntil: true,
          email: true,
        },
      },
      profilePhoto: { select: { id: true, sha256: true, uploadedAt: true } },
    },
  });
  if (!intern) throw errors.notFound('Practicante');

  const [binding, schedule] = await Promise.all([
    prisma.deviceBinding.findFirst({
      where: { userId: intern.userId, status: 'ACTIVO' },
      orderBy: { boundAt: 'desc' },
    }),
    getCurrentWeeklySchedule(internId, businessDateString(new Date(), intern.site.timezone)),
  ]);

  return {
    id: intern.id,
    userId: intern.userId,
    dni: intern.dni,
    firstNames: intern.firstNames,
    lastNames: intern.lastNames,
    fullName: intern.lastNames + ', ' + intern.firstNames,
    areaGroup: intern.areaGroup,
    phone: intern.phone,
    email: intern.email,
    active: intern.active,
    accountStatus: intern.user.status,
    mustChangePassword: intern.user.mustChangePassword,
    lastLoginAt: intern.user.lastLoginAt?.toISOString() ?? null,
    lockedUntil: intern.user.lockedUntil?.toISOString() ?? null,
    consent: {
      accepted: Boolean(intern.consentAcceptedAt),
      acceptedAt: intern.consentAcceptedAt?.toISOString() ?? null,
      policyVersion: intern.consentPolicyVersion,
    },
    profilePhotoId: intern.profilePhotoId,
    site: {
      id: intern.site.id,
      code: intern.site.code,
      name: intern.site.name,
      address: intern.site.address,
      latitude: Number(intern.site.latitude),
      longitude: Number(intern.site.longitude),
      radiusMeters: intern.site.radiusMeters,
      timezone: intern.site.timezone,
    },
    device: binding
      ? {
          id: binding.id,
          platform: binding.platform,
          model: binding.model,
          osVersion: binding.osVersion,
          appVersion: binding.appVersion,
          boundAt: binding.boundAt.toISOString(),
          lastSeenAt: binding.lastSeenAt.toISOString(),
        }
      : null,
    schedule,
    createdAt: intern.createdAt.toISOString(),
    updatedAt: intern.updatedAt.toISOString(),
  };
}

export interface InternListQuery {
  siteId?: string;
  search?: string;
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listInterns(q: InternListQuery) {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));

  const where: Prisma.InternWhereInput = {};
  if (q.siteId) where.siteId = q.siteId;
  if (!q.includeInactive) where.active = true;
  if (q.search) {
    const term = q.search.trim();
    where.OR = [
      { dni: { contains: term } },
      { firstNames: { contains: term, mode: 'insensitive' } },
      { lastNames: { contains: term, mode: 'insensitive' } },
      { areaGroup: { contains: term, mode: 'insensitive' } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.intern.count({ where }),
    prisma.intern.findMany({
      where,
      orderBy: [{ active: 'desc' }, { lastNames: 'asc' }, { firstNames: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        site: { select: { id: true, code: true, name: true } },
        user: { select: { status: true, lastLoginAt: true } },
      },
    }),
  ]);

  const userIds = rows.map((r) => r.userId);
  const bindings = await prisma.deviceBinding.findMany({
    where: { userId: { in: userIds }, status: 'ACTIVO' },
    select: { userId: true, model: true, boundAt: true, lastSeenAt: true },
  });
  const bindingMap = new Map(bindings.map((b) => [b.userId, b]));

  return {
    total,
    page,
    pageSize,
    items: rows.map((r) => {
      const b = bindingMap.get(r.userId);
      return {
        id: r.id,
        dni: r.dni,
        fullName: r.lastNames + ', ' + r.firstNames,
        firstNames: r.firstNames,
        lastNames: r.lastNames,
        areaGroup: r.areaGroup,
        active: r.active,
        accountStatus: r.user.status,
        lastLoginAt: r.user.lastLoginAt?.toISOString() ?? null,
        site: r.site,
        hasDevice: Boolean(b),
        deviceModel: b?.model ?? null,
        deviceBoundAt: b?.boundAt.toISOString() ?? null,
      };
    }),
  };
}

/** Ficha completa: datos, horario, dispositivo, indicadores y alertas. */
export async function getInternProfile(internId: string, from: string, to: string) {
  const [intern, summaryModule] = await Promise.all([
    getIntern(internId),
    import('../attendance/attendance.query.js'),
  ]);

  const [summary, history, events] = await Promise.all([
    summaryModule.getInternSummary(internId, from, to),
    summaryModule.queryAttendance({ internId, from, to, pageSize: 200 }),
    prisma.securityEvent.findMany({
      where: { internId, createdAt: { gte: startOfLocalDay(from, config.APP_TIMEZONE), lte: endOfLocalDay(to, config.APP_TIMEZONE) } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, type: true, severity: true, message: true, createdAt: true, acknowledgedAt: true },
    }),
  ]);

  return {
    intern,
    summary,
    attendance: history.items,
    securityEvents: events.map((e) => ({
      id: e.id,
      type: e.type,
      severity: e.severity,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
      acknowledged: Boolean(e.acknowledgedAt),
    })),
  };
}
