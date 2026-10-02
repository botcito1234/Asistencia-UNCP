import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env.js', () => ({
  config: {
    GOOGLE_MAPS_ENABLED: true,
    GOOGLE_MAPS_API_KEY: 'clave-de-prueba',
    GOOGLE_MAPS_TIMEOUT_MS: 1000,
  },
}));

const { computeRoute } = await import('./maps.service.js');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Google Maps Routes API', () => {
  it('envia la clave solo como cabecera y normaliza la ruta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [
            {
              distanceMeters: 812,
              duration: '146s',
              polyline: { encodedPolyline: 'abc123' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await computeRoute({
      origin: { latitude: -12.0464, longitude: -77.0428 },
      destination: { latitude: -13.5319, longitude: -71.9675 },
      mode: 'driving',
    });

    expect(result).toMatchObject({
      provider: 'google-routes',
      distanceMeters: 812,
      durationSeconds: 146,
      encodedPolyline: 'abc123',
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((request.headers as Record<string, string>)['x-goog-api-key']).toBe('clave-de-prueba');
    expect(String(request.body)).toContain('DRIVE');
  });

  it('traduce un fallo del proveedor a dependencia externa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('REQUEST_DENIED', { status: 403 })));

    await expect(
      computeRoute({
        origin: { latitude: -12.0464, longitude: -77.0428 },
        destination: { latitude: -13.5319, longitude: -71.9675 },
        mode: 'driving',
      }),
    ).rejects.toMatchObject({ code: 'DEPENDENCIA_EXTERNA', httpStatus: 502 });
  });
});
