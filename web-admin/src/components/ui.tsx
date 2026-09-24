/**
 * Componentes base del panel.
 *
 * Un unico lugar define los colores semanticos (presente, tardanza, falta,
 * critico) para que el mismo estado se vea igual en el tablero, en las tablas y
 * en los reportes.
 */
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------------

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'rounded-xl border border-slate-200 bg-white shadow-sm ' + className}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

type Tono = 'neutro' | 'exito' | 'aviso' | 'peligro' | 'info';

const TONO_CLASES: Record<Tono, string> = {
  neutro: 'bg-slate-100 text-slate-700 ring-slate-200',
  exito: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  aviso: 'bg-amber-50 text-amber-800 ring-amber-200',
  peligro: 'bg-rose-50 text-rose-700 ring-rose-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
};

export function Badge({ children, tono = 'neutro' }: { children: ReactNode; tono?: Tono }) {
  return (
    <span className={'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ' + TONO_CLASES[tono]}>
      {children}
    </span>
  );
}

export function EstadoBadge({ estado }: { estado: string }) {
  const mapa: Record<string, { texto: string; tono: Tono }> = {
    PRESENTE: { texto: 'Presente', tono: 'exito' },
    AUSENTE: { texto: 'Falta', tono: 'peligro' },
    PROGRAMADO: { texto: 'Programado', tono: 'neutro' },
    NO_LABORABLE: { texto: 'Sin jornada', tono: 'neutro' },
  };
  const v = mapa[estado] ?? { texto: estado, tono: 'neutro' as Tono };
  return <Badge tono={v.tono}>{v.texto}</Badge>;
}

export function PuntualidadBadge({ valor }: { valor: string | null }) {
  if (!valor) return <span className="text-slate-400">—</span>;
  return <Badge tono={valor === 'PUNTUAL' ? 'exito' : 'aviso'}>{valor === 'PUNTUAL' ? 'Puntual' : 'Tardanza'}</Badge>;
}

export function SeveridadBadge({ valor }: { valor: string }) {
  const tono: Tono = valor === 'CRITICO' ? 'peligro' : valor === 'ADVERTENCIA' ? 'aviso' : 'info';
  const texto = valor === 'CRITICO' ? 'Crítico' : valor === 'ADVERTENCIA' ? 'Advertencia' : 'Informativo';
  return <Badge tono={tono}>{texto}</Badge>;
}

export function Metric({
  label,
  value,
  hint,
  tono = 'neutro',
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tono?: Tono;
  onClick?: () => void;
}) {
  const acento: Record<Tono, string> = {
    neutro: 'text-slate-900',
    exito: 'text-emerald-600',
    aviso: 'text-amber-600',
    peligro: 'text-rose-600',
    info: 'text-sky-600',
  };

  const contenido = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={'mt-1 text-2xl font-semibold tabular-nums ' + acento[tono]}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-marca-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-marca-400"
      >
        {contenido}
      </button>
    );
  }

  return <div className="rounded-lg border border-slate-200 bg-white p-4">{contenido}</div>;
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

type VarianteBoton = 'primario' | 'secundario' | 'peligro' | 'fantasma';

const BOTON_CLASES: Record<VarianteBoton, string> = {
  primario: 'bg-marca-700 text-white hover:bg-marca-800 focus:ring-marca-500 disabled:bg-marca-300',
  secundario: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus:ring-marca-500',
  peligro: 'bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-400 disabled:bg-rose-300',
  fantasma: 'text-marca-700 hover:bg-marca-50 focus:ring-marca-400',
};

export function Button({
  children,
  variante = 'primario',
  cargando = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBoton; cargando?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || cargando}
      className={
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70 ' +
        BOTON_CLASES[variante] +
        ' ' +
        className
      }
    >
      {cargando && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error ? (
        <p className="mt-1 text-xs text-rose-600">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>
      )}
    </div>
  );
}

const CONTROL_BASE =
  'block w-full rounded-lg border-0 py-2 px-3 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-marca-500 disabled:bg-slate-50 disabled:text-slate-500';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={CONTROL_BASE + ' ' + (props.className ?? '')} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={CONTROL_BASE + ' ' + (props.className ?? '')} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={CONTROL_BASE + ' ' + (props.className ?? '')} />;
}

// ---------------------------------------------------------------------------
// Tabla
// ---------------------------------------------------------------------------

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, align = 'left' }: { children?: ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={'whitespace-nowrap py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 text-' + align}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return <td className={'whitespace-nowrap py-2.5 pr-4 text-slate-700 text-' + align + ' ' + className}>{children}</td>;
}

export function EmptyState({ titulo, descripcion, accion }: { titulo: string; descripcion?: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
      <p className="text-sm font-medium text-slate-700">{titulo}</p>
      {descripcion && <p className="mt-1 max-w-md text-sm text-slate-500">{descripcion}</p>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}

export function Loading({ texto = 'Cargando...' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-marca-500 border-r-transparent" />
      {texto}
    </div>
  );
}

export function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const mensaje =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Ocurrio un error inesperado.';
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
      <p className="text-sm font-medium text-rose-800">No se pudo completar la operación</p>
      <p className="mt-1 text-sm text-rose-700">{mensaje}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 text-sm font-medium text-rose-800 underline">
          Reintentar
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogo
// ---------------------------------------------------------------------------

export function Modal({
  abierto,
  onCerrar,
  titulo,
  children,
  ancho = 'max-w-lg',
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  children: ReactNode;
  ancho?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    document.addEventListener('keydown', onKey);
    // Se mueve el foco al dialogo para que el teclado no quede detras.
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onCerrar} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={'relative w-full ' + ancho + ' rounded-xl bg-white shadow-xl focus:outline-none'}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">{titulo}</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/** Aviso temporal; se usa para confirmar acciones sin interrumpir el flujo. */
export function useToast() {
  const [mensaje, setMensaje] = useState<{ texto: string; tono: Tono } | null>(null);

  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), 5000);
    return () => clearTimeout(t);
  }, [mensaje]);

  const Toast = mensaje ? (
    <div
      role="status"
      className={
        'fixed bottom-6 right-6 z-50 max-w-sm rounded-lg px-4 py-3 text-sm shadow-lg ring-1 ring-inset ' +
        TONO_CLASES[mensaje.tono]
      }
    >
      {mensaje.texto}
    </div>
  ) : null;

  return {
    Toast,
    exito: (texto: string) => setMensaje({ texto, tono: 'exito' }),
    error: (texto: string) => setMensaje({ texto, tono: 'peligro' }),
    aviso: (texto: string) => setMensaje({ texto, tono: 'aviso' }),
  };
}
