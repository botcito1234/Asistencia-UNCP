import { errors } from '../../core/errors.js';

const ESCALE_ENDPOINT = 'https://escale.minedu.gob.pe/padron/rest/instituciones';
const HUANCAYO_PROVINCE_UBIGEO = '1201';
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

export interface EducationalInstitutionOption {
  name: string;
  address: string;
  district: string;
  level: string;
  localCode: string;
  modularCode: string;
  latitude: number;
  longitude: number;
}

const cache = new Map<string, { expiresAt: number; items: EducationalInstitutionOption[] }>();

function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    if (code[0] === '#') {
      const point = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return entities[code.toLowerCase()] ?? entity;
  });
}

function tag(xml: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedName}>`, 'i'));
  const value = match?.[1];
  return value ? decodeXml(value.trim()) : '';
}

function parseInstitutions(xml: string): EducationalInstitutionOption[] {
  const results: EducationalInstitutionOption[] = [];
  const seenLocals = new Set<string>();

  for (const match of xml.matchAll(/<items\b[^>]*>([\s\S]*?)<\/items>/gi)) {
    const record = match[1] ?? '';
    const name = tag(record, 'cenEdu');
    const address = tag(record, 'dirCen');
    const management = tag(record, 'gestion');
    const localCode = tag(record, 'codlocal');
    const latitudeText = tag(record, 'nlatIE');
    const longitudeText = tag(record, 'nlongIE');
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);

    // Solo se muestran locales públicos activos con dirección y coordenadas
    // propias del local; no se sustituyen con el centro poblado.
    if (
      !name ||
      !address ||
      !management.startsWith('Pública') ||
      !latitudeText ||
      !longitudeText ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180 ||
      (latitude === 0 && longitude === 0)
    ) {
      continue;
    }

    const key = localCode || `${name.toLocaleLowerCase()}|${latitude}|${longitude}`;
    if (seenLocals.has(key)) continue;
    seenLocals.add(key);

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

function cacheResult(key: string, items: EducationalInstitutionOption[]): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { items, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Busca locales educativos públicos activos del padrón oficial ESCALE/MINEDU. */
export async function searchPublicEducationalInstitutions(search: string): Promise<EducationalInstitutionOption[]> {
  const normalizedSearch = search.trim().replace(/\s+/g, ' ');
  if (normalizedSearch.length < 3 || normalizedSearch.length > 80) {
    throw errors.validation('Escriba entre 3 y 80 caracteres para buscar una institución.');
  }

  const cacheKey = normalizedSearch.toLocaleLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const params = new URLSearchParams({ ubigeo: HUANCAYO_PROVINCE_UBIGEO, nombreIE: normalizedSearch, start: '0' });
  params.append('estados', '1');
  for (const management of ['A1', 'A2', 'A3', 'A4']) params.append('gestiones', management);
  for (const form of ['S', 'N']) params.append('formas', form);

  let response: Response;
  try {
    response = await fetch(`${ESCALE_ENDPOINT}?${params}`, {
      headers: {
        accept: 'application/xml,text/xml',
        'accept-language': 'es-PE,es;q=0.9',
        origin: 'http://escale3.minedu.gob.pe:8080',
        referer: 'http://escale3.minedu.gob.pe:8080/web/inicio/padron-de-iiee',
        'user-agent': 'Mozilla/5.0 (compatible; NEXORA-ControlAsistencia/1.0)',
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (cause) {
    throw errors.dependency('No se pudo consultar el padrón educativo del MINEDU.', cause);
  }

  if (!response.ok) {
    throw errors.dependency('El padrón educativo del MINEDU no respondió correctamente.');
  }

  let xml: string;
  try {
    xml = await response.text();
  } catch (cause) {
    throw errors.dependency('No se pudo leer la respuesta del padrón educativo del MINEDU.', cause);
  }
  if (!xml.includes('<instituciones')) {
    throw errors.dependency('El padrón educativo del MINEDU devolvió una respuesta no válida.');
  }

  const items = parseInstitutions(xml);
  cacheResult(cacheKey, items);
  return items;
}
