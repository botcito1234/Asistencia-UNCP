import { describe, it, expect } from 'vitest';
import {
  evaluateCheckInWindow,
  evaluateLocationQuality,
  resolveDayClosure,
  maxUsableAccuracyForRadius,
  validatePasswordStrength,
} from './attendance-rules.js';

const H = (h: number, m = 0) => h * 60 + m;
const EARLY = 15;

describe('evaluateCheckInWindow (entrada programada 08:00, ventana 15 min)', () => {
  const scheduledStartMinute = H(8);
  const run = (nowMinutes: number) =>
    evaluateCheckInWindow({ nowMinutes, scheduledStartMinute, earlyWindowMinutes: EARLY });

  it('caso 3: rechaza 07:44 por ser demasiado temprano', () => {
    const r = run(H(7, 44));
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('DEMASIADO_TEMPRANO');
      expect(r.opensAtMinute).toBe(H(7, 45));
      expect(r.minutesUntilOpen).toBe(1);
    }
  });

  it('caso 2: acepta exactamente 07:45 como PUNTUAL', () => {
    const r = run(H(7, 45));
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.punctuality).toBe('PUNTUAL');
      expect(r.lateMinutes).toBe(0);
    }
  });

  it('acepta 07:52 como PUNTUAL', () => {
    const r = run(H(7, 52));
    expect(r.allowed && r.punctuality).toBe('PUNTUAL');
  });

  it('caso 1: acepta exactamente 08:00 como PUNTUAL (limite inclusivo)', () => {
    const r = run(H(8, 0));
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.punctuality).toBe('PUNTUAL');
      expect(r.lateMinutes).toBe(0);
    }
  });

  it('caso 4: 08:01 ya es TARDANZA - no hay tolerancia adicional', () => {
    const r = run(H(8, 1));
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.punctuality).toBe('TARDANZA');
      expect(r.lateMinutes).toBe(1);
    }
  });

  it('una llegada muy tardia (14:30) sigue permitida y cuenta los minutos', () => {
    const r = run(H(14, 30));
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.punctuality).toBe('TARDANZA');
      expect(r.lateMinutes).toBe(390);
    }
  });

  it('respeta horarios distintos por día (miercoles 07:30)', () => {
    const r = evaluateCheckInWindow({ nowMinutes: H(7, 20), scheduledStartMinute: H(7, 30), earlyWindowMinutes: EARLY });
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.punctuality).toBe('PUNTUAL');

    const tooEarly = evaluateCheckInWindow({ nowMinutes: H(7, 10), scheduledStartMinute: H(7, 30), earlyWindowMinutes: EARLY });
    expect(tooEarly.allowed).toBe(false);
  });
});

describe('evaluateLocationQuality', () => {
  const base = { maxAccuracyMeters: 35, maxAgeSeconds: 60, mockLocationReported: false, locationAgeMs: 1000 };

  it('acepta una lectura buena', () => {
    expect(evaluateLocationQuality({ ...base, accuracyMeters: 8 }).ok).toBe(true);
  });

  it('caso 8: la ubicación simulada gana a cualquier otra consideracion', () => {
    const r = evaluateLocationQuality({ ...base, accuracyMeters: 5, mockLocationReported: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('UBICACION_SIMULADA');
  });

  it('caso 7: rechaza precisión insuficiente para una geocerca de 50 m', () => {
    const r = evaluateLocationQuality({ ...base, accuracyMeters: 80 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('GPS_IMPRECISO');
  });

  it('acepta justo en el umbral de precisión', () => {
    expect(evaluateLocationQuality({ ...base, accuracyMeters: 35 }).ok).toBe(true);
  });

  it('rechaza una lectura obsoleta', () => {
    const r = evaluateLocationQuality({ ...base, accuracyMeters: 10, locationAgeMs: 180_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('GPS_OBSOLETO');
  });

  it('rechaza precisión no numerica o negativa', () => {
    expect(evaluateLocationQuality({ ...base, accuracyMeters: Number.NaN }).ok).toBe(false);
    expect(evaluateLocationQuality({ ...base, accuracyMeters: -5 }).ok).toBe(false);
  });

  it('tolera ausencia de dato de antiguedad', () => {
    expect(evaluateLocationQuality({ ...base, accuracyMeters: 12, locationAgeMs: null }).ok).toBe(true);
  });
});

describe('maxUsableAccuracyForRadius', () => {
  it('para radio 50 m devuelve 35 m', () => {
    expect(maxUsableAccuracyForRadius(50, 35)).toBe(35);
  });
  it('para radio pequeño reduce el umbral proporcionalmente', () => {
    expect(maxUsableAccuracyForRadius(20, 35)).toBe(14);
  });
  it('nunca baja de 10 m, para no volver imposible la marcación', () => {
    expect(maxUsableAccuracyForRadius(5, 35)).toBe(10);
  });
  it('respeta el techo absoluto configurado', () => {
    expect(maxUsableAccuracyForRadius(500, 35)).toBe(35);
  });
});

describe('resolveDayClosure', () => {
  it('caso 18: entrada sin salida deja SALIDA PENDIENTE', () => {
    const r = resolveDayClosure({ hasCheckIn: true, hasCheckOut: false, hasSchedule: true });
    expect(r.status).toBe('PRESENTE');
    expect(r.pendingExit).toBe(true);
  });

  it('jornada completa queda PRESENTE sin pendiente', () => {
    const r = resolveDayClosure({ hasCheckIn: true, hasCheckOut: true, hasSchedule: true });
    expect(r.status).toBe('PRESENTE');
    expect(r.pendingExit).toBe(false);
  });

  it('sin entrada y con horario es AUSENTE', () => {
    expect(resolveDayClosure({ hasCheckIn: false, hasCheckOut: false, hasSchedule: true }).status).toBe('AUSENTE');
  });

  it('sin horario el día no genera falta', () => {
    expect(resolveDayClosure({ hasCheckIn: false, hasCheckOut: false, hasSchedule: false }).status).toBe('NO_LABORABLE');
  });
});

describe('validatePasswordStrength', () => {
  it('acepta una contraseña razonable', () => {
    expect(validatePasswordStrength('Practica2026', 8).ok).toBe(true);
  });
  it('rechaza por longitud', () => {
    expect(validatePasswordStrength('Ab1', 8).ok).toBe(false);
  });
  it('rechaza si contiene el DNI', () => {
    const r = validatePasswordStrength('Clave12345678', 8, '12345678');
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toContain('DNI');
  });
  it('rechaza sin mayuscula, minuscula o digito', () => {
    expect(validatePasswordStrength('solominusculas', 8).ok).toBe(false);
    expect(validatePasswordStrength('SOLOMAYUSCULAS1', 8).ok).toBe(false);
    expect(validatePasswordStrength('SinNumeros', 8).ok).toBe(false);
  });
});
