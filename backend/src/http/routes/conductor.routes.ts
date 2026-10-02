import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { auditContextOf } from '../middleware/context.js';
import { assignConductorSchema, createConductorSchema, teacherReportSchema, uuid } from '../validation.js';
import { prisma } from '../../infra/db/prisma.js';
import { hashPassword, generateTemporaryPassword } from '../../core/crypto.js';
import { recordAudit } from '../../modules/audit/audit.service.js';
import { createTeacherReport, listTeacherReports } from '../../modules/teacher-reports/teacher-report.service.js';

export const conductorRouter: Router = Router();

conductorRouter.use(authenticate());

conductorRouter.get('/docentes', requireRole('ADMINISTRADOR'), asyncHandler(async (_req, res) => {
  const items = await prisma.conductorProfile.findMany({
    orderBy: { user: { displayName: 'asc' } },
    include: {
      user: { select: { id: true, dni: true, displayName: true, email: true, status: true, mustChangePassword: true } },
      assignments: { where: { revokedAt: null }, include: { intern: { select: { id: true, dni: true, firstNames: true, lastNames: true } } } },
    },
  });
  res.json(items);
}));

conductorRouter.get('/docentes/mis-practicantes', requireRole('DOCENTE_CONDUCTOR'), asyncHandler(async (req, res) => {
  const profile = await prisma.conductorProfile.findUnique({ where: { userId: req.auth!.userId } });
  if (!profile) return res.status(403).json({ error: { code: 'PROHIBIDO', message: 'Perfil de docente no encontrado.' } });
  const items = await prisma.internConductor.findMany({
    where: { conductorId: profile.id, revokedAt: null, intern: { active: true } },
    orderBy: { intern: { lastNames: 'asc' } },
    include: { intern: { select: { id: true, dni: true, firstNames: true, lastNames: true, site: { select: { id: true, name: true, code: true } } } } },
  });
  res.json({ items: items.map((item) => item.intern) });
}));

conductorRouter.post('/docentes', requireRole('ADMINISTRADOR'), asyncHandler(async (req, res) => {
  const body = createConductorSchema.parse(req.body);
  const temporaryPassword = body.password?.trim() || generateTemporaryPassword(12);
  const conductor = await prisma.$transaction(async (tx) => {
    const user = await tx.userAccount.create({
      data: {
        dni: body.dni,
        displayName: body.displayName,
        email: body.email === '' ? null : body.email ?? null,
        passwordHash: await hashPassword(temporaryPassword),
        role: 'DOCENTE_CONDUCTOR',
      },
    });
    return tx.conductorProfile.create({ data: { userId: user.id, phone: body.phone ?? null, email: body.email === '' ? null : body.email ?? null } });
  });
  await recordAudit({ ...auditContextOf(req), actorUserId: req.auth!.userId, actorRole: 'ADMINISTRADOR', action: 'DOCENTE_CREADO', entityType: 'ConductorProfile', entityId: conductor.id, after: { userId: conductor.userId, dni: body.dni } });
  res.status(201).json({ conductorId: conductor.id, dni: body.dni, temporaryPassword });
}));

conductorRouter.post('/docentes/:conductorId/asignaciones', requireRole('ADMINISTRADOR'), asyncHandler(async (req, res) => {
  const conductorId = uuid.parse(req.params.conductorId);
  const body = assignConductorSchema.parse(req.body);
  const conductor = await prisma.conductorProfile.findUnique({ where: { id: conductorId }, select: { id: true, active: true } });
  if (!conductor) return res.status(404).json({ error: { code: 'NO_ENCONTRADO', message: 'Docente no encontrado.' } });
  if (!conductor.active) return res.status(409).json({ error: { code: 'CONFLICTO', message: 'El docente no esta activo.' } });
  const internsCount = await prisma.intern.count({ where: { id: { in: body.internIds } } });
  if (internsCount !== body.internIds.length) return res.status(404).json({ error: { code: 'NO_ENCONTRADO', message: 'Uno o mas practicantes no existen.' } });
  const assignments = await prisma.$transaction(async (tx) => {
    await tx.internConductor.updateMany({
      where: {
        conductorId,
        revokedAt: null,
        ...(body.internIds.length > 0 ? { internId: { notIn: body.internIds } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return Promise.all(
      body.internIds.map((internId) => tx.internConductor.upsert({
        where: { uq_intern_conductor: { internId, conductorId } },
        create: { internId, conductorId, assignedBy: req.auth!.userId },
        update: { revokedAt: null, assignedBy: req.auth!.userId, assignedAt: new Date() },
      })),
    );
  });
  res.status(201).json({ asignaciones: assignments });
}));

conductorRouter.get('/seguimiento-docente', requireRole('ADMINISTRADOR', 'DOCENTE_CONDUCTOR'), asyncHandler(async (req, res) => {
  const internId = typeof req.query.internId === 'string' ? uuid.parse(req.query.internId) : undefined;
  const items = await listTeacherReports({ userId: req.auth!.userId, role: req.auth!.role as 'ADMINISTRADOR' | 'DOCENTE_CONDUCTOR', internId });
  res.json({ items });
}));

conductorRouter.post('/seguimiento-docente', requireRole('DOCENTE_CONDUCTOR'), asyncHandler(async (req, res) => {
  const body = teacherReportSchema.parse(req.body);
  const report = await createTeacherReport({ ...body, internId: body.internId, recommendation: body.recommendation ?? null, conductorUserId: req.auth!.userId, context: auditContextOf(req) });
  res.status(201).json(report);
}));
