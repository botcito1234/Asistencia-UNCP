import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/env.js", () => ({
  config: { BULK_IMPORT_MAX_ROWS: 500, LOG_LEVEL: "silent", NODE_ENV: "test" },
}));

const { parseBulkInternWorkbook } = await import("./bulk-intern.service.js");

async function workbookBuffer(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Practicantes");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("carga masiva de practicantes", () => {
  it("lee una fila valida y convierte el horario semanal", async () => {
    const buffer = await workbookBuffer([
      [
        "dni",
        "nombres",
        "apellidos",
        "codigo_sede",
        "lunes_entrada",
        "lunes_salida",
      ],
      [
        "70123456",
        "Ana María",
        "Pérez Quispe",
        "SEDE-CENTRO",
        "08:00",
        "13:00",
      ],
    ]);

    const result = await parseBulkInternWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      dni: "70123456",
      siteCode: "SEDE-CENTRO",
      schedule: [{ weekday: 1, startTime: "08:00", endTime: "13:00" }],
    });
  });

  it("reporta duplicados y horarios incompletos sin incluir la fila", async () => {
    const buffer = await workbookBuffer([
      [
        "dni",
        "nombres",
        "apellidos",
        "codigo_sede",
        "lunes_entrada",
        "lunes_salida",
      ],
      ["70123456", "Ana", "Pérez", "SEDE-CENTRO", "08:00", ""],
      ["70123456", "Luis", "Rojas", "SEDE-CENTRO", "10:00", "09:00"],
    ]);

    const result = await parseBulkInternWorkbook(buffer);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 2,
          field: "lunes_entrada/salida",
        }),
        expect.objectContaining({ rowNumber: 3, field: "dni" }),
        expect.objectContaining({ rowNumber: 3, field: "lunes_salida" }),
      ]),
    );
  });
});
