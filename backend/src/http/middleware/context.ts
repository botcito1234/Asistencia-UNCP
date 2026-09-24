/**
 * Contexto de peticion: identificador de traza, IP real y agente.
 * Todo lo que se audita o se registra toma estos datos de un unico lugar.
 */
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import type { UserRole } from '@prisma/client';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        userId: string;
        role: UserRole;
        sessionId: string;
        dni: string;
        deviceFingerprint?: string | undefined;
        internId?: string | null;
      };
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

export interface RequestAuditContext {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
  actorUserId?: string | null;
  actorRole?: UserRole | null;
}

/** Datos de contexto listos para pasar a `recordAudit`. */
export function auditContextOf(req: Request): RequestAuditContext {
  return {
    ipAddress: clientIp(req),
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId,
    actorUserId: req.auth?.userId ?? null,
    actorRole: req.auth?.role ?? null,
  };
}

export function clientIp(req: Request): string | null {
  // Express ya resuelve x-forwarded-for cuando trust proxy esta activo.
  const ip = req.ip ?? req.socket.remoteAddress ?? null;
  if (!ip) return null;
  return ip.replace(/^::ffff:/, '').slice(0, 64);
}

/** Huella del dispositivo enviada por la aplicacion movil. */
export function deviceFingerprintOf(req: Request): string | undefined {
  const value = req.header('x-device-id');
  return value ? value.trim() : undefined;
}

export function deviceInfoOf(req: Request) {
  const fingerprint = deviceFingerprintOf(req);
  if (!fingerprint) return null;
  return {
    fingerprint,
    platform: (req.header('x-device-platform') ?? 'android').slice(0, 20),
    model: req.header('x-device-model')?.slice(0, 120) ?? null,
    osVersion: req.header('x-device-os')?.slice(0, 60) ?? null,
    appVersion: req.header('x-app-version')?.slice(0, 40) ?? null,
  };
}
