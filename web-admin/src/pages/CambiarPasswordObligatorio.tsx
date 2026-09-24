/**
 * Cambio obligatorio de la contrasena inicial.
 *
 * La contrasena temporal la conoce quien la genero (el seed o otro
 * administrador), asi que debe dejar de servir antes de dar acceso al panel.
 * El servidor rechaza cualquier otra ruta con 403 CAMBIO_PASSWORD_REQUERIDO
 * mientras tanto: esta pantalla solo refleja esa regla, no la impone.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, tokens } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Field, Input } from '../components/ui';

const REQUISITOS: { texto: string; cumple: (v: string) => boolean }[] = [
  { texto: 'Al menos 8 caracteres', cumple: (v) => v.length >= 8 },
  { texto: 'Una letra minúscula', cumple: (v) => /[a-z]/.test(v) },
  { texto: 'Una letra mayúscula', cumple: (v) => /[A-Z]/.test(v) },
  { texto: 'Un número', cumple: (v) => /[0-9]/.test(v) },
];

export function CambiarPasswordObligatorio() {
  const { user, salir } = useAuth();
  const navigate = useNavigate();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cumpleTodo = REQUISITOS.every((r) => r.cumple(nueva));
  const contieneDni = Boolean(user?.dni && user.dni.length >= 6 && nueva.includes(user.dni));
  const valido = actual.length > 0 && cumpleTodo && !contieneDni && nueva === repetir && nueva !== actual;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    setError(null);
    setEnviando(true);
    try {
      await api.post('/auth/cambiar-password', { currentPassword: actual, newPassword: nueva });
      // El servidor cierra todas las sesiones al cambiar la contrasena: se
      // limpia la local y se vuelve a entrar con la nueva.
      tokens.clear();
      await salir();
      navigate('/login', {
        replace: true,
        state: { aviso: 'Contraseña actualizada. Ingrese con su nueva contraseña.' },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Cambie su contraseña</h1>
          <p className="mt-1 text-sm text-slate-500">
            {user?.displayName} · DNI {user?.dni}
          </p>
        </div>

        <form onSubmit={enviar} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Por seguridad debe reemplazar la contraseña temporal antes de usar el panel.
          </div>

          <Field label="Contraseña actual" htmlFor="actual">
            <Input
              id="actual"
              type="password"
              autoComplete="current-password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
          </Field>

          <Field label="Nueva contraseña" htmlFor="nueva">
            <Input
              id="nueva"
              type="password"
              autoComplete="new-password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
            />
          </Field>

          <ul className="grid grid-cols-2 gap-1 text-xs">
            {REQUISITOS.map((r) => (
              <li key={r.texto} className={r.cumple(nueva) ? 'text-emerald-700' : 'text-slate-400'}>
                {r.cumple(nueva) ? '✓' : '○'} {r.texto}
              </li>
            ))}
            {contieneDni && <li className="col-span-2 text-rose-600">No puede contener su DNI</li>}
          </ul>

          <Field
            label="Repita la nueva contraseña"
            htmlFor="repetir"
            error={repetir.length > 0 && repetir !== nueva ? 'Las contraseñas no coinciden.' : undefined}
          >
            <Input
              id="repetir"
              type="password"
              autoComplete="new-password"
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
            />
          </Field>

          {error && (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <Button type="submit" cargando={enviando} disabled={!valido} className="w-full">
            Guardar contraseña
          </Button>

          <button
            type="button"
            onClick={() => void salir()}
            className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
