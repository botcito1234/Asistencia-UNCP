import { prisma } from '../../infra/db/prisma.js';
import { dateOnlyValue } from '../../core/time.js';
import { errors } from '../../core/errors.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';

export type SuspensionScope = 'SITE' | 'INTERN' | 'SELECTED_INTERNS';

export interface CreateSuspensionInput {
  businessDate: string;
  scope: SuspensionScope;
  siteId?: string | null;
  internId?: string | null;
  internIds?: string[];
  reason: string;
  observation?: string | null;
  createdById: string;
  context?: AuditContext;
}

export async function findEffectiveSuspension(internId: string, siteId: string, businessDate: string) {
  const date = dateOnlyValue(businessDate);
  return prisma.suspension.findFirst({
    where: {
      businessDate: date,
      OR: [
        { scope: 'SITE', siteId },
        { scope: 'INTERN', internId },
        { scope: 'SELECTED_INTERNS', selectedInterns: { some: { internId } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createSuspension(input: CreateSuspensionInput) {
  const internIds = input.internIds ?? [];
  const scopedSiteId = input.scope === 'SITE' ? input.siteId ?? null : null;
  const scopedInternId = input.scope === 'INTERN' ? input.internId ?? null : null;
  if (input.scope === 'SITE' && !input.siteId) throw errors.validation('Una suspension de sede requiere siteId.');
  if (input.scope === 'INTERN' && !input.internId) throw errors.validation('Una suspension individual requiere internId.');
  if (input.scope === 'SELECTED_INTERNS' && internIds.length === 0) {
    throw errors.validation('Seleccione al menos un practicante.');
  }

  if (input.scope === 'SITE') {
    const site = await prisma.site.findUnique({ where: { id: input.siteId! }, select: { id: true } });
    if (!site) throw errors.notFound('Sede');
  }

  const targetInternIds = input.scope === 'INTERN' ? [input.internId!] : input.scope === 'SELECTED_INTERNS' ? internIds : [];
  if (targetInternIds.length > 0) {
    const existingCount = await prisma.intern.count({ where: { id: { in: targetInternIds } } });
    if (existingCount !== targetInternIds.length) throw errors.notFound('Uno o mas practicantes');
  }

  const suspension = await prisma.$transaction(async (tx) => {
    const created = await tx.suspension.create({
      data: {
        businessDate: dateOnlyValue(input.businessDate),
        scope: input.scope,
        siteId: scopedSiteId,
        internId: scopedInternId,
        reason: input.reason,
        observation: input.observation ?? null,
        createdById: input.createdById,
        selectedInterns:
          input.scope === 'SELECTED_INTERNS'
            ? { create: internIds.map((id) => ({ internId: id })) }
            : undefined,
      },
      include: { selectedInterns: true },
    });

    const affectedWhere = input.scope === 'SITE'
      ? { siteId: input.siteId!, businessDate: dateOnlyValue(input.businessDate) }
      : input.scope === 'INTERN'
        ? { internId: input.internId!, businessDate: dateOnlyValue(input.businessDate) }
        : { internId: { in: internIds }, businessDate: dateOnlyValue(input.businessDate) };

    await tx.attendanceDay.updateMany({
      where: affectedWhere,
      data: {
        status: 'SUSPENDIDA',
        pendingExit: false,
        punctuality: null,
        lateMinutes: 0,
        closedAt: new Date(),
        suspensionId: created.id,
      },
    });
    return created;
  });

  await recordAudit({
    ...(input.context ?? {}),
    actorUserId: input.createdById,
    actorRole: 'ADMINISTRADOR',
    action: 'SUSPENSION_CREADA',
    entityType: 'Suspension',
    entityId: suspension.id,
    after: { ...input, internIds },
  });
  return suspension;
}

export async function listSuspensions(from?: string, to?: string) {
  return prisma.suspension.findMany({
    where: {
      businessDate: {
        ...(from ? { gte: dateOnlyValue(from) } : {}),
        ...(to ? { lte: dateOnlyValue(to) } : {}),
      },
    },
    orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
    include: {
      site: { select: { id: true, code: true, name: true } },
      intern: { select: { id: true, dni: true, firstNames: true, lastNames: true } },
      selectedInterns: { include: { intern: { select: { id: true, dni: true, firstNames: true, lastNames: true } } } },
    },
  });
}
