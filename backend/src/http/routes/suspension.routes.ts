import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { auditContextOf } from '../middleware/context.js';
import { createSuspensionSchema, isoDate } from '../validation.js';
import { createSuspension, listSuspensions } from '../../modules/suspensions/suspension.service.js';

export const suspensionRouter: Router = Router();
suspensionRouter.use(authenticate(), requireRole('ADMINISTRADOR'));

suspensionRouter.get('/', asyncHandler(async (req, res) => {
  const from = typeof req.query.from === 'string' ? isoDate.parse(req.query.from) : undefined;
  const to = typeof req.query.to === 'string' ? isoDate.parse(req.query.to) : undefined;
  res.json({ items: await listSuspensions(from, to) });
}));

suspensionRouter.post('/', asyncHandler(async (req, res) => {
  const body = createSuspensionSchema.parse(req.body);
  const created = await createSuspension({ ...body, internIds: body.internIds ?? [], createdById: req.auth!.userId, context: auditContextOf(req) });
  res.status(201).json(created);
}));
