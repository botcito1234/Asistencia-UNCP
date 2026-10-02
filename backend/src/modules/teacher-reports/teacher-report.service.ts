import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';
import { notify } from '../notifications/notification.service.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';

export interface CreateTeacherReportInput {
  conductorUserId: string;
  internId: string;
  category: 'DOMINIO_DISCIPLINAR' | 'PLANIFICACION' | 'MANEJO_DE_AULA' | 'METODOLOGIA' | 'PUNTUALIDAD' | 'RESPONSABILIDAD' | 'COMUNICACION' | 'OTROS';
  nature: 'POSITIVA' | 'OBSERVACION_DE_MEJORA' | 'INCIDENCIA';
  importance: 'BAJO' | 'MEDIO' | 'ALTO';
  detail: string;
  recommendation?: string | null;
  context?: AuditContext;
}

async function conductorForUser(userId: string) {
  const profile = await prisma.conductorProfile.findUnique({ where: { userId }, select: { id: true, active: true } });
  if (!profile || !profile.active) throw errors.forbidden('La cuenta no tiene un perfil de docente conductor activo.');
  return profile;
}

export async function createTeacherReport(input: CreateTeacherReportInput) {
  const conductor = await conductorForUser(input.conductorUserId);
  const assignment = await prisma.internConductor.findFirst({
    where: { conductorId: conductor.id, internId: input.internId, revokedAt: null },
  });
  if (!assignment) throw errors.forbidden('Solo puede reportar practicantes asignados a su seguimiento.');

  const report = await prisma.teacherReport.create({
    data: {
      conductorId: conductor.id,
      internId: input.internId,
      category: input.category,
      nature: input.nature,
      importance: input.importance,
      detail: input.detail,
      recommendation: input.recommendation ?? null,
    },
    include: { intern: { select: { id: true, firstNames: true, lastNames: true } } },
  });

  if (input.importance === 'ALTO' || input.nature === 'INCIDENCIA') {
    await notify({
      type: 'REPORTE_DOCENTE',
      severity: input.importance === 'ALTO' ? 'CRITICO' : 'ADVERTENCIA',
      urgent: true,
      title: 'Nuevo seguimiento docente',
      body: `${report.intern.lastNames}, ${report.intern.firstNames}: ${input.nature.toLowerCase()}.`,
      data: { reportId: report.id, internId: input.internId, importance: input.importance, nature: input.nature },
    });
  }

  await recordAudit({
    ...(input.context ?? {}),
    actorUserId: input.conductorUserId,
    actorRole: 'DOCENTE_CONDUCTOR',
    action: 'REPORTE_DOCENTE_CREADO',
    entityType: 'TeacherReport',
    entityId: report.id,
    after: { internId: input.internId, category: input.category, nature: input.nature, importance: input.importance },
  });
  return report;
}

export async function listTeacherReports(input: { userId: string; role: 'ADMINISTRADOR' | 'DOCENTE_CONDUCTOR'; internId?: string }) {
  const where = input.role === 'ADMINISTRADOR'
    ? { ...(input.internId ? { internId: input.internId } : {}) }
    : {
        ...(input.internId ? { internId: input.internId } : {}),
        conductor: { userId: input.userId },
      };
  return prisma.teacherReport.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      intern: { select: { id: true, dni: true, firstNames: true, lastNames: true } },
      conductor: { include: { user: { select: { id: true, displayName: true } } } },
    },
  });
}
