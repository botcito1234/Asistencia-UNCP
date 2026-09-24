/**
 * Primitivas criptograficas.
 *
 * Decision: scrypt de node:crypto para hashear contrasenas.
 *  - Es memory-hard (resiste GPU/ASIC), a diferencia de PBKDF2.
 *  - Viene en el runtime: cero dependencias nativas que compilar en Windows,
 *    Linux o en la imagen de Docker.
 *  - Parametros N=32768, r=8, p=1 -> ~32 MB por verificacion, coste adecuado
 *    para un login interactivo.
 * El formato almacenado incluye los parametros, de modo que subirlos en el
 * futuro no invalida los hashes existentes.
 */
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
  createHmac,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 } as const;
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plain.normalize('NFKC'), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAXMEM,
  });
  const parts = ['scrypt', String(PARAMS.N), String(PARAMS.r), String(PARAMS.p), salt.toString('base64'), derived.toString('base64')];
  return parts.join('$');
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4] as string, 'base64');
    const expected = Buffer.from(parts[5] as string, 'base64');
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    const derived = await scrypt(plain.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: MAXMEM });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Token opaco de alta entropia para refresh tokens y enlaces firmados. */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash determinista para guardar refresh tokens sin almacenarlos en claro. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sha256Hex(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export const newId = (): string => randomUUID();

/** Contrasena temporal legible generada por el administrador (sin caracteres ambiguos). */
export function generateTemporaryPassword(length = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet.charAt((bytes[i] as number) % alphabet.length);
  }
  return out;
}
