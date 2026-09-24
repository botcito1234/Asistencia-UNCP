/**
 * Canal en tiempo real para el panel web (Server-Sent Events).
 *
 * Decision: SSE en lugar de WebSocket. El flujo es unidireccional
 * (servidor -> panel), atraviesa proxies y balanceadores sin configuracion
 * especial y se reconecta solo. Un WebSocket anadiria complejidad sin aportar
 * nada aqui.
 */
import type { Response } from 'express';
import { logger } from '../../core/logger.js';

export type RealtimeEvent =
  | 'notificacion'
  | 'asistencia'
  | 'evento-seguridad'
  | 'ping';

interface Subscriber {
  id: string;
  userId: string;
  res: Response;
}

const subscribers = new Map<string, Subscriber>();
let heartbeat: NodeJS.Timeout | null = null;

export function addSubscriber(id: string, userId: string, res: Response): void {
  subscribers.set(id, { id, userId, res });
  startHeartbeat();
  logger.debug({ subscriberId: id, userId, total: subscribers.size }, 'Suscriptor SSE conectado.');
}

export function removeSubscriber(id: string): void {
  subscribers.delete(id);
  if (subscribers.size === 0) stopHeartbeat();
}

function write(sub: Subscriber, event: RealtimeEvent, payload: unknown): void {
  try {
    sub.res.write('event: ' + event + '\n');
    sub.res.write('data: ' + JSON.stringify(payload) + '\n\n');
  } catch {
    removeSubscriber(sub.id);
  }
}

/** Difunde a todos los administradores conectados. */
export function broadcast(event: RealtimeEvent, payload: unknown): void {
  for (const sub of subscribers.values()) write(sub, event, payload);
}

/** Envia solo a un usuario concreto (todas sus pestanas abiertas). */
export function sendToUser(userId: string, event: RealtimeEvent, payload: unknown): void {
  for (const sub of subscribers.values()) {
    if (sub.userId === userId) write(sub, event, payload);
  }
}

function startHeartbeat(): void {
  if (heartbeat) return;
  // Comentario SSE cada 25 s: mantiene viva la conexion frente a proxies que
  // cortan conexiones inactivas.
  heartbeat = setInterval(() => {
    for (const sub of subscribers.values()) {
      try {
        sub.res.write(': keep-alive\n\n');
      } catch {
        removeSubscriber(sub.id);
      }
    }
  }, 25_000);
  heartbeat.unref?.();
}

function stopHeartbeat(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

export function subscriberCount(): number {
  return subscribers.size;
}

export function closeAll(): void {
  for (const sub of subscribers.values()) {
    try {
      sub.res.end();
    } catch {
      // la conexion ya estaba cerrada
    }
  }
  subscribers.clear();
  stopHeartbeat();
}
