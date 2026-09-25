/**
 * Guardas de configuracion en produccion.
 *
 * Existen porque un despliegue mal configurado no falla de forma visible: el
 * servicio arranca y parece sano, pero el archivado nunca sube nada o los
 * enlaces se generan con http. Es preferible que no arranque.
 *
 * Estas pruebas nacieron de un fallo real: la guarda exigia la cuenta de
 * servicio de Google aunque el sistema ya aceptaba la autorizacion de un
 * usuario, y dejaba el contenedor en ciclo de reinicio con un mensaje que
 * pedia justo lo que no hacia falta.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const BASE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:c@servidor:5432/base',
  JWT_SECRET: 'una-clave-suficientemente-larga-para-pasar-la-validacion',
  PUBLIC_BASE_URL: 'https://asistencia.ejemplo.pe',
};

/** Carga el modulo de configuracion con un entorno dado. */
async function cargar(entorno: Record<string, string>) {
  vi.resetModules();
  process.env = { ...BASE, ...entorno } as NodeJS.ProcessEnv;
  return import('./env.js');
}

let entornoOriginal: NodeJS.ProcessEnv;

beforeEach(() => {
  entornoOriginal = process.env;
});

afterEach(() => {
  process.env = entornoOriginal;
  vi.resetModules();
});

describe('Configuración de producción', () => {
  it('acepta Drive con la autorización de un usuario, sin cuenta de servicio', async () => {
    const modulo = await cargar({
      GOOGLE_DRIVE_ENABLED: 'true',
      GOOGLE_DRIVE_ROOT_FOLDER_ID: 'carpeta-123',
      GOOGLE_OAUTH_CLIENT_ID: 'cliente.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: 'secreto',
      GOOGLE_OAUTH_REFRESH_TOKEN: '1//token',
    });

    expect(modulo.config.GOOGLE_DRIVE_ENABLED).toBe(true);
  });

  it('acepta Drive con cuenta de servicio, sin autorización de usuario', async () => {
    const modulo = await cargar({
      GOOGLE_DRIVE_ENABLED: 'true',
      GOOGLE_DRIVE_ROOT_FOLDER_ID: 'carpeta-123',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'robot@proyecto.iam.gserviceaccount.com',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----\\n',
    });

    expect(modulo.config.GOOGLE_DRIVE_ENABLED).toBe(true);
  });

  it('rechaza Drive habilitado sin ninguna credencial', async () => {
    await expect(cargar({ GOOGLE_DRIVE_ENABLED: 'true', GOOGLE_DRIVE_ROOT_FOLDER_ID: 'carpeta-123' })).rejects.toThrow(
      /no hay credenciales/i,
    );
  });

  it('rechaza Drive habilitado sin carpeta de destino', async () => {
    await expect(
      cargar({
        GOOGLE_DRIVE_ENABLED: 'true',
        GOOGLE_OAUTH_CLIENT_ID: 'cliente',
        GOOGLE_OAUTH_CLIENT_SECRET: 'secreto',
        GOOGLE_OAUTH_REFRESH_TOKEN: 'token',
      }),
    ).rejects.toThrow(/GOOGLE_DRIVE_ROOT_FOLDER_ID/);
  });

  it('rechaza guardar evidencias en Drive con Drive apagado', async () => {
    await expect(cargar({ EVIDENCE_REMOTE_STORAGE: 'true' })).rejects.toThrow(/exige GOOGLE_DRIVE_ENABLED/);
  });

  it('rechaza una URL pública sin https', async () => {
    await expect(cargar({ PUBLIC_BASE_URL: 'http://asistencia.ejemplo.pe' })).rejects.toThrow(/https/);
  });

  it('no aplica ninguna de estas guardas fuera de producción', async () => {
    const modulo = await cargar({ NODE_ENV: 'development', PUBLIC_BASE_URL: 'http://localhost:4000', EVIDENCE_REMOTE_STORAGE: 'true' });
    expect(modulo.config.isProduction).toBe(false);
  });
});
