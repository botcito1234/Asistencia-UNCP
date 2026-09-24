/**
 * Arranque del entorno de pruebas de integracion.
 *
 * Levanta un PostgreSQL real y efimero y aplica las migraciones del proyecto.
 * Se usa una base de verdad, no un doble, porque buena parte de las reglas que
 * hay que verificar viven EN la base: las restricciones unicas que impiden la
 * doble entrada, el trigger que exige entrada antes de salida y los CHECK de
 * coordenadas. Contra un simulador esas pruebas no demostrarian nada.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';

const require = createRequire(import.meta.url);

let pg: EmbeddedPostgres | null = null;
let dataDir: string | null = null;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export async function setup(): Promise<void> {
  dataDir = await mkdtemp(path.join(tmpdir(), 'asistencia-pg-'));
  const port = await freePort();
  const user = 'asistencia_test';
  const password = 'asistencia_test';
  const database = 'asistencia_test';

  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: false,
    // Silencia el ruido de arranque de PostgreSQL en la salida de las pruebas.
    onLog: () => undefined,
  });

  process.stdout.write('\n[pruebas] Iniciando PostgreSQL efimero en el puerto ' + port + '...\n');
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(database);

  const url =
    'postgresql://' + user + ':' + password + '@127.0.0.1:' + port + '/' + database + '?schema=public&connection_limit=10';

  process.env.DATABASE_URL = url;
  // PostgreSQL efimero, sin agrupador: la conexion directa es la misma.
  process.env.DIRECT_DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.ENABLE_CRON = 'false';
  process.env.LOG_LEVEL = 'fatal';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'clave-de-pruebas-suficientemente-larga-para-hs256-0123456789';
  process.env.STORAGE_ROOT = path.join(dataDir, 'storage');
  process.env.GOOGLE_DRIVE_ENABLED = 'false';
  process.env.PUSH_ENABLED = 'false';
  process.env.SMTP_ENABLED = 'false';

  process.stdout.write('[pruebas] Aplicando migraciones...\n');
  // Se invoca el CLI de Prisma con el propio Node en lugar de `npx`: en Windows
  // spawnSync sobre un .cmd falla con EINVAL desde Node 20.
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    stdio: 'pipe',
    cwd: process.cwd(),
  });

  process.stdout.write('[pruebas] Base de datos lista.\n');
}

export async function teardown(): Promise<void> {
  try {
    if (pg) await pg.stop();
  } catch {
    // el proceso ya podria haber terminado
  }
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
