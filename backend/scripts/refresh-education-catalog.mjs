import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const endpoint = 'https://escale.minedu.gob.pe/padron/rest/instituciones';
const provinceUbigeo = '1201';
const pageSize = 50;
const headers = {
  accept: 'application/xml,text/xml',
  'accept-language': 'es-PE,es;q=0.9',
  origin: 'http://escale3.minedu.gob.pe:8080',
  referer: 'http://escale3.minedu.gob.pe:8080/web/inicio/padron-de-iiee',
  'user-agent': 'Mozilla/5.0 (compatible; NEXORA-ControlAsistencia/1.0)',
};

function decodeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    if (code[0] === '#') {
      const point = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return entities[code.toLowerCase()] ?? entity;
  });
}

function tag(xml, name) {
  const qualified = '(?:[\\w.-]+:)?' + name;
  const pattern = new RegExp('<' + qualified + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + qualified + '\\s*>', 'i');
  return decodeXml(xml.match(pattern)?.[1]?.trim() ?? '');
}

function parsePage(xml) {
  const results = [];
  for (const item of xml.matchAll(/<(?:[\w.-]+:)?items\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?items\s*>/gi)) {
    const record = item[1] ?? '';
    const name = tag(record, 'cenEdu');
    const address = tag(record, 'dirCen');
    const management = tag(record, 'gestion');
    const localCode = tag(record, 'codlocal');
    const latitudeText = tag(record, 'nlatIE');
    const longitudeText = tag(record, 'nlongIE');
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (!name || !address || !management.startsWith('Pública') || !latitudeText || !longitudeText) continue;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) continue;
    if (latitude === 0 && longitude === 0) continue;
    const districtBlock = tag(record, 'distrito');
    const levelBlock = tag(record, 'nivelModalidad');
    results.push({
      name,
      address,
      district: tag(districtBlock, 'nombreDistrito'),
      level: tag(levelBlock, 'valor'),
      localCode,
      modularCode: tag(record, 'codMod'),
      latitude,
      longitude,
    });
  }
  return results;
}

async function main() {
  const byLocal = new Map();
  for (let start = 0; start < 4000; start += pageSize) {
    const params = new URLSearchParams({ ubigeo: provinceUbigeo, start: String(start), estados: '1' });
    for (const management of ['A1', 'A2', 'A3', 'A4']) params.append('gestiones', management);
    for (const form of ['S', 'N']) params.append('formas', form);
    const response = await fetch(endpoint + '?' + params, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('ESCALE respondió HTTP ' + response.status + ' al descargar desde ' + start + '.');
    const xml = await response.text();
    if (!/<(?:[\w.-]+:)?instituciones\b/i.test(xml)) throw new Error('ESCALE devolvió un formato no válido desde ' + start + '.');
    const rawCount = [...xml.matchAll(/<(?:[\w.-]+:)?items\b/gi)].length;
    for (const item of parsePage(xml)) {
      const key = item.localCode || item.name.toLocaleLowerCase() + '|' + item.latitude + '|' + item.longitude;
      if (!byLocal.has(key)) byLocal.set(key, item);
    }
    process.stdout.write('Página ' + start + ': ' + rawCount + ' registros, ' + byLocal.size + ' locales públicos con coordenadas.\n');
    if (rawCount < pageSize) break;
  }

  const snapshotPath = fileURLToPath(new URL('../src/modules/sites/education-catalog.snapshot.ts', import.meta.url));
  const updatedAt = new Date().toISOString().slice(0, 10);
  const source = '// Generado por scripts/refresh-education-catalog.mjs desde el padrón oficial ESCALE/MINEDU.\n' +
    '// Última actualización: ' + updatedAt + '. No editar a mano.\n' +
    "export const educationCatalogSnapshotUpdatedAt = '" + updatedAt + "';\n" +
    'export const educationCatalogSnapshot = ' + JSON.stringify([...byLocal.values()]) + ' as const;\n';
  await writeFile(snapshotPath, source, 'utf8');
  process.stdout.write('Guardado ' + byLocal.size + ' locales en ' + snapshotPath + '\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
