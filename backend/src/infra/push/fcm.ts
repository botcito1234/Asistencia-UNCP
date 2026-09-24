/**
 * Notificaciones push mediante Firebase Cloud Messaging (HTTP v1).
 *
 * Decision: se habla directamente con la API REST de FCM firmando un JWT de
 * cuenta de servicio, en lugar de arrastrar firebase-admin. El SDK completo
 * pesa decenas de megabytes y aqui solo se necesita un endpoint.
 *
 * Es opcional: sin credenciales el canal queda desactivado y las alertas siguen
 * disponibles en la aplicacion y en el panel por el canal interno.
 */
import { SignJWT, importPKCS8 } from 'jose';
import { config, normalizePrivateKey } from '../../config/env.js';
import { logger } from '../../core/logger.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let cachedToken: { value: string; expiresAt: number } | null = null;

export function isPushEnabled(): boolean {
  return Boolean(config.PUSH_ENABLED && config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL && config.FCM_PRIVATE_KEY);
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const key = await importPKCS8(normalizePrivateKey(config.FCM_PRIVATE_KEY), 'RS256');
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(config.FCM_CLIENT_EMAIL)
    .setSubject(config.FCM_CLIENT_EMAIL)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error('FCM: no se pudo obtener token de acceso (' + res.status + ').');
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Las alertas de seguridad usan alta prioridad para llegar de inmediato. */
  highPriority?: boolean;
}

export interface PushResult {
  sent: boolean;
  error?: string;
  /** Indica que el token del dispositivo ya no es valido y debe revocarse. */
  invalidToken?: boolean;
}

export async function sendPush(message: PushMessage): Promise<PushResult> {
  if (!isPushEnabled()) return { sent: false, error: 'Canal push no configurado.' };

  try {
    const accessToken = await getAccessToken();
    const url = 'https://fcm.googleapis.com/v1/projects/' + config.FCM_PROJECT_ID + '/messages:send';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + accessToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: message.token,
          notification: { title: message.title, body: message.body },
          data: message.data ?? {},
          android: {
            priority: message.highPriority ? 'HIGH' : 'NORMAL',
            notification: {
              channel_id: message.highPriority ? 'alertas_criticas' : 'asistencia',
              default_sound: true,
            },
          },
        },
      }),
    });

    if (res.ok) return { sent: true };

    const text = await res.text();
    // 404 UNREGISTERED / 400 INVALID_ARGUMENT sobre el token: hay que purgarlo.
    const invalidToken = res.status === 404 || text.includes('UNREGISTERED') || text.includes('INVALID_ARGUMENT');
    logger.warn({ status: res.status, body: text.slice(0, 300) }, 'Fallo el envio push.');
    return { sent: false, error: 'FCM ' + res.status, invalidToken };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, 'Error inesperado enviando push.');
    return { sent: false, error };
  }
}
