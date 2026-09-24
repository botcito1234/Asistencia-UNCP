/** Formateo consistente de fechas, horas y cifras en todo el panel. */

const LOCALE = 'es-PE';

/**
 * Zona horaria de la institucion, informada por el servidor al arrancar.
 *
 * Sin esto, "hoy" seria el dia del navegador: un administrador que consulta
 * desde otra region veria el dia equivocado y, peor, filtraria por un rango que
 * no corresponde a la jornada real de las sedes.
 */
let zonaInstitucion: string | null = null;

export function fijarZonaInstitucion(zona: string | null): void {
  zonaInstitucion = zona;
}

/** Fecha de hoy en la zona de la institucion (o la del navegador, si aun no llego). */
export function hoyISO(): string {
  if (zonaInstitucion) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zonaInstitucion,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      // Zona desconocida para este navegador: se sigue con la local.
    }
  }
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

export function sumarDias(iso: string, dias: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function inicioDeMes(iso: string): string {
  return iso.slice(0, 7) + '-01';
}

export function finDeMes(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function fechaLarga(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const base = iso.length === 10 ? iso + 'T12:00:00Z' : iso;
  return new Date(base).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function hora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

export function desdeAhora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const minutos = Math.round(diff / 60000);
  if (minutos < 1) return 'hace un momento';
  if (minutos < 60) return 'hace ' + minutos + ' min';
  const horas = Math.round(minutos / 60);
  if (horas < 24) return 'hace ' + horas + ' h';
  const dias = Math.round(horas / 24);
  if (dias < 30) return 'hace ' + dias + ' d';
  return fechaCorta(iso);
}

export function numero(valor: number | null | undefined, decimales = 0): string {
  if (valor === null || valor === undefined) return '—';
  return valor.toLocaleString(LOCALE, { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

export function metros(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  return numero(valor, valor < 10 ? 1 : 0) + ' m';
}

export function porcentaje(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  return numero(valor, 1) + ' %';
}

export function duracionMinutos(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  const h = Math.floor(valor / 60);
  const m = valor % 60;
  if (h === 0) return m + ' min';
  return h + ' h ' + String(m).padStart(2, '0') + ' min';
}

export function bytes(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  if (valor < 1024) return valor + ' B';
  if (valor < 1024 * 1024) return numero(valor / 1024, 1) + ' KB';
  return numero(valor / (1024 * 1024), 1) + ' MB';
}

/** Texto legible para los tipos de evento de seguridad. */
export const ETIQUETA_EVENTO: Record<string, string> = {
  FUERA_DE_GEOCERCA: 'Fuera del radio de la sede',
  UBICACION_SIMULADA: 'Ubicación simulada',
  GPS_IMPRECISO: 'GPS impreciso',
  DISPOSITIVO_NO_AUTORIZADO: 'Dispositivo no autorizado',
  SESION_SIMULTANEA: 'Sesión simultánea',
  ENTRADA_DUPLICADA: 'Entrada duplicada',
  SALIDA_DUPLICADA: 'Salida duplicada',
  SALIDA_SIN_ENTRADA: 'Salida sin entrada',
  MARCACION_FUERA_DE_VENTANA: 'Fuera de la ventana horaria',
  CREDENCIALES_INVALIDAS: 'Credenciales inválidas',
  CUENTA_BLOQUEADA: 'Cuenta bloqueada',
  EVIDENCIA_INVALIDA: 'Evidencia inválida',
  INTENTO_SOSPECHOSO: 'Intento sospechoso',
  SALIDA_PENDIENTE: 'Salida pendiente',
  FALTA_REGISTRADA: 'Falta registrada',
  ARCHIVADO_FALLIDO: 'Fallo de archivado',
};

export const ETIQUETA_CAMPO_REGULARIZACION: Record<string, string> = {
  ENTRADA_HORA: 'Hora de entrada',
  SALIDA_HORA: 'Hora de salida',
  PUNTUALIDAD: 'Puntualidad',
  ESTADO_DIA: 'Estado del día',
  JUSTIFICACION: 'Justificación',
};

export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
