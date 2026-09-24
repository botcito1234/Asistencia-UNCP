/**
 * Generacion de reportes en Excel (xlsx) con ExcelJS.
 *
 * Se entrega como buffer para poder servirlo por HTTP o incluirlo en el paquete
 * de archivado sin pasar por disco.
 */
import ExcelJS from 'exceljs';
import type { ReportData } from './report.data.js';
import { config } from '../../config/env.js';

const HEADER_FILL = 'FF1F3A5F';
const ACCENT_FILL = 'FFEFF3F8';

export async function generateExcel(data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = config.APP_NAME;
  wb.created = new Date();

  const sheet = wb.addWorksheet('Detalle', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const lastCol = data.columns.length;

  // --- Encabezado ----------------------------------------------------------
  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = data.title;
  titleCell.font = { bold: true, size: 15, color: { argb: 'FF1F3A5F' } };
  titleCell.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 24;

  sheet.mergeCells(2, 1, 2, lastCol);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = data.subtitle;
  subtitleCell.font = { size: 10, color: { argb: 'FF44546A' } };

  sheet.mergeCells(3, 1, 3, lastCol);
  const metaCell = sheet.getCell(3, 1);
  metaCell.value = 'Generado: ' + new Date(data.generatedAt).toLocaleString('es-PE') + '  |  ' + config.APP_NAME;
  metaCell.font = { size: 9, italic: true, color: { argb: 'FF808080' } };

  // --- Cabecera de tabla ---------------------------------------------------
  const headerRow = sheet.getRow(5);
  data.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1F3A5F' } } };
    sheet.getColumn(i + 1).width = col.width ?? 16;
  });
  headerRow.height = 28;

  // --- Filas ---------------------------------------------------------------
  data.rows.forEach((row, index) => {
    const excelRow = sheet.getRow(6 + index);
    data.columns.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = row[col.key] ?? '';
      cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
      cell.font = { size: 10 };
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_FILL } };
      }
      // Resaltado semantico de los estados que exigen atencion.
      const value = String(row[col.key] ?? '');
      if (col.key === 'puntualidad' && value === 'TARDANZA') {
        cell.font = { size: 10, bold: true, color: { argb: 'FFB45309' } };
      }
      if (col.key === 'estado' && value === 'AUSENTE') {
        cell.font = { size: 10, bold: true, color: { argb: 'FFB91C1C' } };
      }
      if ((col.key === 'pendiente' || col.key === 'atendido') && value === 'SI' && col.key === 'pendiente') {
        cell.font = { size: 10, bold: true, color: { argb: 'FFB45309' } };
      }
      if (col.key === 'severidad' && value === 'CRITICO') {
        cell.font = { size: 10, bold: true, color: { argb: 'FFB91C1C' } };
      }
    });
  });

  if (data.rows.length === 0) {
    sheet.mergeCells(6, 1, 6, lastCol);
    const empty = sheet.getCell(6, 1);
    empty.value = 'Sin registros para los criterios seleccionados.';
    empty.font = { italic: true, color: { argb: 'FF808080' } };
    empty.alignment = { horizontal: 'center' };
  }

  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: lastCol } };

  // --- Hoja de resumen -----------------------------------------------------
  if (data.totals) {
    const resumen = wb.addWorksheet('Resumen');
    resumen.getColumn(1).width = 34;
    resumen.getColumn(2).width = 16;

    resumen.getCell(1, 1).value = 'Resumen del periodo';
    resumen.getCell(1, 1).font = { bold: true, size: 13, color: { argb: 'FF1F3A5F' } };
    resumen.getCell(2, 1).value = data.subtitle;
    resumen.getCell(2, 1).font = { size: 10, color: { argb: 'FF44546A' } };

    const metrics: [string, string | number | null][] = [
      ['Jornadas programadas', data.totals.jornadas],
      ['Presentes', data.totals.presentes],
      ['Puntuales', data.totals.puntuales],
      ['Tardanzas', data.totals.tardanzas],
      ['Minutos de tardanza acumulados', data.totals.minutosTardanza],
      ['Ausentes (faltas)', data.totals.ausentes],
      ['Salidas registradas', data.totals.salidasRegistradas],
      ['Salidas pendientes', data.totals.salidasPendientes],
      ['Eventos de seguridad', data.totals.eventosSeguridad],
      ['Puntualidad (%)', data.totals.porcentajePuntualidad],
    ];

    metrics.forEach(([label, value], i) => {
      const r = 4 + i;
      resumen.getCell(r, 1).value = label;
      resumen.getCell(r, 1).font = { size: 10 };
      resumen.getCell(r, 2).value = value ?? 'n/d';
      resumen.getCell(r, 2).font = { size: 10, bold: true };
      resumen.getCell(r, 2).alignment = { horizontal: 'right' };
      if (i % 2 === 1) {
        resumen.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_FILL } };
        resumen.getCell(r, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_FILL } };
      }
    });

    if (data.bySite.length > 1) {
      const start = 4 + metrics.length + 2;
      resumen.getCell(start, 1).value = 'Detalle por sede';
      resumen.getCell(start, 1).font = { bold: true, size: 12, color: { argb: 'FF1F3A5F' } };

      const headers = ['Sede', 'Jornadas', 'Puntuales', 'Tardanzas', 'Ausentes', 'Pendientes'];
      headers.forEach((h, i) => {
        const cell = resumen.getCell(start + 1, i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
        if (i > 0) resumen.getColumn(i + 1).width = 12;
      });

      data.bySite.forEach((s, i) => {
        const r = start + 2 + i;
        resumen.getCell(r, 1).value = s.sede;
        resumen.getCell(r, 2).value = s.jornadas;
        resumen.getCell(r, 3).value = s.puntuales;
        resumen.getCell(r, 4).value = s.tardanzas;
        resumen.getCell(r, 5).value = s.ausentes;
        resumen.getCell(r, 6).value = s.pendientes;
      });
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
