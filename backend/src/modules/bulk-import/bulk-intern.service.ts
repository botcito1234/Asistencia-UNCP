/** Importacion masiva de practicantes desde la plantilla NEXORA. */
import ExcelJS from "exceljs";
import { prisma } from "../../infra/db/prisma.js";
import { errors } from "../../core/errors.js";
import {
  hashPassword,
  generateTemporaryPassword,
  newId,
} from "../../core/crypto.js";
import {
  businessDateString,
  dateOnlyValue,
  hhmmToMinutes,
} from "../../core/time.js";
import { config } from "../../config/env.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";

export const BULK_HEADERS = [
  "dni",
  "nombres",
  "apellidos",
  "codigo_sede",
  "area_grupo",
  "telefono",
  "correo",
  "lunes_entrada",
  "lunes_salida",
  "martes_entrada",
  "martes_salida",
  "miercoles_entrada",
  "miercoles_salida",
  "jueves_entrada",
  "jueves_salida",
  "viernes_entrada",
  "viernes_salida",
  "sabado_entrada",
  "sabado_salida",
  "domingo_entrada",
  "domingo_salida",
] as const;

const REQUIRED_HEADERS = new Set([
  "dni",
  "nombres",
  "apellidos",
  "codigo_sede",
]);
const DNI_PATTERN = /^[0-9]{8,12}$/;
const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = [
  { weekday: 1, name: "lunes" },
  { weekday: 2, name: "martes" },
  { weekday: 3, name: "miercoles" },
  { weekday: 4, name: "jueves" },
  { weekday: 5, name: "viernes" },
  { weekday: 6, name: "sabado" },
  { weekday: 7, name: "domingo" },
] as const;

export interface BulkScheduleSlot {
  weekday: number;
  startTime: string;
  endTime: string | null;
}

export interface ParsedBulkIntern {
  rowNumber: number;
  dni: string;
  firstNames: string;
  lastNames: string;
  siteCode: string;
  areaGroup: string | null;
  phone: string | null;
  email: string | null;
  schedule: BulkScheduleSlot[];
}

export interface BulkValidationError {
  rowNumber: number;
  field: string;
  message: string;
}

export interface ValidatedBulkIntern extends ParsedBulkIntern {
  siteId: string;
  siteName: string;
  siteTimezone: string;
}

export interface BulkPreview {
  rows: ValidatedBulkIntern[];
  errors: BulkValidationError[];
  summary: { totalRows: number; validRows: number; errorRows: number };
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("result" in value) return String(value.result ?? "").trim();
    if ("text" in value) return String(value.text ?? "").trim();
    return "";
  }
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : String(value).trim();
  return String(value).trim();
}

function addError(
  errorsFound: BulkValidationError[],
  rowNumber: number,
  field: string,
  message: string,
): void {
  errorsFound.push({ rowNumber, field, message });
}

function nullable(value: string): string | null {
  return value.trim() || null;
}

/** Lee y valida reglas propias del archivo, sin consultar la base de datos. */
export async function parseBulkInternWorkbook(buffer: Buffer): Promise<{
  rows: ParsedBulkIntern[];
  errors: BulkValidationError[];
  totalRows: number;
}> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (cause) {
    throw errors.validation(
      "El archivo no es un Excel .xlsx valido o esta dañado.",
      { cause: String(cause) },
    );
  }

  const worksheet =
    workbook.getWorksheet("Practicantes") ?? workbook.worksheets[0];
  if (!worksheet)
    throw errors.validation("El archivo no contiene hojas de calculo.");

  const headerIndexes = new Map<string, number>();
  const unknownHeaders: string[] = [];
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const header = normalizeHeader(cellText(worksheet.getCell(1, column)));
    if (!header) continue;
    if (!BULK_HEADERS.includes(header as (typeof BULK_HEADERS)[number]))
      unknownHeaders.push(header);
    else headerIndexes.set(header, column);
  }

  const missing = [...REQUIRED_HEADERS].filter(
    (header) => !headerIndexes.has(header),
  );
  if (unknownHeaders.length > 0 || missing.length > 0) {
    throw errors.validation(
      "Los encabezados de la hoja Practicantes no coinciden con la plantilla.",
      {
        desconocidos: unknownHeaders,
        faltantes: missing,
        encabezadosEsperados: BULK_HEADERS,
      },
    );
  }

  const errorsFound: BulkValidationError[] = [];
  const rows: ParsedBulkIntern[] = [];
  const seenDni = new Map<string, number>();
  const lastRow = Math.min(
    worksheet.actualRowCount,
    config.BULK_IMPORT_MAX_ROWS + 1,
  );
  const physicalRows = Math.max(0, worksheet.actualRowCount - 1);
  if (physicalRows > config.BULK_IMPORT_MAX_ROWS) {
    throw errors.validation(
      `El archivo supera el limite de ${config.BULK_IMPORT_MAX_ROWS} filas.`,
      {
        maxRows: config.BULK_IMPORT_MAX_ROWS,
      },
    );
  }

  const get = (row: ExcelJS.Row, header: string): string => {
    const column = headerIndexes.get(header);
    return column ? cellText(row.getCell(column)) : "";
  };

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const rawValues = [...headerIndexes.keys()].map((header) =>
      get(row, header),
    );
    if (rawValues.every((value) => !value)) continue;

    const dni = get(row, "dni").replace(/\s+/g, "");
    const firstNames = get(row, "nombres");
    const lastNames = get(row, "apellidos");
    const siteCode = get(row, "codigo_sede").toUpperCase();
    const areaGroup = nullable(get(row, "area_grupo"));
    const phone = nullable(get(row, "telefono"));
    const email = nullable(get(row, "correo"));
    const rowErrorsBefore = errorsFound.length;

    if (!DNI_PATTERN.test(dni))
      addError(
        errorsFound,
        rowNumber,
        "dni",
        "Debe contener entre 8 y 12 digitos numericos.",
      );
    if (seenDni.has(dni)) {
      addError(
        errorsFound,
        rowNumber,
        "dni",
        `Esta repetido en la fila ${seenDni.get(dni)}.`,
      );
    } else if (dni) {
      seenDni.set(dni, rowNumber);
    }
    if (firstNames.length < 2 || firstNames.length > 120)
      addError(
        errorsFound,
        rowNumber,
        "nombres",
        "Debe tener entre 2 y 120 caracteres.",
      );
    if (lastNames.length < 2 || lastNames.length > 120)
      addError(
        errorsFound,
        rowNumber,
        "apellidos",
        "Debe tener entre 2 y 120 caracteres.",
      );
    if (!siteCode)
      addError(errorsFound, rowNumber, "codigo_sede", "Es obligatorio.");
    if (areaGroup && areaGroup.length > 120)
      addError(
        errorsFound,
        rowNumber,
        "area_grupo",
        "No puede superar 120 caracteres.",
      );
    if (phone && phone.length > 30)
      addError(
        errorsFound,
        rowNumber,
        "telefono",
        "No puede superar 30 caracteres.",
      );
    if (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 160))
      addError(
        errorsFound,
        rowNumber,
        "correo",
        "Debe ser un correo valido de hasta 160 caracteres.",
      );

    const schedule: BulkScheduleSlot[] = [];
    for (const day of WEEKDAYS) {
      const start = get(row, `${day.name}_entrada`);
      const end = get(row, `${day.name}_salida`);
      if (!start && !end) continue;
      if (!start || !end) {
        addError(
          errorsFound,
          rowNumber,
          `${day.name}_entrada/salida`,
          "Completa entrada y salida, o deja ambas vacias.",
        );
        continue;
      }
      if (!TIME_PATTERN.test(start))
        addError(
          errorsFound,
          rowNumber,
          `${day.name}_entrada`,
          "Usa formato HH:mm.",
        );
      if (!TIME_PATTERN.test(end))
        addError(
          errorsFound,
          rowNumber,
          `${day.name}_salida`,
          "Usa formato HH:mm.",
        );
      if (TIME_PATTERN.test(start) && TIME_PATTERN.test(end)) {
        const startMinute = hhmmToMinutes(start);
        const endMinute = hhmmToMinutes(end);
        if (endMinute <= startMinute)
          addError(
            errorsFound,
            rowNumber,
            `${day.name}_salida`,
            "Debe ser posterior a la entrada.",
          );
        else
          schedule.push({
            weekday: day.weekday,
            startTime: start,
            endTime: end,
          });
      }
    }

    if (errorsFound.length === rowErrorsBefore) {
      rows.push({
        rowNumber,
        dni,
        firstNames,
        lastNames,
        siteCode,
        areaGroup,
        phone,
        email,
        schedule,
      });
    }
  }

  return { rows, errors: errorsFound, totalRows: physicalRows };
}

/** Valida el archivo completo incluyendo sedes activas y DNIs existentes. */
export async function previewBulkInterns(buffer: Buffer): Promise<BulkPreview> {
  const parsed = await parseBulkInternWorkbook(buffer);
  const errorsFound = [...parsed.errors];
  const siteCodes = [...new Set(parsed.rows.map((row) => row.siteCode))];
  const dnis = parsed.rows.map((row) => row.dni);
  const [sites, existingUsers] = await Promise.all([
    prisma.site.findMany({
      where: { code: { in: siteCodes } },
      select: {
        id: true,
        code: true,
        name: true,
        timezone: true,
        active: true,
      },
    }),
    prisma.userAccount.findMany({
      where: { dni: { in: dnis } },
      select: { dni: true },
    }),
  ]);
  const sitesByCode = new Map(
    sites.map((site) => [site.code.toUpperCase(), site]),
  );
  const existingDni = new Set(existingUsers.map((user) => user.dni));
  const rows: ValidatedBulkIntern[] = [];

  for (const row of parsed.rows) {
    const before = errorsFound.length;
    const site = sitesByCode.get(row.siteCode);
    if (!site)
      addError(
        errorsFound,
        row.rowNumber,
        "codigo_sede",
        `No existe la sede activa ${row.siteCode}.`,
      );
    else if (!site.active)
      addError(
        errorsFound,
        row.rowNumber,
        "codigo_sede",
        `La sede ${row.siteCode} esta inactiva.`,
      );
    if (existingDni.has(row.dni))
      addError(
        errorsFound,
        row.rowNumber,
        "dni",
        `Ya existe un usuario con el DNI ${row.dni}.`,
      );
    if (errorsFound.length === before && site) {
      rows.push({
        ...row,
        siteId: site.id,
        siteName: site.name,
        siteTimezone: site.timezone,
      });
    }
  }

  const errorRows = new Set(errorsFound.map((error) => error.rowNumber));
  return {
    rows,
    errors: errorsFound,
    summary: {
      totalRows: parsed.totalRows,
      validRows: rows.length,
      errorRows: errorRows.size,
    },
  };
}

export async function importBulkInterns(
  buffer: Buffer,
  adminUserId: string,
  context: AuditContext,
) {
  const preview = await previewBulkInterns(buffer);
  await recordAudit({
    ...context,
    actorUserId: adminUserId,
    actorRole: "ADMINISTRADOR",
    action: "CARGA_MASIVA_VALIDADA",
    entityType: "BulkImport",
    after: preview.summary,
  });
  if (preview.errors.length > 0 || preview.rows.length === 0) {
    throw errors.validation(
      "La carga no puede confirmarse porque contiene errores.",
      preview.errors,
    );
  }

  const batchId = newId();
  const prepared: Array<{
    row: ValidatedBulkIntern;
    temporaryPassword: string;
    passwordHash: string;
  }> = [];
  for (const row of preview.rows) {
    const temporaryPassword = generateTemporaryPassword(10);
    prepared.push({
      row,
      temporaryPassword,
      passwordHash: await hashPassword(temporaryPassword),
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const credentials: Array<{
      dni: string;
      fullName: string;
      siteCode: string;
      temporaryPassword: string;
    }> = [];
    for (const item of prepared) {
      const { row } = item;
      const displayName = `${row.firstNames} ${row.lastNames}`;
      const user = await tx.userAccount.create({
        data: {
          dni: row.dni,
          passwordHash: item.passwordHash,
          role: "PRACTICANTE",
          status: "ACTIVO",
          mustChangePassword: true,
          displayName,
          email: row.email,
        },
      });
      const intern = await tx.intern.create({
        data: {
          userId: user.id,
          dni: row.dni,
          firstNames: row.firstNames,
          lastNames: row.lastNames,
          siteId: row.siteId,
          areaGroup: row.areaGroup,
          phone: row.phone,
          email: row.email,
        },
      });

      if (row.schedule.length > 0) {
        const effectiveFrom = dateOnlyValue(
          businessDateString(new Date(), row.siteTimezone),
        );
        await tx.scheduleEntry.createMany({
          data: row.schedule.map((slot) => ({
            internId: intern.id,
            weekday: slot.weekday,
            startMinute: hhmmToMinutes(slot.startTime),
            endMinute: slot.endTime ? hhmmToMinutes(slot.endTime) : null,
            effectiveFrom,
            createdBy: adminUserId,
          })),
        });
      }

      credentials.push({
        dni: row.dni,
        fullName: displayName,
        siteCode: row.siteCode,
        temporaryPassword: item.temporaryPassword,
      });
      await recordAudit(
        {
          ...context,
          actorUserId: adminUserId,
          actorRole: "ADMINISTRADOR",
          action: "PRACTICANTE_CREADO",
          entityType: "Intern",
          entityId: intern.id,
          after: {
            dni: row.dni,
            displayName,
            siteId: row.siteId,
            source: "CARGA_MASIVA",
            batchId,
          },
        },
        tx,
      );
    }

    await recordAudit(
      {
        ...context,
        actorUserId: adminUserId,
        actorRole: "ADMINISTRADOR",
        action: "CARGA_MASIVA_IMPORTADA",
        entityType: "BulkImport",
        entityId: batchId,
        after: {
          batchId,
          importedCount: credentials.length,
          dnis: credentials.map((item) => item.dni),
        },
      },
      tx,
    );
    return credentials;
  });

  return { batchId, importedCount: created.length, credentials: created };
}
