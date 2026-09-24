/** @type {import('tailwindcss').Config} */
//
// Los colores salen del manual de marca de Nexora (ver .frontend-design/BRAND.md).
// La escala se construye alrededor de sus tres valores oficiales, para no
// inventar colores nuevos:
//   600 = #2563EB (accion)   400 = #38BDF8 (acento)   900 = #0B1F3A (dominante)
//
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        marca: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#7dd3fc',
          400: '#38bdf8', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
          800: '#16305a', 900: '#0b1f3a',
        },
      },
      fontFamily: {
        sans: ['Sora', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
    },
  },
  plugins: [],
};
