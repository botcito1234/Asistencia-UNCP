import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { reportRateLimit } from '../middleware/rate-limit.js';
import { auditContextOf } from '../middleware/context.js';
import { reportQuerySchema } from '../validation.js';
import { buildReport, reportFilename } from '../../modules/reports/report.data.js';
import { generateExcel } from '../../modules/reports/excel.generator.js';
import { generatePdf } from '../../modules/reports/pdf.generator.js';
import { recordAudit } from '../../modules/audit/audit.service.js';

export const reportsRouter: Router = Router();

reportsRouter.use(authenticate(), requireRole('ADMINISTRADOR'), reportRateLimit);

/** GET /reportes/tipos - catalogo para el panel. */
reportsRouter.get('/tipos', (_req, res) => {
  res.json({
    tipos: [
      { id: 'diario', nombre: 'Diario', descripcion: 'Asistencia de un día concreto.' },
      { id: 'semanal', nombre: 'Semanal', descripcion: 'Asistencia de una semana.' },
      { id: 'mensual', nombre: 'Mensual', descripcion: 'Asistencia de un mes completo.' },
      { id: 'rango', nombre: 'Rango personalizado', descripcion: 'Entre dos fechas cualesquiera.' },
      { id: 'practicante', nombre: 'Por practicante', descripcion: 'Historial individual.' },
      { id: 'sede', nombre: 'Por sede', descripcion: 'Todo el personal de una sede.' },
      { id: 'consolidado', nombre: 'Consolidado', descripcion: 'Todas las sedes con resumen comparativo.' },
      { id: 'puntualidad', nombre: 'Puntualidad', descripcion: 'Solo jornadas con presencia registrada.' },
      { id: 'tardanzas', nombre: 'Tardanzas', descripcion: 'Solo entradas fuera de hora.' },
      { id: 'faltas', nombre: 'Faltas', descripcion: 'Jornadas cerradas sin entrada.' },
      { id: 'entradas', nombre: 'Entradas', descripcion: 'Jornadas con entrada registrada.' },
      { id: 'salidas', nombre: 'Salidas', descripcion: 'Jornadas con salida registrada.' },
      { id: 'pendientes', nombre: 'Salidas pendientes', descripcion: 'Entradas sin salida al cierre.' },
      { id: 'incidencias', nombre: 'Incidencias', descripcion: 'Eventos de seguridad del periodo.' },
    ],
    formatos: ['excel', 'pdf'],
  });
});

/** GET /reportes/vista-previa - los mismos datos, en JSON, para mostrarlos en pantalla. */
reportsRouter.get(
  '/vista-previa',
  asyncHandler(async (req, res) => {
    const q = reportQuerySchema.parse(req.query);
    const data = await buildReport({
      kind: q.tipo,
      from: q.from,
      to: q.to,
      siteId: q.siteId,
      internId: q.internId,
    });
    // Se acota la vista previa; la descarga completa va por /generar.
    res.json({ ...data, rows: data.rows.slice(0, 500), truncado: data.rows.length > 500, filas: data.rows.length });
  }),
);

/** GET /reportes/generar?tipo=&formato=&from=&to=[&siteId=&internId=] */
reportsRouter.get(
  '/generar',
  asyncHandler(async (req, res) => {
    const q = reportQuerySchema.parse(req.query);

    const data = await buildReport({
      kind: q.tipo,
      from: q.from,
      to: q.to,
      siteId: q.siteId,
      internId: q.internId,
    });

    const isExcel = q.formato === 'excel';
    const buffer = isExcel ? await generateExcel(data) : await generatePdf(data);
    const filename = reportFilename(data, isExcel ? 'xlsx' : 'pdf');

    // Generar un reporte es una lectura masiva de datos personales: se audita.
    await recordAudit({
      ...auditContextOf(req),
      action: 'REPORTE_GENERADO',
      entityType: 'Reporte',
      entityId: q.tipo,
      after: {
        tipo: q.tipo,
        formato: q.formato,
        desde: q.from,
        hasta: q.to,
        siteId: q.siteId ?? null,
        internId: q.internId ?? null,
        filas: data.rows.length,
      },
    });

    res.setHeader(
      'content-type',
      isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
    );
    res.setHeader('content-disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('content-length', String(buffer.length));
    res.setHeader('cache-control', 'private, no-store');
    res.send(buffer);
  }),
);
