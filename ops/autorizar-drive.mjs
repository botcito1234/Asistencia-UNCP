// =============================================================================
// Autorizacion de Google Drive con una cuenta de usuario.
//
// Se usa cuando la organizacion no puede crear unidades compartidas. Una cuenta
// de servicio no tiene espacio propio en Drive (cuota cero), asi que al subir a
// una carpeta normal Google responde "Service Accounts do not have storage
// quota". Autorizando con un usuario real, los archivos quedan a su nombre y
// consumen el espacio de la organizacion.
//
// Se ejecuta UNA sola vez, a mano, en la computadora de quien autoriza:
//
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
//     node ops/autorizar-drive.mjs
//
// Abre el navegador, la persona aprueba, y el programa imprime el token de
// refresco para pegar en el .env del servidor. Ese token no caduca por tiempo:
// deja de servir si se revoca el acceso o se cambia la contrasena.
// =============================================================================
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.argv[2];
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.argv[3];
const PUERTO = Number(process.env.PUERTO_AUTORIZACION ?? 53682);
const REDIRECT = 'http://localhost:' + PUERTO + '/callback';
const SCOPE = 'https://www.googleapis.com/auth/drive';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Faltan las credenciales del cliente OAuth.');
  console.error('Uso: node ops/autorizar-drive.mjs <ID_DE_CLIENTE> <SECRETO>');
  process.exit(1);
}

// El "state" evita que un tercero complete la vuelta con un codigo ajeno.
const estado = randomBytes(16).toString('hex');

const urlConsentimiento =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    // offline + consent fuerza que Google entregue token de refresco, incluso
    // si esta cuenta ya habia autorizado antes.
    access_type: 'offline',
    prompt: 'consent',
    state: estado,
  }).toString();

function paginaHtml(titulo, detalle) {
  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<title>' + titulo + '</title>' +
    '<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0b1f3a;' +
    'display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}' +
    'div{max-width:32rem;padding:2rem;background:#fff;border:1px solid #e5e7eb;border-radius:12px}' +
    'h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#475569;line-height:1.5;margin:0}</style>' +
    '</head><body><div><h1>' + titulo + '</h1><p>' + detalle + '</p></div></body></html>'
  );
}

async function canjearCodigo(codigo) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: codigo,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const datos = await res.json();
  if (!res.ok) throw new Error(datos.error_description ?? datos.error ?? JSON.stringify(datos));
  return datos;
}

async function correoDelUsuario(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { authorization: 'Bearer ' + accessToken },
    });
    const datos = await res.json();
    return datos.user?.emailAddress ?? null;
  } catch {
    return null;
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PUERTO);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }

  const error = url.searchParams.get('error');
  if (error) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(paginaHtml('Autorización cancelada', 'Google devolvió: ' + error));
    console.error('\nLa autorización fue rechazada:', error);
    servidor.close();
    process.exit(1);
  }

  if (url.searchParams.get('state') !== estado) {
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(paginaHtml('Respuesta inesperada', 'El identificador de la solicitud no coincide.'));
    servidor.close();
    process.exit(1);
  }

  try {
    const tokens = await canjearCodigo(url.searchParams.get('code'));
    const correo = await correoDelUsuario(tokens.access_token);

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      paginaHtml(
        'Listo',
        'Ya podés cerrar esta pestaña y volver a la terminal' +
          (correo ? ', donde está el token de ' + correo : '') +
          '.',
      ),
    );

    console.log('\n============================================================');
    if (correo) console.log(' Autorizado por: ' + correo);
    console.log(' Pegue estas líneas en el archivo .env del servidor:\n');
    console.log(' GOOGLE_DRIVE_ENABLED=true');
    console.log(' GOOGLE_OAUTH_CLIENT_ID=' + CLIENT_ID);
    console.log(' GOOGLE_OAUTH_CLIENT_SECRET=' + CLIENT_SECRET);
    console.log(' GOOGLE_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log(' GOOGLE_DRIVE_ROOT_FOLDER_ID=<id de la carpeta de destino>');
    console.log('\n Trate el token de refresco como una contraseña.');
    console.log('============================================================\n');

    if (!tokens.refresh_token) {
      console.error('ATENCION: Google no devolvió token de refresco. Revoque el acceso de esta');
      console.error('aplicación en https://myaccount.google.com/permissions y repita el proceso.');
    }
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(paginaHtml('No se pudo completar', String(e.message ?? e)));
    console.error('\nFallo el canje del código:', e.message ?? e);
    servidor.close();
    process.exit(1);
  }

  servidor.close();
  process.exit(0);
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log('Esperando la autorización en ' + REDIRECT);
  console.log('\nAbra esta dirección en el navegador (si no se abrió sola):\n');
  console.log(urlConsentimiento + '\n');
  // En Windows, `start` necesita un titulo vacio antes de la URL.
  const abrir =
    process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', urlConsentimiento], { detached: true, stdio: 'ignore' })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [urlConsentimiento], {
          detached: true,
          stdio: 'ignore',
        });
  abrir.unref();
});
