import { Router } from "express";
import { asyncHandler } from "../middleware/error-handler.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { lookupDni } from "../../modules/dni/dni.service.js";

export const dniRouter: Router = Router();

/** La clave del proveedor nunca sale del backend. */
dniRouter.use(authenticate(), requireRole("ADMINISTRADOR"));

/** GET /dni/:dni - consulta para autocompletar altas administrativas. */
dniRouter.get(
  "/:dni",
  asyncHandler(async (req, res) => {
    res.json(await lookupDni(req.params.dni ?? ""));
  }),
);
