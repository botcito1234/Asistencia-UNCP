/** Contratos de datos que devuelve la API. */

export type Rol = 'ADMINISTRADOR' | 'PRACTICANTE';
export type EstadoJornada = 'PROGRAMADO' | 'PRESENTE' | 'AUSENTE' | 'NO_LABORABLE';
export type Puntualidad = 'PUNTUAL' | 'TARDANZA';
export type Severidad = 'INFO' | 'ADVERTENCIA' | 'CRITICO';

export interface Usuario {
  id: string;
  dni: string;
  role: Rol;
  displayName: string;
  mustChangePassword: boolean;
  intern: {
    id: string;
    firstNames: string;
    lastNames: string;
    areaGroup: string | null;
    consentAccepted: boolean;
    site: Sede;
  } | null;
}

export interface Sede {
  id: string;
  code: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  timezone: string;
  active?: boolean;
  internCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TableroSede {
  siteId: string;
  siteCode: string;
  siteName: string;
  total: number;
  presentes: number;
  puntuales: number;
  tardanzas: number;
  ausentes: number;
  salidas: number;
  todaviaDentro: number;
  salidasPendientes: number;
  sinJornada: number;
  alertas: number;
}

export interface Tablero {
  date: string;
  totals: Omit<TableroSede, 'siteId' | 'siteCode' | 'siteName'>;
  sites: TableroSede[];
}

export interface Marcacion {
  id: string;
  time: string;
  localTime: string;
  distanceMeters: number;
  accuracyMeters: number;
  latitude: number;
  longitude: number;
  evidenceId: string;
  photoUrl?: string;
}

export interface Jornada {
  id: string;
  businessDate: string;
  intern: {
    id: string;
    dni: string;
    fullName: string;
    firstNames: string;
    lastNames: string;
    areaGroup: string | null;
  };
  site: { id: string; code: string; name: string };
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  status: EstadoJornada;
  punctuality: Puntualidad | null;
  lateMinutes: number;
  pendingExit: boolean;
  regularized: boolean;
  archived: boolean;
  checkIn: Marcacion | null;
  checkOut: Marcacion | null;
  workedMinutes: number | null;
  regularizations: Regularizacion[];
  siteGeo?: { latitude: number; longitude: number; radiusMeters: number } | null;
}

export interface Regularizacion {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  admin: string;
  createdAt: string;
}

export interface Practicante {
  id: string;
  dni: string;
  fullName: string;
  firstNames: string;
  lastNames: string;
  areaGroup: string | null;
  active: boolean;
  accountStatus: string;
  lastLoginAt: string | null;
  site: { id: string; code: string; name: string };
  hasDevice: boolean;
  deviceModel: string | null;
  deviceBoundAt: string | null;
}

export interface PracticanteDetalle {
  id: string;
  userId: string;
  dni: string;
  firstNames: string;
  lastNames: string;
  fullName: string;
  areaGroup: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  accountStatus: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  consent: { accepted: boolean; acceptedAt: string | null; policyVersion: string | null };
  site: Sede;
  device: {
    id: string;
    platform: string;
    model: string | null;
    osVersion: string | null;
    appVersion: string | null;
    boundAt: string;
    lastSeenAt: string;
  } | null;
  schedule: FranjaHorario[];
}

export interface FranjaHorario {
  weekday: number;
  weekdayName: string;
  startTime: string | null;
  endTime: string | null;
  scheduleEntryId: string | null;
}

export interface ResumenPracticante {
  from: string;
  to: string;
  jornadasProgramadas: number;
  presentes: number;
  puntuales: number;
  tardanzas: number;
  minutosTardanzaTotal: number;
  ausentes: number;
  salidasPendientes: number;
  eventosSeguridad: number;
  porcentajePuntualidad: number | null;
}

export interface EventoSeguridad {
  id: string;
  type: string;
  severity: Severidad;
  message: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgeNote: string | null;
  intern: { id: string; dni: string; firstNames: string; lastNames: string } | null;
  site: { id: string; code: string; name: string } | null;
  acknowledger: { id: string; displayName: string } | null;
}

export interface Notificacion {
  id: string;
  type: string;
  severity: Severidad;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface Parametros {
  checkinEarlyWindowMinutes: number;
  gpsMaxAccuracyMeters: number;
  gpsMaxAgeSeconds: number;
  defaultSiteRadiusMeters: number;
  maxDeviceClockSkewSeconds: number;
  retentionMonths: number;
  dayCloseLocalTime: string;
  privacyPolicyVersion: string;
}

export interface LoteArchivado {
  id: string;
  site: { id: string; code: string; name: string };
  year: number;
  month: number;
  period: string;
  status: string;
  attendanceDays: number;
  marksCount: number;
  photosCount: number;
  eventsCount: number;
  packageBytes: number | null;
  packageSha256: string | null;
  driveFileId: string | null;
  driveWebLink: string | null;
  startedAt: string | null;
  uploadedAt: string | null;
  verifiedAt: string | null;
  releasedAt: string | null;
  lastError: string | null;
  attempts: number;
}

export interface Pagina<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface VistaPreviaReporte {
  kind: string;
  title: string;
  subtitle: string;
  from: string;
  to: string;
  generatedAt: string;
  columns: { key: string; header: string; align?: 'left' | 'right' | 'center' }[];
  rows: Record<string, string | number | null>[];
  totals: {
    jornadas: number;
    presentes: number;
    puntuales: number;
    tardanzas: number;
    ausentes: number;
    salidasRegistradas: number;
    salidasPendientes: number;
    minutosTardanza: number;
    eventosSeguridad: number;
    porcentajePuntualidad: number | null;
  } | null;
  bySite: { sede: string; jornadas: number; puntuales: number; tardanzas: number; ausentes: number; pendientes: number }[];
  filas: number;
  truncado: boolean;
}
