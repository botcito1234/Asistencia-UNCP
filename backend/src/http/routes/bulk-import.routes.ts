import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../middleware/error-handler.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { auditContextOf } from "../middleware/context.js";
import { errors } from "../../core/errors.js";
import {
  importBulkInterns,
  previewBulkInterns,
} from "../../modules/bulk-import/bulk-intern.service.js";

export const bulkImportRouter: Router = Router();
bulkImportRouter.use(authenticate(), requireRole("ADMINISTRADOR"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4 },
});

function requireFile(req: Express.Request): Buffer {
  if (!req.file?.buffer)
    throw errors.validation("Adjunta un archivo .xlsx para continuar.");
  if (!/\.xlsx$/i.test(req.file.originalname))
    throw errors.validation("Solo se aceptan archivos Excel .xlsx.");
  return req.file.buffer;
}

/** POST /cargas-masivas/practicantes/preview - valida sin escribir. */
bulkImportRouter.post(
  "/practicantes/preview",
  upload.single("archivo"),
  asyncHandler(async (req, res) => {
    res.json(await previewBulkInterns(requireFile(req)));
  }),
);

/** POST /cargas-masivas/practicantes/commit - valida de nuevo y confirma en una transaccion. */
bulkImportRouter.post(
  "/practicantes/commit",
  upload.single("archivo"),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await importBulkInterns(
          requireFile(req),
          req.auth!.userId,
          auditContextOf(req),
        ),
      );
  }),
);
