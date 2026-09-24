import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/tests/global-setup.ts'],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
    // Un unico proceso: todas las pruebas comparten la misma base efimera y el
    // aislamiento se consigue limpiando las tablas entre pruebas, no lanzando
    // varias instancias de PostgreSQL.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
