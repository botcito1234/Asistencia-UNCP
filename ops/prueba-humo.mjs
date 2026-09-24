// =============================================================================
// Prueba de humo de extremo a extremo.
//
// Recorre el flujo real contra un servidor EN EJECUCION: administrador -> sede
// -> practicante -> aplicacion -> marcaciones validas y rechazadas -> panel ->
// reportes -> tiempo real -> cierre de sesion. Sirve como evidencia de que un
// despliegue funciona.
//
//   API_URL=http://127.0.0.1:4000/api/v1 ADMIN_DNI=... ADMIN_PASSWORD=... node ops/prueba-humo.mjs
//
// Crea una sede HUMO-xxxxxx y un practicante de prueba. Ejecutela en un entorno
// de pruebas, o desactive despues esos registros desde el panel.
// =============================================================================
const BASE = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const ORIGEN = BASE.replace(/\/api\/v1\/?$/, '');
const SUFIJO = String(Date.now()).slice(-6);
const DEV_A = 'humo-dispositivo-aaaa-000000000001';
const DEV_B = 'humo-dispositivo-bbbb-000000000002';
let ok = 0, fallos = 0;

function paso(nombre, cond, detalle = '') {
  if (cond) { ok++; console.log('  OK    ' + nombre + (detalle ? '  (' + detalle + ')' : '')); }
  else { fallos++; console.log('  FALLO ' + nombre + (detalle ? '  -> ' + detalle : '')); }
}

async function req(metodo, ruta, { token, cuerpo, device, form } = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (device) Object.assign(headers, { 'x-device-id': device, 'x-device-platform': 'android', 'x-device-model': 'Pixel Humo', 'x-app-version': '1.0.0' });
  let body;
  if (form) body = form;
  else if (cuerpo !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(cuerpo); }
  const res = await fetch(BASE + ruta, { method: metodo, headers, body });
  const tipo = res.headers.get('content-type') ?? '';
  const datos = tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, datos, headers: res.headers };
}

function jpeg(w = 640, h = 480) {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(17, 2); sof.writeUInt8(8, 4);
  sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7); sof.writeUInt8(3, 9);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0]), sof,
    Buffer.from([0xff,0xda,0,8,1,1,0,0,0x3f,0]), Buffer.alloc(3000, 0x5a), Buffer.from([0xff, 0xd9])]);
}

function minutosLimaAhora(offset) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const m = Number(p.find(x => x.type === 'hour').value) * 60 + Number(p.find(x => x.type === 'minute').value) + offset;
  const c = Math.max(0, Math.min(1439, m));
  return String(Math.floor(c / 60)).padStart(2, '0') + ':' + String(c % 60).padStart(2, '0');
}

function marcar(tipo, token, lat, lng, extra = {}) {
  const fd = new FormData();
  fd.set('latitude', String(lat)); fd.set('longitude', String(lng));
  fd.set('accuracyMeters', String(extra.accuracy ?? 7));
  fd.set('mockLocationReported', extra.mock ? 'true' : 'false');
  fd.set('locationAgeMs', '1200');
  if (extra.key) fd.set('idempotencyKey', extra.key);
  fd.set('foto', new Blob([jpeg()], { type: 'image/jpeg' }), 'evidencia.jpg');
  return req('POST', '/asistencia/' + tipo, { token, device: extra.device ?? DEV_A, form: fd });
}

console.log('\n== 1. Administrador ==');
const admin = await req('POST', '/auth/login', { cuerpo: { dni: process.env.ADMIN_DNI, password: process.env.ADMIN_PASSWORD } });
paso('login del administrador', admin.status === 200, 'rol ' + admin.datos.user?.role);
const tA = admin.datos.tokens.accessToken;

const tab0 = await req('GET', '/asistencia/tablero?date=2026-09-18', { token: tA });
paso('tablero global', tab0.status === 200, tab0.datos.sites?.length + ' sedes del seed');

console.log('\n== 2. Sede y practicante ==');
const sede = await req('POST', '/sedes', { token: tA, cuerpo: { code: 'HUMO-' + SUFIJO, name: 'Sede Humo', address: 'Jr. Prueba 123', latitude: -12.05, longitude: -77.04, radiusMeters: 50 } });
paso('crear sede', sede.status === 201, 'radio ' + sede.datos.radiusMeters + ' m');

const hoyLima = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
const inicio = minutosLimaAhora(-10);
const alta = await req('POST', '/practicantes', { token: tA, cuerpo: {
  dni: '7' + SUFIJO + '1', firstNames: 'Prueba', lastNames: 'De Humo', siteId: sede.datos.id, areaGroup: 'Aula Humo',
  schedule: [1,2,3,4,5,6,7].map(d => ({ weekday: d, startTime: inicio, endTime: null })),
} });
paso('crear practicante con horario', alta.status === 201, 'contrasena temporal de ' + (alta.datos.temporaryPassword?.length ?? 0) + ' caracteres');
const internId = alta.datos.intern?.id;

console.log('\n== 3. Aplicacion del practicante ==');
let li = await req('POST', '/auth/login', { cuerpo: { dni: '7' + SUFIJO + '1', password: alta.datos.temporaryPassword }, device: DEV_A });
paso('primer login vincula el telefono', li.status === 200 && li.datos.device?.firstBinding === true);
paso('exige cambiar la contrasena', li.datos.user?.mustChangePassword === true);

const bloqueado = await req('GET', '/asistencia/hoy', { token: li.datos.tokens.accessToken, device: DEV_A });
paso('bloquea marcar sin cambiar contrasena', bloqueado.datos.error?.code === 'CAMBIO_PASSWORD_REQUERIDO');

const cp = await req('POST', '/auth/cambiar-password', { token: li.datos.tokens.accessToken, device: DEV_A, cuerpo: { currentPassword: alta.datos.temporaryPassword, newPassword: 'HumoNueva2026' } });
paso('cambio de contrasena', cp.status === 200);

li = await req('POST', '/auth/login', { cuerpo: { dni: '7' + SUFIJO + '1', password: 'HumoNueva2026' }, device: DEV_A });
const tP = li.datos.tokens.accessToken;
paso('login con la nueva contrasena', li.status === 200);

const pol = await req('GET', '/privacidad');
const cons = await req('POST', '/auth/consentimiento', { token: tP, device: DEV_A, cuerpo: { policyVersion: pol.datos.version, accepted: true } });
paso('politica publica y consentimiento registrado', pol.status === 200 && cons.status === 200, 'version ' + pol.datos.version);

const hoy = await req('GET', '/asistencia/hoy', { token: tP, device: DEV_A });
paso('estado del dia habilita la entrada', hoy.datos.actions?.canCheckIn === true, 'programada ' + hoy.datos.schedule?.startTime + ', motivo: ' + hoy.datos.actions?.reason);

console.log('\n== 4. Marcaciones ==');
const lejos = await marcar('entrada', tP, -12.05 + 0.002, -77.04);
paso('rechaza fuera de geocerca', lejos.datos.error?.code === 'FUERA_DE_GEOCERCA', lejos.datos.error?.message);

const falso = await marcar('entrada', tP, -12.05, -77.04, { mock: true });
paso('rechaza ubicacion simulada', falso.datos.error?.code === 'UBICACION_SIMULADA');

const impreciso = await marcar('entrada', tP, -12.05, -77.04, { accuracy: 90 });
paso('rechaza GPS impreciso', impreciso.datos.error?.code === 'GPS_IMPRECISO');

const otroTel = await marcar('entrada', tP, -12.05, -77.04, { device: DEV_B });
paso('rechaza otro telefono', otroTel.datos.error?.code === 'DISPOSITIVO_NO_AUTORIZADO');

const entrada = await marcar('entrada', tP, -12.05, -77.04, { key: 'humo-entrada-' + SUFIJO });
paso('entrada valida registrada', entrada.status === 201, entrada.datos.punctuality + ', ' + entrada.datos.lateMinutes + ' min, ' + entrada.datos.distanceMeters + ' m, hora servidor ' + entrada.datos.localTime);

const reintento = await marcar('entrada', tP, -12.05, -77.04, { key: 'humo-entrada-' + SUFIJO });
paso('reintento idempotente no duplica', reintento.status === 201 && reintento.datos.deduplicated === true);

const doble = await marcar('entrada', tP, -12.05, -77.04);
paso('segunda entrada rechazada', doble.datos.error?.code === 'ENTRADA_DUPLICADA');

const salida = await marcar('salida', tP, -12.05, -77.04);
paso('salida registrada', salida.status === 201);

console.log('\n== 5. Panel del administrador ==');
const tab = await req('GET', '/asistencia/tablero?date=' + hoyLima + '&siteId=' + sede.datos.id, { token: tA });
paso('tablero refleja la jornada', tab.datos.totals?.presentes === 1 && tab.datos.totals?.salidas === 1, 'presentes ' + tab.datos.totals?.presentes + ', alertas ' + tab.datos.totals?.alertas);

const ev = await req('GET', '/seguridad/eventos?from=' + hoyLima + '&to=' + hoyLima + '&siteId=' + sede.datos.id, { token: tA });
paso('intentos rechazados como eventos de seguridad', ev.datos.total >= 4, ev.datos.total + ' eventos');

const det = await req('GET', '/asistencia/' + entrada.datos.attendanceDayId, { token: tA });
paso('detalle con mapa y foto firmada', det.status === 200 && !!det.datos.checkIn?.photoUrl && det.datos.siteGeo?.radiusMeters === 50);

const foto = await fetch(ORIGEN + det.datos.checkIn.photoUrl);
paso('la foto se sirve integra por enlace firmado', foto.status === 200 && foto.headers.get('x-evidence-integrity') === 'ok', foto.headers.get('content-type'));

const reg = await req('POST', '/asistencia/' + entrada.datos.attendanceDayId + '/regularizar', { token: tA, cuerpo: { field: 'JUSTIFICACION', newValue: 'Memo 045-2026', reason: 'Prueba de humo: justificacion documental adjunta.' } });
paso('regularizacion con motivo', reg.status === 201);

const xls = await req('GET', '/reportes/generar?tipo=consolidado&formato=excel&from=' + hoyLima + '&to=' + hoyLima, { token: tA });
paso('reporte Excel', xls.status === 200 && xls.datos.subarray(0, 2).toString() === 'PK', xls.datos.length + ' bytes');

const pdf = await req('GET', '/reportes/generar?tipo=incidencias&formato=pdf&from=' + hoyLima + '&to=' + hoyLima, { token: tA });
paso('reporte PDF', pdf.status === 200 && pdf.datos.subarray(0, 5).toString() === '%PDF-', pdf.datos.length + ' bytes');

const aud = await req('GET', '/seguridad/auditoria?from=' + hoyLima + '&to=' + hoyLima, { token: tA });
paso('auditoria registra la actividad', aud.datos.total > 10, aud.datos.total + ' entradas');

console.log('\n== 6. Tiempo real (SSE) ==');
const ctrl = new AbortController();
const sse = await fetch(BASE + '/notificaciones/stream?token=' + tA, { signal: ctrl.signal });
const lector = sse.body.getReader();
let recibido = '';
const leer = (async () => { while (true) { const { value, done } = await lector.read(); if (done) break; recibido += Buffer.from(value).toString(); if (recibido.includes('event: evento-seguridad')) break; } })();
await new Promise(r => setTimeout(r, 300));
await marcar('salida', tP, -12.05, -77.04); // provoca SALIDA_DUPLICADA -> evento
await Promise.race([leer, new Promise(r => setTimeout(r, 4000))]);
ctrl.abort();
paso('el panel recibe el evento en vivo', recibido.includes('event: evento-seguridad'));

console.log('\n== 7. Sesion ==');
const out = await req('POST', '/auth/logout', { token: tP, device: DEV_A });
const tras = await req('GET', '/asistencia/hoy', { token: tP, device: DEV_A });
paso('logout invalida el token al instante', out.status === 200 && tras.status === 401);

console.log('\nRESULTADO: ' + ok + ' correctos, ' + fallos + ' fallidos');
process.exit(fallos === 0 ? 0 : 1);
