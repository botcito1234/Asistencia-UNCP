/**
 * Canal de correo. Opcional: sin SMTP configurado queda desactivado y las
 * notificaciones siguen llegando por los canales internos. La ausencia de
 * credenciales no debe romper ninguna operacion de negocio.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config/env.js';
import { logger } from '../../core/logger.js';

let transporter: Transporter | null = null;
let initialized = false;

function getTransporter(): Transporter | null {
  if (initialized) return transporter;
  initialized = true;

  if (!config.SMTP_ENABLED || !config.SMTP_HOST) {
    logger.info('Canal de correo desactivado (SMTP_ENABLED=false o SMTP_HOST vacio).');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
  });
  logger.info({ host: config.SMTP_HOST, port: config.SMTP_PORT }, 'Canal de correo habilitado.');
  return transporter;
}

export function isMailEnabled(): boolean {
  return getTransporter() !== null;
}

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(message: MailMessage): Promise<{ sent: boolean; error?: string }> {
  const t = getTransporter();
  if (!t) return { sent: false, error: 'Canal de correo no configurado.' };
  if (message.to.length === 0) return { sent: false, error: 'Sin destinatarios.' };

  try {
    await t.sendMail({
      from: config.SMTP_FROM,
      to: message.to.join(','),
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { sent: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e, subject: message.subject }, 'Fallo el envio de correo.');
    return { sent: false, error };
  }
}
