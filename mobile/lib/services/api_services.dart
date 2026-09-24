/// Servicios que hablan con la API.
library;

import 'dart:convert';
import 'dart:math';

import 'package:dio/dio.dart';

import '../core/api_client.dart';
import '../core/secure_store.dart';
import '../models/models.dart';
import 'camera_service.dart';
import 'location_service.dart';

// ---------------------------------------------------------------------------
// Autenticacion
// ---------------------------------------------------------------------------

class AuthService {
  AuthService(this._api, this._store);

  final ApiClient _api;
  final SecureStore _store;

  Future<Usuario> iniciarSesion(String dni, String password) async {
    final respuesta = await _api.post(
      '/auth/login',
      cuerpo: {'dni': dni, 'password': password},
      conAutenticacion: false,
    );

    final tokens = respuesta['tokens'] as Map<String, dynamic>;
    await _api.guardarTokens(
      tokens['accessToken'] as String,
      tokens['refreshToken'] as String,
    );

    final usuario =
        Usuario.desdeJson(respuesta['user'] as Map<String, dynamic>);
    await _store.escribir(ClavesSeguras.usuario, jsonEncode(usuario.aJson()));
    await _store.escribir(ClavesSeguras.ultimoDni, dni);
    return usuario;
  }

  /// Recupera la sesion guardada al abrir la aplicacion.
  Future<Usuario?> restaurarSesion() async {
    if (!await _api.haySesionGuardada()) return null;
    try {
      final respuesta = await _api.get('/auth/me');
      final usuario =
          Usuario.desdeJson(respuesta['user'] as Map<String, dynamic>);
      await _store.escribir(ClavesSeguras.usuario, jsonEncode(usuario.aJson()));
      return usuario;
    } catch (_) {
      // Token invalido, cuenta desactivada o dispositivo desvinculado: se
      // limpia y se pide iniciar sesion de nuevo.
      await _api.limpiarSesion();
      return null;
    }
  }

  Future<void> cerrarSesion() async {
    try {
      await _api.post('/auth/logout');
    } catch (_) {
      // Aunque el servidor no responda, la sesion local se limpia.
    }
    await _api.limpiarSesion();
  }

  Future<void> cambiarPassword(String actual, String nueva) async {
    await _api.post('/auth/cambiar-password', cuerpo: {
      'currentPassword': actual,
      'newPassword': nueva,
    });
    // El servidor cierra todas las sesiones al cambiar la contrasena.
    await _api.limpiarSesion();
  }

  Future<void> aceptarConsentimiento(String version) async {
    await _api.post('/auth/consentimiento', cuerpo: {
      'policyVersion': version,
      'accepted': true,
    });
  }

  Future<Map<String, dynamic>> politicaPrivacidad() async {
    return _api.get('/privacidad');
  }

  Future<Map<String, dynamic>> estadoDispositivo() async {
    return _api.get('/auth/dispositivo');
  }

  Future<String?> ultimoDni() => _store.leer(ClavesSeguras.ultimoDni);
}

// ---------------------------------------------------------------------------
// Asistencia
// ---------------------------------------------------------------------------

class AttendanceService {
  AttendanceService(this._api);

  final ApiClient _api;

  Future<EstadoHoy> estadoHoy() async {
    final respuesta = await _api.get('/asistencia/hoy');
    return EstadoHoy.desdeJson(respuesta);
  }

  /// Envia la marcacion con su evidencia.
  ///
  /// La clave de idempotencia se genera por (practicante, tipo, dia): si el
  /// envio se reintenta por un corte de red, el servidor devuelve la marcacion
  /// ya creada en lugar de duplicarla.
  Future<ResultadoMarcacion> marcar({
    required bool esEntrada,
    required LecturaUbicacion ubicacion,
    required EvidenciaCapturada evidencia,
    required String fechaNegocio,
    required String practicanteId,
  }) async {
    final ruta = esEntrada ? '/asistencia/entrada' : '/asistencia/salida';

    final claveIdempotencia = _claveIdempotencia(
      practicanteId: practicanteId,
      tipo: esEntrada ? 'entrada' : 'salida',
      fecha: fechaNegocio,
    );

    final respuesta = await _api.postMultipart(
      ruta,
      campos: {
        'latitude': ubicacion.latitud,
        'longitude': ubicacion.longitud,
        'accuracyMeters': ubicacion.precisionMetros,
        'altitude': ubicacion.altitud,
        'speed': ubicacion.velocidad,
        'locationAgeMs': ubicacion.antiguedadMs,
        'mockLocationReported': ubicacion.simulada,
        'developerModeReported': false,
        'deviceTime': ubicacion.momento.toUtc().toIso8601String(),
        'idempotencyKey': claveIdempotencia,
      },
      archivo: MultipartFile.fromBytes(
        evidencia.bytes,
        filename: evidencia.nombreArchivo,
        contentType: DioMediaType('image', 'jpeg'),
      ),
      nombreArchivo: 'foto',
      claveIdempotencia: claveIdempotencia,
    );

    return ResultadoMarcacion.desdeJson(respuesta);
  }

  /// Informa al servidor un intento que la propia aplicacion detuvo antes de
  /// enviarlo (ubicacion simulada o GPS sin la precision exigida), para que
  /// quede registrado y, si es critico, se avise al administrador.
  Future<void> reportarIncidente({
    required String tipo,
    required bool esEntrada,
    Map<String, dynamic>? meta,
  }) async {
    await _api.post('/asistencia/incidente', cuerpo: {
      'tipo': tipo,
      'tipoMarcacion': esEntrada ? 'ENTRADA' : 'SALIDA',
      if (meta?['latitud'] != null) 'latitude': meta!['latitud'],
      if (meta?['longitud'] != null) 'longitude': meta!['longitud'],
      if (meta?['precision'] != null) 'accuracyMeters': meta!['precision'],
      if (meta?['distancia'] != null) 'distanceMeters': meta!['distancia'],
      if (meta?['intentos'] != null) 'intentos': meta!['intentos'],
    });
  }

  String _claveIdempotencia({
    required String practicanteId,
    required String tipo,
    required String fecha,
  }) {
    // Determinista para el mismo dia y tipo: reintentar no crea duplicados.
    final base = '$practicanteId-$tipo-$fecha';
    return base.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '').padRight(16, '0');
  }

  Future<({List<Jornada> jornadas, ResumenPeriodo resumen})> historial({
    required String desde,
    required String hasta,
  }) async {
    final respuesta = await _api.get('/asistencia/mi-historial', query: {
      'from': desde,
      'to': hasta,
      'pageSize': 100,
    });

    final items = (respuesta['items'] as List<dynamic>? ?? [])
        .map((e) => Jornada.desdeJson(e as Map<String, dynamic>))
        .toList();

    final resumen = ResumenPeriodo.desdeJson(
      respuesta['summary'] as Map<String, dynamic>? ?? const {},
    );

    return (jornadas: items, resumen: resumen);
  }
}

// ---------------------------------------------------------------------------
// Notificaciones
// ---------------------------------------------------------------------------

class NotificationService {
  NotificationService(this._api);

  final ApiClient _api;

  Future<({List<Notificacion> items, int sinLeer})> listar() async {
    final respuesta = await _api.get('/notificaciones', query: {'pageSize': 50});
    final items = (respuesta['items'] as List<dynamic>? ?? [])
        .map((e) => Notificacion.desdeJson(e as Map<String, dynamic>))
        .toList();
    return (items: items, sinLeer: (respuesta['unread'] as num?)?.toInt() ?? 0);
  }

  Future<void> marcarLeida(String id) async {
    await _api.post('/notificaciones/$id/leida');
  }

  Future<void> marcarTodasLeidas() async {
    await _api.post('/notificaciones/leer-todas');
  }

  /// Registra el token de notificaciones push, si el proyecto tiene Firebase
  /// configurado. Sin el, las alertas siguen llegando dentro de la aplicacion.
  Future<void> registrarTokenPush(String token) async {
    await _api.post('/auth/push-token',
        cuerpo: {'token': token, 'platform': 'android'});
  }
}

// ---------------------------------------------------------------------------
// Administracion (vista movil del administrador)
// ---------------------------------------------------------------------------

class AdminService {
  AdminService(this._api);

  final ApiClient _api;

  Future<({TableroTotales totales, List<TableroSede> sedes})> tablero(
    String fecha,
  ) async {
    final respuesta = await _api.get('/asistencia/tablero', query: {'date': fecha});
    final totales =
        TableroTotales.desdeJson(respuesta['totals'] as Map<String, dynamic>);
    final sedes = (respuesta['sites'] as List<dynamic>? ?? [])
        .map((e) => TableroSede.desdeJson(e as Map<String, dynamic>))
        .toList();
    return (totales: totales, sedes: sedes);
  }

  Future<List<EventoSeguridad>> alertas({
    required String desde,
    required String hasta,
    bool soloPendientes = true,
  }) async {
    final respuesta = await _api.get('/seguridad/eventos', query: {
      'from': desde,
      'to': hasta,
      if (soloPendientes) 'onlyPending': 'true',
      'pageSize': 50,
    });
    return (respuesta['items'] as List<dynamic>? ?? [])
        .map((e) => EventoSeguridad.desdeJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> atenderAlerta(String id, String? nota) async {
    await _api.post('/seguridad/eventos/$id/atender',
        cuerpo: {if (nota != null && nota.isNotEmpty) 'note': nota});
  }

  Future<List<Map<String, dynamic>>> practicantes({String? sedeId, String? busqueda}) async {
    final respuesta = await _api.get('/practicantes', query: {
      if (sedeId != null && sedeId.isNotEmpty) 'siteId': sedeId,
      if (busqueda != null && busqueda.isNotEmpty) 'search': busqueda,
      'pageSize': 100,
    });
    return (respuesta['items'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>();
  }

  Future<List<Map<String, dynamic>>> sedes() async {
    final respuesta = await _api.get('/sedes');
    final items = respuesta['items'];
    if (items is List) return items.cast<Map<String, dynamic>>();
    return const [];
  }

  Future<Map<String, dynamic>> dispositivosDe(String practicanteId) async {
    return _api.get('/practicantes/$practicanteId/dispositivos');
  }

  Future<void> autorizarCambioDispositivo(
      String practicanteId, String motivo) async {
    await _api.post(
      '/practicantes/$practicanteId/dispositivos/autorizar-cambio',
      cuerpo: {'reason': motivo},
    );
  }

  Future<void> revocarDispositivo(
      String practicanteId, String bindingId, String motivo) async {
    await _api.delete(
      '/practicantes/$practicanteId/dispositivos/$bindingId',
      cuerpo: {'reason': motivo},
    );
  }

  Future<Map<String, dynamic>> restablecerPassword(String practicanteId) async {
    return _api.post('/practicantes/$practicanteId/restablecer-password');
  }
}

/// Identificador corto y legible para trazas de la interfaz.
String idCorto() {
  final r = Random();
  return List.generate(8, (_) => r.nextInt(16).toRadixString(16)).join();
}
