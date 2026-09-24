/**
 * Sedes y sus geocercas.
 *
 * Una sede nunca se elimina: se desactiva. Los datos historicos de asistencia
 * siguen apuntando a ella y deben poder consultarse. Cambiar el centro o el
 * radio no reescribe el pasado: las marcaciones guardan la distancia calculada
 * en su momento.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';
import { isValidCoordinate } from '../../domain/geo.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';
import { getSettings } from '../settings/settings.service.js';

export interface SiteInput {
  code: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  timezone?: string;
  active?: boolean;
}

const MIN_RADIUS = 10;
const MAX_RADIUS = 2000;

function validate(input: Partial<SiteInput>): void {
  if (input.latitude !== undefined && input.longitude !== undefined) {
    if (!isValidCoordinate({ latitude: input.latitude, longitude: input.longitude })) {
      throw errors.validation('Las coordenadas de la sede no son válidas.');
    }
  }
  if (input.radiusMeters !== undefined) {
    if (!Number.isInteger(input.radiusMeters) || input.radiusMeters < MIN_RADIUS || input.radiusMeters > MAX_RADIUS) {
      throw errors.validation('El radio debe ser un entero entre ' + MIN_RADIUS + ' y ' + MAX_RADIUS + ' metros.');
    }
  }
  if (input.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: input.timezone });
    } catch {
      throw errors.validation('Zona horaria inválida: ' + input.timezone);
    }
  }
  if (input.code !== undefined && !/^[A-Z0-9_-]{2,30}$/.test(input.code)) {
    throw errors.validation('El código de sede debe tener entre 2 y 30 caracteres (A-Z, 0-9, guion o guion bajo).');
  }
}

export async function createSite(input: SiteInput, adminUserId: string, context: AuditContext) {
  validate(input);
  const settings = await getSettings();

  const existing = await prisma.site.findUnique({ where: { code: input.code } });
  if (existing) throw errors.conflict('CONFLICTO', 'Ya existe una sede con el código ' + input.code + '.');

  const site = await prisma.site.create({
    data: {
      code: input.code,
      name: input.name.trim(),
      address: input.address.trim(),
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters ?? settings.defaultSiteRadiusMeters,
      timezone: input.timezone ?? 'America/Lima',
      active: input.active ?? true,
    },
  });

  await recordAudit({
    ...context,
    actorUserId: adminUserId,
    actorRole: 'ADMINISTRADOR',
    action: 'SEDE_CREADA',
    entityType: 'Site',
    entityId: site.id,
    after: serialize(site),
  });

  return serialize(site);
}

export async function updateSite(
  siteId: string,
  input: Partial<SiteInput>,
  adminUserId: string,
  context: AuditContext,
) {
  validate(input);

  const before = await prisma.site.findUnique({ where: { id: siteId } });
  if (!before) throw errors.notFound('Sede');

  if (input.code && input.code !== before.code) {
    const clash = await prisma.site.findUnique({ where: { code: input.code } });
    if (clash) throw errors.conflict('CONFLICTO', 'Ya existe una sede con el código ' + input.code + '.');
  }

  // Desactivar una sede con practicantes activos deja gente sin poder marcar:
  // se exige resolver la asignacion primero.
  if (input.active === false && before.active) {
    const activos = await prisma.intern.count({ where: { siteId, active: true } });
    if (activos > 0) {
      throw errors.conflict(
        'CONFLICTO',
        'No se puede desactivar la sede: tiene ' + activos + ' practicante(s) activo(s). Reasignelos o desactivelos primero.',
      );
    }
  }

  const data: Prisma.SiteUpdateInput = {};
  if (input.code !== undefined) data.code = input.code;
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.address !== undefined) data.address = input.address.trim();
  if (input.latitude !== undefined) data.latitude = input.latitude;
  if (input.longitude !== undefined) data.longitude = input.longitude;
  if (input.radiusMeters !== undefined) data.radiusMeters = input.radiusMeters;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.active !== undefined) data.active = input.active;

  const site = await prisma.site.update({ where: { id: siteId }, data });

  await recordAudit({
    ...context,
    actorUserId: adminUserId,
    actorRole: 'ADMINISTRADOR',
    action: input.active === false ? 'SEDE_DESACTIVADA' : 'SEDE_ACTUALIZADA',
    entityType: 'Site',
    entityId: siteId,
    before: serialize(before),
    after: serialize(site),
  });

  return serialize(site);
}

export async function listSites(params: { includeInactive?: boolean; withCounts?: boolean } = {}) {
  const sites = await prisma.site.findMany({
    where: params.includeInactive ? {} : { active: true },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });

  if (!params.withCounts) return sites.map(serialize);

  const counts = await prisma.intern.groupBy({
    by: ['siteId'],
    where: { active: true },
    _count: { _all: true },
  });
  const map = new Map(counts.map((c) => [c.siteId, c._count._all]));

  return sites.map((s) => ({ ...serialize(s), internCount: map.get(s.id) ?? 0 }));
}

export async function getSite(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw errors.notFound('Sede');
  const internCount = await prisma.intern.count({ where: { siteId, active: true } });
  return { ...serialize(site), internCount };
}

type SiteRow = Prisma.SiteGetPayload<object>;

export function serialize(site: SiteRow) {
  return {
    id: site.id,
    code: site.code,
    name: site.name,
    address: site.address,
    latitude: Number(site.latitude),
    longitude: Number(site.longitude),
    radiusMeters: site.radiusMeters,
    timezone: site.timezone,
    active: site.active,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}
