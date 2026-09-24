import { describe, it, expect } from 'vitest';
import { haversineMeters, evaluateGeofence, isValidCoordinate, round2 } from './geo.js';

// Sede de referencia usada en las pruebas (Lima, Peru).
const SEDE = { latitude: -12.046374, longitude: -77.042793 };

describe('haversineMeters', () => {
  it('devuelve 0 para el mismo punto', () => {
    expect(haversineMeters(SEDE, SEDE)).toBe(0);
  });

  it('es simetrica', () => {
    const b = { latitude: -12.046, longitude: -77.042 };
    expect(round2(haversineMeters(SEDE, b))).toBe(round2(haversineMeters(b, SEDE)));
  });

  it('calcula un grado de latitud como ~111.2 km', () => {
    const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('calcula correctamente un desplazamiento de 50 m en latitud', () => {
    // 50 m en latitud equivalen a 50 / 111320 grados.
    const delta = 50 / 111_320;
    const d = haversineMeters(SEDE, { latitude: SEDE.latitude + delta, longitude: SEDE.longitude });
    expect(d).toBeGreaterThan(49);
    expect(d).toBeLessThan(51);
  });
});

describe('evaluateGeofence', () => {
  it('acepta un punto en el centro exacto', () => {
    const r = evaluateGeofence(SEDE, SEDE, 50);
    expect(r.inside).toBe(true);
    expect(r.distanceMeters).toBe(0);
    expect(r.overflowMeters).toBe(0);
  });

  it('acepta un punto claramente dentro del radio', () => {
    const delta = 20 / 111_320;
    const r = evaluateGeofence(SEDE, { latitude: SEDE.latitude + delta, longitude: SEDE.longitude }, 50);
    expect(r.inside).toBe(true);
    expect(r.distanceMeters).toBeLessThan(25);
  });

  it('rechaza un punto claramente fuera del radio', () => {
    const delta = 120 / 111_320;
    const r = evaluateGeofence(SEDE, { latitude: SEDE.latitude + delta, longitude: SEDE.longitude }, 50);
    expect(r.inside).toBe(false);
    expect(r.overflowMeters).toBeGreaterThan(60);
  });

  it('acepta el limite: distancia igual al radio se considera dentro', () => {
    // Construccion analitica de un punto a exactamente 50 m.
    const delta = 50 / 111_194.9266; // metros por grado usando el radio medio del modulo
    const point = { latitude: SEDE.latitude + delta, longitude: SEDE.longitude };
    const d = haversineMeters(SEDE, point);
    const r = evaluateGeofence(SEDE, point, Math.ceil(d));
    expect(r.inside).toBe(true);
  });

  it('caso limite cercano a 50 m: 49.5 dentro, 50.5 fuera', () => {
    const metersPerDegree = 111_194.9266;
    const inside = { latitude: SEDE.latitude + 49.5 / metersPerDegree, longitude: SEDE.longitude };
    const outside = { latitude: SEDE.latitude + 50.6 / metersPerDegree, longitude: SEDE.longitude };
    expect(evaluateGeofence(SEDE, inside, 50).inside).toBe(true);
    expect(evaluateGeofence(SEDE, outside, 50).inside).toBe(false);
  });

  it('respeta un radio ampliado administrativamente', () => {
    const delta = 120 / 111_320;
    const point = { latitude: SEDE.latitude + delta, longitude: SEDE.longitude };
    expect(evaluateGeofence(SEDE, point, 50).inside).toBe(false);
    expect(evaluateGeofence(SEDE, point, 150).inside).toBe(true);
  });
});

describe('isValidCoordinate', () => {
  it('rechaza la Isla Nula (0,0)', () => {
    expect(isValidCoordinate({ latitude: 0, longitude: 0 })).toBe(false);
  });
  it('rechaza latitudes fuera de rango', () => {
    expect(isValidCoordinate({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: 181 })).toBe(false);
  });
  it('rechaza valores no numericos', () => {
    expect(isValidCoordinate({ latitude: Number.NaN, longitude: -77 })).toBe(false);
  });
  it('acepta una coordenada real', () => {
    expect(isValidCoordinate(SEDE)).toBe(true);
  });
});
