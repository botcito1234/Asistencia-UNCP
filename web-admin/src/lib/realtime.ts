/**
 * Canal en tiempo real del panel (Server-Sent Events).
 *
 * El navegador reconecta solo, pero el token de acceso caduca cada 15 minutos,
 * asi que la conexion se renueva periodicamente con el token vigente. Si el
 * servidor cierra la conexion, se reintenta con espera creciente para no
 * martillear en una caida.
 */
import { useEffect, useRef, useState } from 'react';
import { tokens, API_BASE } from './api';

export type EventoTiempoReal = 'notificacion' | 'asistencia' | 'evento-seguridad';

type Manejador = (evento: EventoTiempoReal, datos: unknown) => void;

export function useRealtime(manejador: Manejador, activo: boolean): { conectado: boolean } {
  const [conectado, setConectado] = useState(false);
  const manejadorRef = useRef(manejador);
  manejadorRef.current = manejador;

  useEffect(() => {
    if (!activo) return;

    let fuente: EventSource | null = null;
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let renovacion: ReturnType<typeof setInterval> | null = null;
    let intentos = 0;
    let cerrado = false;

    const conectar = () => {
      if (cerrado) return;
      const token = tokens.access;
      if (!token) {
        reintento = setTimeout(conectar, 3000);
        return;
      }

      fuente?.close();
      fuente = new EventSource(API_BASE + '/notificaciones/stream?token=' + encodeURIComponent(token));

      fuente.addEventListener('open', () => {
        intentos = 0;
        setConectado(true);
      });

      for (const tipo of ['notificacion', 'asistencia', 'evento-seguridad'] as EventoTiempoReal[]) {
        fuente.addEventListener(tipo, (e) => {
          try {
            manejadorRef.current(tipo, JSON.parse((e as MessageEvent).data));
          } catch {
            // un mensaje mal formado no debe romper el canal
          }
        });
      }

      fuente.addEventListener('error', () => {
        setConectado(false);
        fuente?.close();
        if (cerrado) return;
        intentos++;
        const espera = Math.min(30_000, 1000 * Math.pow(2, Math.min(intentos, 5)));
        reintento = setTimeout(conectar, espera);
      });
    };

    conectar();

    // Reconexion preventiva antes de que caduque el access token.
    renovacion = setInterval(conectar, 10 * 60_000);

    return () => {
      cerrado = true;
      fuente?.close();
      if (reintento) clearTimeout(reintento);
      if (renovacion) clearInterval(renovacion);
      setConectado(false);
    };
  }, [activo]);

  return { conectado };
}
