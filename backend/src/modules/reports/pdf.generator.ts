/**
 * Generacion de reportes en PDF con PDFKit.
 *
 * Decision: PDFKit en lugar de renderizar HTML con un navegador headless.
 * Puppeteer arrastraria ~300 MB de Chromium al servidor y al contenedor para
 * producir tablas; PDFKit las dibuja directamente y sin dependencias del
 * sistema.
 */
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReportData, ReportColumn } from './report.data.js';
import { config } from '../../config/env.js';

const MARGIN = 32;
const HEADER_COLOR = '#0B1F3A';

/**
 * Escudo institucional para la cabecera del reporte.
 *
 * La ruta se resuelve desde este mismo modulo y no desde el directorio de
 * trabajo, que cambia entre el desarrollo, las pruebas y el contenedor. Si el
 * archivo no estuviera, el reporte se genera igual sin el: un logo ausente no
 * puede impedir que alguien saque su reporte.
 */
const LOGO = fileURLToPath(new URL('../../../assets/marca/uncp-horizontal.png', import.meta.url));
const HAY_LOGO = existsSync(LOGO);
const MUTED = '#6B7280';
const STRIPE = '#F3F6FA';
const DANGER = '#B91C1C';
const WARNING = '#B45309';

export async function generatePdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: data.title,
        Author: config.APP_NAME,
        Subject: data.subtitle,
        CreationDate: new Date(data.generatedAt),
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      render(doc, data);
      doc.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

type Doc = PDFKit.PDFDocument;

function render(doc: Doc, data: ReportData): void {
  const pageWidth = doc.page.width - MARGIN * 2;
  const widths = computeWidths(data.columns, pageWidth);

  drawHeader(doc, data);
  if (data.totals) drawSummary(doc, data, pageWidth);

  let y = doc.y + 10;
  y = drawTableHeader(doc, data.columns, widths, y);

  const rowHeight = 16;
  const bottomLimit = doc.page.height - MARGIN - 24;

  data.rows.forEach((row, index) => {
    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      drawCompactHeader(doc, data);
      y = drawTableHeader(doc, data.columns, widths, doc.y + 6);
    }

    if (index % 2 === 1) {
      doc.rect(MARGIN, y - 2, pageWidth, rowHeight).fill(STRIPE);
    }

    let x = MARGIN;
    data.columns.forEach((col, i) => {
      const raw = row[col.key];
      const text = raw === null || raw === undefined ? '' : String(raw);
      doc
        .fillColor(cellColor(col.key, text))
        .font(isEmphasized(col.key, text) ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(7.5)
        .text(text, x + 3, y + 2, {
          width: (widths[i] as number) - 6,
          align: col.align ?? 'left',
          lineBreak: false,
          ellipsis: true,
        });
      x += widths[i] as number;
    });

    y += rowHeight;
  });

  if (data.rows.length === 0) {
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(10)
      .text('Sin registros para los criterios seleccionados.', MARGIN, y + 12, { width: pageWidth, align: 'center' });
  }

  drawFooters(doc, data);
}

function drawHeader(doc: Doc, data: ReportData): void {
  if (HAY_LOGO) {
    const ancho = 132;
    doc.image(LOGO, doc.page.width - MARGIN - ancho, MARGIN - 2, { width: ancho });
  }

  doc
    .fillColor(HEADER_COLOR)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(data.title, MARGIN, MARGIN, { width: doc.page.width - MARGIN * 2 - 150 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(data.subtitle, MARGIN, doc.y + 2);
  doc
    .fillColor('#9CA3AF')
    .fontSize(7.5)
    .text(
      config.APP_NAME + '  -  Generado el ' + new Date(data.generatedAt).toLocaleString('es-PE'),
      MARGIN,
      doc.y + 2,
    );
  doc
    .moveTo(MARGIN, doc.y + 6)
    .lineTo(doc.page.width - MARGIN, doc.y + 6)
    .lineWidth(1)
    .strokeColor(HEADER_COLOR)
    .stroke();
  doc.y += 10;
}

function drawCompactHeader(doc: Doc, data: ReportData): void {
  doc.fillColor(HEADER_COLOR).font('Helvetica-Bold').fontSize(10).text(data.title, MARGIN, MARGIN);
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(data.subtitle, MARGIN, doc.y + 1);
  doc.y += 4;
}

function drawSummary(doc: Doc, data: ReportData, pageWidth: number): void {
  const t = data.totals;
  if (!t) return;

  const items: [string, string][] = [
    ['Jornadas', String(t.jornadas)],
    ['Presentes', String(t.presentes)],
    ['Puntuales', String(t.puntuales)],
    ['Tardanzas', String(t.tardanzas)],
    ['Faltas', String(t.ausentes)],
    ['Sal. pendientes', String(t.salidasPendientes)],
    ['Incidencias', String(t.eventosSeguridad)],
    ['Puntualidad', t.porcentajePuntualidad !== null ? t.porcentajePuntualidad + ' %' : 'n/d'],
  ];

  const boxWidth = pageWidth / items.length;
  const top = doc.y + 4;
  const boxHeight = 34;

  doc.rect(MARGIN, top, pageWidth, boxHeight).fill(STRIPE);

  items.forEach(([label, value], i) => {
    const x = MARGIN + boxWidth * i;
    doc.fillColor(MUTED).font('Helvetica').fontSize(6.5)
      .text(label.toUpperCase(), x, top + 6, { width: boxWidth, align: 'center' });
    doc.fillColor(HEADER_COLOR).font('Helvetica-Bold').fontSize(12)
      .text(value, x, top + 16, { width: boxWidth, align: 'center' });
  });

  doc.y = top + boxHeight + 4;
}

function drawTableHeader(doc: Doc, columns: ReportColumn[], widths: number[], y: number): number {
  const pageWidth = doc.page.width - MARGIN * 2;
  const height = 18;

  doc.rect(MARGIN, y, pageWidth, height).fill(HEADER_COLOR);

  let x = MARGIN;
  columns.forEach((col, i) => {
    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(7)
      .text(col.header, x + 3, y + 5, {
        width: (widths[i] as number) - 6,
        align: col.align ?? 'left',
        lineBreak: false,
        ellipsis: true,
      });
    x += widths[i] as number;
  });

  return y + height + 2;
}

function drawFooters(doc: Doc, data: ReportData): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - MARGIN + 4;
    doc
      .fillColor('#9CA3AF')
      .font('Helvetica')
      .fontSize(7)
      .text(
        data.title + '  -  ' + data.from + ' al ' + data.to,
        MARGIN,
        y,
        { width: doc.page.width - MARGIN * 2, align: 'left', lineBreak: false },
      );
    doc.text(
      'Página ' + (i - range.start + 1) + ' de ' + range.count,
      MARGIN,
      y,
      { width: doc.page.width - MARGIN * 2, align: 'right', lineBreak: false },
    );
  }
}

/** Reparte el ancho disponible respetando la proporcion sugerida por columna. */
function computeWidths(columns: ReportColumn[], pageWidth: number): number[] {
  const weights = columns.map((c) => c.width ?? 16);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / total) * pageWidth);
}

function cellColor(key: string, value: string): string {
  if (key === 'estado' && value === 'AUSENTE') return DANGER;
  if (key === 'severidad' && value === 'CRITICO') return DANGER;
  if (key === 'puntualidad' && value === 'TARDANZA') return WARNING;
  if (key === 'pendiente' && value === 'SI') return WARNING;
  return '#111827';
}

function isEmphasized(key: string, value: string): boolean {
  return cellColor(key, value) !== '#111827';
}
