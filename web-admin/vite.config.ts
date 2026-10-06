import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 127.0.0.1 y no localhost: en Windows Node puede resolver localhost a ::1
  // (IPv6) mientras la API escucha en IPv4, y el proxy fallaria.
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4000';
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim();

  if (apiBaseUrl) {
    let parsedApiBaseUrl: URL;
    try {
      parsedApiBaseUrl = new URL(apiBaseUrl);
    } catch {
      throw new Error('VITE_API_BASE_URL debe ser el origen HTTP(S) de la API, sin ruta.');
    }
    if (
      !['http:', 'https:'].includes(parsedApiBaseUrl.protocol) ||
      !['', '/'].includes(parsedApiBaseUrl.pathname) ||
      parsedApiBaseUrl.search ||
      parsedApiBaseUrl.hash
    ) {
      throw new Error('VITE_API_BASE_URL debe ser el origen HTTP(S) de la API, sin ruta.');
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // En desarrollo se hace proxy a la API para evitar CORS y para que el
      // canal SSE funcione sin configuracion adicional.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            mapa: ['leaflet', 'react-leaflet'],
          },
        },
      },
    },
  };
});
