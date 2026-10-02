import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { mapsRouteQuerySchema } from '../validation.js';
import { computeRoute } from '../../modules/maps/maps.service.js';

export const mapsRouter: Router = Router();

mapsRouter.use(authenticate(), requireRole('ADMINISTRADOR'));

/**
 * GET /mapas/ruta?origin=lat,lng&destination=lat,lng&mode=driving
 *
 * La API key permanece en el servidor. Cuando Maps está apagado esta ruta
 * responde 503 y el panel conserva el mapa base de OpenStreetMap.
 */
mapsRouter.get(
  '/ruta',
  asyncHandler(async (req, res) => {
    const query = mapsRouteQuerySchema.parse(req.query);
    res.json(await computeRoute(query));
  }),
);
