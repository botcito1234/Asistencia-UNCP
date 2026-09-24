/**
 * Cliente de Google Drive para el archivado historico.
 *
 * Autenticacion por cuenta de servicio (JWT), no por OAuth de usuario: el
 * proceso es desatendido y no debe depender de que alguien mantenga una sesion
 * abierta. La clave privada llega por variable de entorno y NUNCA se incluye
 * en el APK ni en el repositorio.
 *
 * Si no hay credenciales configuradas, el cliente informa que esta deshabilitado
 * y el archivado se conserva verificado en disco local, marcado como pendiente
 * de subida. Nunca se libera nada que no se haya subido y verificado.
 */
import { google, type drive_v3 } from 'googleapis';
import { Readable } from 'node:stream';
import { config, normalizePrivateKey } from '../../config/env.js';
import { logger } from '../../core/logger.js';

/**
 * Permiso completo de Drive, a proposito.
 *
 * `drive.file` parece mas prudente, pero solo alcanza a los archivos que crea
 * la propia aplicacion: la carpeta de destino la crea el administrador y se
 * comparte con la cuenta de servicio, asi que con ese permiso Drive responde
 * "File not found" aunque los permisos de la carpeta esten bien.
 *
 * No es un exceso de privilegio: una cuenta de servicio dedicada solo ve lo que
 * se le comparte, y a esta se le comparte una sola carpeta. Su propio Drive
 * esta vacio y sin cuota.
 */
const SCOPES = ['https://www.googleapis.com/auth/drive'];

let client: drive_v3.Drive | null = null;
let initialized = false;

/** Credenciales de un usuario real que autorizo la aplicacion una sola vez. */
function hayCredencialesDeUsuario(): boolean {
  return Boolean(
    config.GOOGLE_OAUTH_CLIENT_ID && config.GOOGLE_OAUTH_CLIENT_SECRET && config.GOOGLE_OAUTH_REFRESH_TOKEN,
  );
}

/** Credenciales de cuenta de servicio (robot). */
function hayCuentaDeServicio(): boolean {
  return Boolean(config.GOOGLE_SERVICE_ACCOUNT_EMAIL && config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

export function isDriveEnabled(): boolean {
  return Boolean(
    config.GOOGLE_DRIVE_ENABLED &&
      config.GOOGLE_DRIVE_ROOT_FOLDER_ID &&
      (hayCuentaDeServicio() || hayCredencialesDeUsuario()),
  );
}

/** Con quien actua el archivado, para los mensajes de diagnostico. */
export function driveIdentity(): string {
  if (hayCredencialesDeUsuario()) return 'la cuenta de Google que autorizó la aplicación';
  return config.GOOGLE_SERVICE_ACCOUNT_EMAIL;
}

function getClient(): drive_v3.Drive | null {
  if (initialized) return client;
  initialized = true;

  if (!isDriveEnabled()) {
    logger.info('Google Drive deshabilitado: el archivado quedará verificado en disco local.');
    return null;
  }

  // Se prefiere la autorizacion de usuario cuando existe: los archivos quedan a
  // nombre de esa persona y consumen el espacio de la organizacion. Una cuenta
  // de servicio, en cambio, tiene cuota cero y solo puede escribir en unidades
  // compartidas.
  if (hayCredencialesDeUsuario()) {
    const oauth = new google.auth.OAuth2(config.GOOGLE_OAUTH_CLIENT_ID, config.GOOGLE_OAUTH_CLIENT_SECRET);
    oauth.setCredentials({ refresh_token: config.GOOGLE_OAUTH_REFRESH_TOKEN });
    client = google.drive({ version: 'v3', auth: oauth });
    logger.info('Google Drive habilitado con la autorización de un usuario.');
    return client;
  }

  const auth = new google.auth.JWT({
    email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: normalizePrivateKey(config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    scopes: SCOPES,
  });

  client = google.drive({ version: 'v3', auth });
  logger.info('Google Drive habilitado con una cuenta de servicio.');
  return client;
}

const sharedDriveParams = () =>
  config.GOOGLE_DRIVE_SHARED_DRIVE_ID
    ? { supportsAllDrives: true, includeItemsFromAllDrives: true, driveId: config.GOOGLE_DRIVE_SHARED_DRIVE_ID, corpora: 'drive' as const }
    : { supportsAllDrives: true, includeItemsFromAllDrives: true };

/**
 * Devuelve el id de una carpeta, creandola si no existe.
 * Idempotente: dos ejecuciones concurrentes no duplican la jerarquia porque se
 * busca antes de crear y, si aparece un duplicado, se toma el primero.
 */
export async function ensureFolder(name: string, parentId: string): Promise<string> {
  const drive = getClient();
  if (!drive) throw new Error('Google Drive no está configurado.');

  const safeName = name.replace(/'/g, "\\'");
  const query = [
    "mimeType = 'application/vnd.google-apps.folder'",
    "name = '" + safeName + "'",
    "'" + parentId + "' in parents",
    'trashed = false',
  ].join(' and ');

  const existing = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    pageSize: 1,
    ...sharedDriveParams(),
  });

  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  });

  if (!created.data.id) throw new Error('Drive no devolvio el id de la carpeta creada: ' + name);
  return created.data.id;
}

/** Crea la jerarquia Asistencias/<Sede>/<Anio>/<Mes> y devuelve el id final. */
export async function ensureArchivePath(siteName: string, year: number, month: number): Promise<string> {
  const root = config.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const asistencias = await ensureFolder('Asistencias', root);
  const sede = await ensureFolder(siteName, asistencias);
  const anio = await ensureFolder(String(year), sede);
  return ensureFolder(String(month).padStart(2, '0'), anio);
}

export interface UploadResult {
  fileId: string;
  name: string;
  size: number;
  /** MD5 que reporta Drive; se compara con el local para verificar la subida. */
  md5Checksum: string | null;
  webViewLink: string | null;
}

export async function uploadFile(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  parentFolderId: string;
}): Promise<UploadResult> {
  const drive = getClient();
  if (!drive) throw new Error('Google Drive no está configurado.');

  const response = await drive.files.create({
    requestBody: { name: params.filename, parents: [params.parentFolderId] },
    media: { mimeType: params.mimeType, body: Readable.from(params.buffer) },
    fields: 'id, name, size, md5Checksum, webViewLink',
    supportsAllDrives: true,
  });

  const file = response.data;
  if (!file.id) throw new Error('Drive no devolvio el id del archivo subido.');

  return {
    fileId: file.id,
    name: file.name ?? params.filename,
    size: Number(file.size ?? params.buffer.length),
    md5Checksum: file.md5Checksum ?? null,
    webViewLink: file.webViewLink ?? null,
  };
}

/** Relee los metadatos del archivo subido para confirmar que existe e integro. */
export async function verifyUpload(fileId: string): Promise<{ exists: boolean; size: number; md5Checksum: string | null }> {
  const drive = getClient();
  if (!drive) throw new Error('Google Drive no está configurado.');

  try {
    const res = await drive.files.get({
      fileId,
      fields: 'id, size, md5Checksum, trashed',
      supportsAllDrives: true,
    });
    if (res.data.trashed) return { exists: false, size: 0, md5Checksum: null };
    return {
      exists: true,
      size: Number(res.data.size ?? 0),
      md5Checksum: res.data.md5Checksum ?? null,
    };
  } catch (e) {
    logger.warn({ err: e, fileId }, 'No se pudo verificar el archivo en Drive.');
    return { exists: false, size: 0, md5Checksum: null };
  }
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = getClient();
  if (!drive) throw new Error('Google Drive no está configurado.');

  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** Comprobacion de conectividad y permisos, para el diagnostico del panel. */
export async function checkDriveAccess(): Promise<{ ok: boolean; message: string; rootFolderName?: string }> {
  if (!isDriveEnabled()) {
    return {
      ok: false,
      message:
        'Google Drive no está configurado. En el archivo .env del servidor complete ' +
        'GOOGLE_DRIVE_ENABLED, GOOGLE_DRIVE_ROOT_FOLDER_ID y una de las dos formas de acceso: ' +
        'la cuenta de servicio (GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) ' +
        'o la autorización de un usuario (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET ' +
        'y GOOGLE_OAUTH_REFRESH_TOKEN).',
    };
  }

  const drive = getClient();
  if (!drive) return { ok: false, message: 'No se pudo inicializar el cliente de Drive.' };

  try {
    const res = await drive.files.get({
      fileId: config.GOOGLE_DRIVE_ROOT_FOLDER_ID,
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });
    return {
      ok: true,
      message: 'Conexión correcta con Google Drive.',
      rootFolderName: res.data.name ?? undefined,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message:
        'No se pudo acceder a la carpeta raiz. Verifique que la carpeta sea visible para ' +
        driveIdentity() +
        ' con permiso de edición. Detalle: ' +
        message,
    };
  }
}
