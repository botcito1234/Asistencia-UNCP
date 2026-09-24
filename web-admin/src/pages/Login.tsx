import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Button, Field, Input } from '../components/ui';

export function Login() {
  const { user, cargando, entrar } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const aviso = (location.state as { aviso?: string } | null)?.aviso;
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-marca-600 border-r-transparent" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await entrar(dni.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img
            src="/marca/uncp-escudo.png"
            alt="Escudo de la Universidad Nacional del Centro del Perú"
            className="mx-auto h-20 w-auto"
            width={92}
            height={80}
          />
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Control de Asistencia</h1>
          <p className="mt-1 text-sm font-medium text-marca-900">
            Universidad Nacional del Centro del Perú
          </p>
          <p className="mt-0.5 text-sm text-slate-500">Panel administrativo</p>
        </div>

        <form onSubmit={enviar} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Field label="DNI" htmlFor="dni">
            <Input
              id="dni"
              name="dni"
              inputMode="numeric"
              autoComplete="username"
              required
              maxLength={12}
              value={dni}
              onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))}
              placeholder="12345678"
            />
          </Field>

          <Field label="Contraseña" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          {aviso && !error && (
            <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {aviso}
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <Button type="submit" cargando={enviando} className="w-full">
            Ingresar
          </Button>

          <p className="text-center text-xs text-slate-500">
            Los practicantes registran su asistencia desde la aplicación móvil.
          </p>
        </form>

        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          Desarrollado por
          <img src="/marca/nexora-isotipo.png" alt="" aria-hidden="true" className="h-4 w-auto" />
          <span className="font-medium text-slate-500">Nexora</span>
        </p>
      </div>
    </div>
  );
}
