import { errors } from '../../core/errors.js';
import { educationCatalogSnapshot } from './education-catalog.snapshot.js';

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

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-PE').trim();
}

function relevance(name: string, query: string): number {
  const normalizedName = normalize(name);
  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;
  return 2;
}

/** Busca en la copia provincial del padrón oficial ESCALE/MINEDU. */
export async function searchPublicEducationalInstitutions(search: string): Promise<EducationalInstitutionOption[]> {
  const normalizedSearch = search.trim().replace(/\s+/g, ' ');
  if (normalizedSearch.length < 3 || normalizedSearch.length > 80) {
    throw errors.validation('Escriba entre 3 y 80 caracteres para buscar una institución.');
  }

  const query = normalize(normalizedSearch);
  return educationCatalogSnapshot
    .filter((institution) => normalize(institution.name).includes(query))
    .sort((a, b) => relevance(a.name, query) - relevance(b.name, query) || a.name.localeCompare(b.name, 'es-PE'))
    .slice(0, 50);
}
