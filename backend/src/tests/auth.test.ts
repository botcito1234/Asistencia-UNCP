/**
 * Pruebas de autenticacion, dispositivo unico y ciclo de vida de la sesion.
 * Cubre los casos obligatorios 11, 12, 25 y 26.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { prisma } from '../infra/db/prisma.js';
import {
  resetDatabase,
  createSite,
  createIntern,
  createAdmin,
  loginAs,
  deviceHeaders,
  DEVICE_A,
  DEVICE_B,
} from './helpers.js';
import { revokeSession } from '../modules/auth/token.service.js';

let app: Express;

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('Inicio de sesión', () => {
  it('el practicante entra con DNI y contraseña y recibe su sede y horario', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(deviceHeaders(DEVICE_A))
      .send({ dni: intern.dni, password: intern.password });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('PRACTICANTE');
    expect(res.body.user.intern.site.id).toBe(site.id);
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).toBeTruthy();
    expect(res.body.device.firstBinding).toBe(true);
  });

  it('no revela si el DNI existe cuando la contraseña es incorrecta', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });

    const conDni = await request(app)
      .post('/api/v1/auth/login')
      .set(deviceHeaders(DEVICE_A))
      .send({ dni: intern.dni, password: 'IncorrectaXY1' });

    const sinDni = await request(app)
      .post('/api/v1/auth/login')
      .set(deviceHeaders(DEVICE_A))
      .send({ dni: '99999999', password: 'IncorrectaXY1' });

    expect(conDni.status).toBe(401);
    expect(sinDni.status).toBe(401);
    expect(conDni.body.error.code).toBe(sinDni.body.error.code);
    expect(conDni.body.error.message).toBe(sinDni.body.error.message);
  });

  it('bloquea la cuenta tras cinco intentos fallidos', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });

    for (let i = 0; i < 4; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .set(deviceHeaders(DEVICE_A))
        .send({ dni: intern.dni, password: 'MalaClave1' });
    }

    const quinto = await request(app)
      .post('/api/v1/auth/login')
      .set(deviceHeaders(DEVICE_A))
      .send({ dni: intern.dni, password: 'MalaClave1' });

    expect(quinto.body.error.code).toBe('CUENTA_BLOQUEADA');

    // Ni siquiera la contrasena correcta entra mientras dure el bloqueo.
    const conCorrecta = await request(app)
      .post('/api/v1/auth/login')
      .set(deviceHeaders(DEVICE_A))
      .send({ dni: intern.dni, password: intern.password });

    expect(conCorrecta.status).toBe(401);
    expect(conCorrecta.body.error.code).toBe('CUENTA_BLOQUEADA');

    const evento = await prisma.securityEvent.findFirst({ where: { type: 'CUENTA_BLOQUEADA' } });
    expect(evento).not.toBeNull();
  });

  it('nunca almacena la contraseña en texto plano', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });

    const user = await prisma.userAccount.findUnique({ where: { id: intern.userId } });
    expect(user?.passwordHash).not.toContain(intern.password);
    expect(user?.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('rechaza el acceso de un practicante inactivo', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480, active: false });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(deviceHeaders(DEVICE_A))
      .send({ dni: intern.dni, password: intern.password });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('CUENTA_INACTIVA');
  });
});

describe('Caso 11 - Un solo dispositivo', () => {
  it('vincula el teléfono en el primer inicio de sesión', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const binding = await prisma.deviceBinding.findFirst({ where: { userId: intern.userId } });
    expect(binding?.status).toBe('ACTIVO');
    expect(binding?.deviceFingerprint).toBe(DEVICE_A);
  });

  it('rechaza el inicio de sesión desde un segundo teléfono', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(deviceHeaders(DEVICE_B))
      .send({ dni: intern.dni, password: intern.password });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DISPOSITIVO_NO_AUTORIZADO');
    expect(res.body.error.message).toBe('Dispositivo no autorizado. Solicite autorización al administrador.');
  });

  it('registra el intento como evento de seguridad critico', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    await loginAs(app, intern.dni, intern.password, DEVICE_A);

    await request(app)
      .post('/api/v1/auth/login')
      .set(deviceHeaders(DEVICE_B))
      .send({ dni: intern.dni, password: intern.password });

    const evento = await prisma.securityEvent.findFirst({ where: { type: 'DISPOSITIVO_NO_AUTORIZADO' } });
    expect(evento?.severity).toBe('CRITICO');
    // La huella completa nunca se guarda en el evento.
    expect(evento?.details).toBeTruthy();
    const detalles = evento?.details as Record<string, unknown>;
    expect(String(detalles.huellaPresentada)).toContain('...');
  });

  it('el administrador puede autorizar el cambio y entonces el nuevo teléfono entra', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const admin = await createAdmin();
    await loginAs(app, intern.dni, intern.password, DEVICE_A);
    const adminSession = await loginAs(app, admin.dni, admin.password);

    const autorizacion = await request(app)
      .post('/api/v1/practicantes/' + intern.internId + '/dispositivos/autorizar-cambio')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({ reason: 'El practicante perdio su teléfono anterior.' });

    expect(autorizacion.status).toBe(201);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(deviceHeaders(DEVICE_B))
      .send({ dni: intern.dni, password: intern.password });

    expect(res.status).toBe(200);
    expect(res.body.device.rebound).toBe(true);

    // La vinculacion anterior queda revocada, no borrada: se preserva la historia.
    const bindings = await prisma.deviceBinding.findMany({ where: { userId: intern.userId } });
    expect(bindings).toHaveLength(2);
    expect(bindings.filter((b) => b.status === 'ACTIVO')).toHaveLength(1);
  });

  it('la autorización es de un solo uso', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const admin = await createAdmin();
    await loginAs(app, intern.dni, intern.password, DEVICE_A);
    const adminSession = await loginAs(app, admin.dni, admin.password);

    await request(app)
      .post('/api/v1/practicantes/' + intern.internId + '/dispositivos/autorizar-cambio')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({ reason: 'Cambio de equipo autorizado.' });

    await loginAs(app, intern.dni, intern.password, DEVICE_B);

    // Un tercer telefono ya no pasa: la autorizacion se consumio.
    const tercero = await request(app)
      .post('/api/v1/auth/login')
      .set(deviceHeaders('dispositivo-prueba-cccc-0000000000003'))
      .send({ dni: intern.dni, password: intern.password });

    expect(tercero.status).toBe(401);
    expect(tercero.body.error.code).toBe('DISPOSITIVO_NO_AUTORIZADO');
  });

  it('desvincular el dispositivo cierra las sesiones abiertas', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const admin = await createAdmin();
    const internSession = await loginAs(app, intern.dni, intern.password, DEVICE_A);
    const adminSession = await loginAs(app, admin.dni, admin.password);

    const binding = await prisma.deviceBinding.findFirst({ where: { userId: intern.userId } });

    await request(app)
      .delete('/api/v1/practicantes/' + intern.internId + '/dispositivos/' + binding!.id)
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({ reason: 'Equipo extraviado, se desvincula por seguridad.' });

    const res = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + internSession.accessToken)
      .set(deviceHeaders(DEVICE_A));

    expect(res.status).toBe(401);
  });
});

describe('Caso 12 - Sesión simultánea', () => {
  it('abrir una sesión nueva invalida la anterior del practicante', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });

    const primera = await loginAs(app, intern.dni, intern.password, DEVICE_A);
    const segunda = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const conAntigua = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + primera.accessToken)
      .set(deviceHeaders(DEVICE_A));

    const conNueva = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + segunda.accessToken)
      .set(deviceHeaders(DEVICE_A));

    expect(conAntigua.status).toBe(401);
    expect(conAntigua.body.error.code).toBe('SESION_REVOCADA');
    expect(conNueva.status).toBe(200);
  });

  it('deja constancia del cierre de la sesión previa', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });

    await loginAs(app, intern.dni, intern.password, DEVICE_A);
    await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const evento = await prisma.securityEvent.findFirst({ where: { type: 'SESION_SIMULTANEA' } });
    expect(evento).not.toBeNull();
  });

  it('el administrador si puede mantener varias sesiones (panel y móvil)', async () => {
    const admin = await createAdmin();

    const panel = await loginAs(app, admin.dni, admin.password);
    const movil = await loginAs(app, admin.dni, admin.password, DEVICE_A);

    const a = await request(app).get('/api/v1/auth/me').set('authorization', 'Bearer ' + panel.accessToken);
    const b = await request(app).get('/api/v1/auth/me').set('authorization', 'Bearer ' + movil.accessToken);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});

describe('Caso 25 - Reinicio de la aplicación', () => {
  it('el refresh token permite recuperar la sesión sin volver a escribir la contraseña', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    // La aplicacion se reinicia y solo conserva el refresh token guardado.
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set(deviceHeaders(DEVICE_A))
      .send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).not.toBe(session.refreshToken);

    const conNuevo = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + res.body.tokens.accessToken)
      .set(deviceHeaders(DEVICE_A));

    expect(conNuevo.status).toBe(200);
  });

  it('reutilizar un refresh token ya usado revoca todas las sesiones', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const primera = await request(app)
      .post('/api/v1/auth/refresh')
      .set(deviceHeaders(DEVICE_A))
      .send({ refreshToken: session.refreshToken });
    expect(primera.status).toBe(200);

    // Un atacante intenta usar el token viejo.
    const reuso = await request(app)
      .post('/api/v1/auth/refresh')
      .set(deviceHeaders(DEVICE_A))
      .send({ refreshToken: session.refreshToken });

    expect(reuso.status).toBe(401);
    expect(reuso.body.error.code).toBe('SESION_REVOCADA');

    // Y la sesion legitima tambien queda cortada, como contramedida.
    const despues = await request(app)
      .post('/api/v1/auth/refresh')
      .set(deviceHeaders(DEVICE_A))
      .send({ refreshToken: primera.body.tokens.refreshToken });

    expect(despues.status).toBe(401);
  });

  it('el refresh desde otro dispositivo se rechaza', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set(deviceHeaders(DEVICE_B))
      .send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DISPOSITIVO_NO_AUTORIZADO');
  });
});

describe('Caso 26 - Expiracion y cierre de sesión', () => {
  it('cerrar sesión invalida el token de inmediato', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('authorization', 'Bearer ' + session.accessToken)
      .set(deviceHeaders(DEVICE_A));
    expect(logout.status).toBe(200);

    const despues = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + session.accessToken)
      .set(deviceHeaders(DEVICE_A));

    expect(despues.status).toBe(401);
    expect(despues.body.error.code).toBe('SESION_REVOCADA');
  });

  it('una sesión revocada en el servidor corta el acceso aunque el JWT siga vigente', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const sesion = await prisma.session.findFirst({ where: { userId: intern.userId, revokedAt: null } });
    await revokeSession(sesion!.id, 'PRUEBA');

    const res = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + session.accessToken)
      .set(deviceHeaders(DEVICE_A));

    expect(res.status).toBe(401);
  });

  it('un refresh token caducado no renueva', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    await prisma.session.updateMany({
      where: { userId: intern.userId, revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set(deviceHeaders(DEVICE_A))
      .send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRADO');
  });

  it('rechaza un token manipulado', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const manipulado = session.accessToken.slice(0, -4) + 'AAAA';
    const res = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + manipulado)
      .set(deviceHeaders(DEVICE_A));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALIDO');
  });
});

describe('Cambio y restablecimiento de contraseña', () => {
  it('obliga a cambiar la contraseña inicial antes de marcar', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480, mustChangePassword: true });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const res = await request(app)
      .get('/api/v1/asistencia/hoy')
      .set('authorization', 'Bearer ' + session.accessToken)
      .set(deviceHeaders(DEVICE_A));

    // 403 y no 401: la sesion es valida, falta un paso. Un 401 haria que el
    // cliente intentara renovar el token o cerrara la sesion.
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CAMBIO_PASSWORD_REQUERIDO');
  });

  it('el administrador con contraseña temporal tampoco puede usar el panel', async () => {
    const user = await createAdmin();
    await prisma.userAccount.update({ where: { id: user.userId }, data: { mustChangePassword: true } });
    const session = await loginAs(app, user.dni, user.password);

    const rutas = ['/api/v1/practicantes', '/api/v1/sedes', '/api/v1/asistencia/tablero?date=2026-01-01', '/api/v1/parametros'];
    for (const ruta of rutas) {
      const res = await request(app).get(ruta).set('authorization', 'Bearer ' + session.accessToken);
      expect(res.status, ruta).toBe(403);
      expect(res.body.error.code, ruta).toBe('CAMBIO_PASSWORD_REQUERIDO');
    }

    const sse = await request(app).get('/api/v1/notificaciones/stream?token=' + session.accessToken);
    expect(sse.status).toBe(403);
  });

  it('con el cambio pendiente si puede ver su perfil, cambiarla y cerrar sesión', async () => {
    const user = await createAdmin();
    await prisma.userAccount.update({ where: { id: user.userId }, data: { mustChangePassword: true } });
    const session = await loginAs(app, user.dni, user.password);

    const me = await request(app).get('/api/v1/auth/me').set('authorization', 'Bearer ' + session.accessToken);
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(true);

    const cambio = await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set('authorization', 'Bearer ' + session.accessToken)
      .send({ currentPassword: user.password, newPassword: 'PanelNuevo2026' });
    expect(cambio.status).toBe(200);

    const nueva = await loginAs(app, user.dni, 'PanelNuevo2026');
    const panel = await request(app).get('/api/v1/practicantes').set('authorization', 'Bearer ' + nueva.accessToken);
    expect(panel.status).toBe(200);
  });

  it('el cambio de contraseña exige la actual y cierra todas las sesiones', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480, mustChangePassword: true });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const malaActual = await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set('authorization', 'Bearer ' + session.accessToken)
      .send({ currentPassword: 'NoEsLaActual1', newPassword: 'NuevaClave2026' });
    expect(malaActual.status).toBe(401);

    const ok = await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set('authorization', 'Bearer ' + session.accessToken)
      .send({ currentPassword: intern.password, newPassword: 'NuevaClave2026' });
    expect(ok.status).toBe(200);

    // El token anterior ya no sirve.
    const despues = await request(app)
      .get('/api/v1/auth/me')
      .set('authorization', 'Bearer ' + session.accessToken);
    expect(despues.status).toBe(401);

    // Y la nueva contrasena funciona.
    const nueva = await loginAs(app, intern.dni, 'NuevaClave2026', DEVICE_A);
    expect(nueva.accessToken).toBeTruthy();
  });

  it('rechaza una contraseña que no cumple la política', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const res = await request(app)
      .post('/api/v1/auth/cambiar-password')
      .set('authorization', 'Bearer ' + session.accessToken)
      .send({ currentPassword: intern.password, newPassword: 'todominusculas' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PASSWORD_DEBIL');
  });

  it('el administrador restablece la contraseña y obtiene una temporal', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const admin = await createAdmin();
    const adminSession = await loginAs(app, admin.dni, admin.password);

    const res = await request(app)
      .post('/api/v1/practicantes/' + intern.internId + '/restablecer-password')
      .set('authorization', 'Bearer ' + adminSession.accessToken)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword).toHaveLength(12);

    const nueva = await loginAs(app, intern.dni, res.body.temporaryPassword, DEVICE_A);
    expect(nueva.body.user).toMatchObject({ mustChangePassword: true });

    // La contrasena temporal nunca queda en la auditoria.
    const auditorias = await prisma.auditLog.findMany({ where: { action: 'PASSWORD_RESTABLECIDA' } });
    expect(JSON.stringify(auditorias)).not.toContain(res.body.temporaryPassword);
  });
});

describe('Autorización por rol', () => {
  it('un practicante no puede acceder a las rutas administrativas', async () => {
    const site = await createSite();
    const intern = await createIntern({ siteId: site.id, startMinute: 480 });
    const session = await loginAs(app, intern.dni, intern.password, DEVICE_A);

    const rutas = [
      '/api/v1/practicantes',
      '/api/v1/seguridad/eventos?from=2026-01-01&to=2026-12-31',
      '/api/v1/parametros',
      '/api/v1/archivado',
    ];

    for (const ruta of rutas) {
      const res = await request(app)
        .get(ruta)
        .set('authorization', 'Bearer ' + session.accessToken)
        .set(deviceHeaders(DEVICE_A));
      expect(res.status).toBe(403);
    }
  });

  it('ninguna ruta de negocio responde sin token', async () => {
    const rutas = ['/api/v1/asistencia/hoy', '/api/v1/practicantes', '/api/v1/sedes', '/api/v1/reportes/tipos'];

    for (const ruta of rutas) {
      const res = await request(app).get(ruta);
      expect(res.status).toBe(401);
    }
  });

  it('la política de privacidad si es pública: debe leerse antes de aceptarla', async () => {
    const res = await request(app).get('/api/v1/privacidad');
    expect(res.status).toBe(200);
    expect(res.body.secciones.length).toBeGreaterThan(5);
  });
});
