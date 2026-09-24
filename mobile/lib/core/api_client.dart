/// Cliente HTTP.
///
/// Responsabilidades:
///  - Adjuntar el token y las cabeceras de identificacion del dispositivo.
///  - Renovar la sesion con el refresh token cuando el access caduca, una sola
///    vez aunque fallen varias peticiones a la vez.
///  - Traducir cualquier fallo (red, tiempo agotado, error del servidor) a una
///    AppException con codigo estable.
///  - Comprobar que hay Internet antes de intentar nada: el sistema no admite
///    marcaciones sin conexion, por decision de negocio.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';

import 'config.dart';
import 'device_identity.dart';
import 'errors.dart';
import 'secure_store.dart';

typedef SesionExpiradaCallback = void Function();

class ApiClient {
  ApiClient({
    required SecureStore store,
    required DeviceIdentity device,
  })  : _store = store,
        _device = device {
    _dio = Dio(
      BaseOptions(
        baseUrl: AppConfig.apiUrl,
        connectTimeout: AppConfig.connectTimeout,
        receiveTimeout: AppConfig.receiveTimeout,
        // El cliente decide como interpretar cada codigo, no Dio.
        validateStatus: (_) => true,
        headers: {'accept': 'application/json'},
      ),
    );
  }

  final SecureStore _store;
  final DeviceIdentity _device;
  late final Dio _dio;

  SesionExpiradaCallback? onSesionExpirada;

  Future<bool>? _renovacionEnCurso;

  // ---------------------------------------------------------------------------
  // Conexion
  // ---------------------------------------------------------------------------

  /// Internet es obligatorio. No existe modo sin conexion ni cola de envios.
  Future<void> exigirConexion() async {
    final resultado = await Connectivity().checkConnectivity();
    final sinRed = resultado.isEmpty ||
        resultado.every((r) => r == ConnectivityResult.none);
    if (sinRed) {
      throw const LocalException(
        'SIN_CONEXION',
        'Necesitas conexión a Internet para registrar tu asistencia.',
      );
    }
  }

  Future<bool> hayConexion() async {
    final resultado = await Connectivity().checkConnectivity();
    return resultado.isNotEmpty &&
        resultado.any((r) => r != ConnectivityResult.none);
  }

  // ---------------------------------------------------------------------------
  // Peticiones
  // ---------------------------------------------------------------------------

  Future<Map<String, dynamic>> get(
    String ruta, {
    Map<String, dynamic>? query,
  }) async {
    return _ejecutar(() async => _dio.get(
          ruta,
          queryParameters: query,
          options: Options(headers: await _cabeceras()),
        ));
  }

  Future<Map<String, dynamic>> post(
    String ruta, {
    Object? cuerpo,
    bool conAutenticacion = true,
  }) async {
    return _ejecutar(() async => _dio.post(
          ruta,
          data: cuerpo,
          options: Options(
            headers: await _cabeceras(conToken: conAutenticacion),
          ),
        ));
  }

  Future<Map<String, dynamic>> delete(
    String ruta, {
    Object? cuerpo,
  }) async {
    return _ejecutar(() async => _dio.delete(
          ruta,
          data: cuerpo,
          options: Options(headers: await _cabeceras()),
        ));
  }

  /// Envio multiparte de una marcacion: datos de ubicacion mas la fotografia.
  Future<Map<String, dynamic>> postMultipart(
    String ruta, {
    required Map<String, dynamic> campos,
    required MultipartFile archivo,
    required String nombreArchivo,
    String? claveIdempotencia,
  }) async {
    final formulario = FormData.fromMap({
      ...campos.map((k, v) => MapEntry(k, v?.toString() ?? '')),
      nombreArchivo: archivo,
    });

    final cabeceras = await _cabeceras();
    if (claveIdempotencia != null) {
      cabeceras['idempotency-key'] = claveIdempotencia;
    }

    return _ejecutar(() async => _dio.post(
          ruta,
          data: formulario,
          options: Options(
            headers: cabeceras,
            sendTimeout: AppConfig.uploadTimeout,
            receiveTimeout: AppConfig.uploadTimeout,
          ),
        ));
  }

  Future<Map<String, String>> _cabeceras({bool conToken = true}) async {
    final cabeceras = <String, String>{...await _device.headers()};
    if (conToken) {
      final token = await _store.leer(ClavesSeguras.accessToken);
      if (token != null) cabeceras['authorization'] = 'Bearer $token';
    }
    return cabeceras;
  }

  Future<Map<String, dynamic>> _ejecutar(
    Future<Response<dynamic>> Function() peticion, {
    bool yaReintentado = false,
  }) async {
    await exigirConexion();

    Response<dynamic> respuesta;
    try {
      respuesta = await peticion();
    } on DioException catch (e) {
      throw _traducirDio(e);
    } catch (e) {
      throw AppException(
        code: 'ERROR_INTERNO',
        message: 'Ocurrio un error inesperado: $e',
      );
    }

    final estado = respuesta.statusCode ?? 0;

    // Sesion caducada: se intenta renovar una sola vez.
    if (estado == 401 && !yaReintentado) {
      final renovado = await _renovarSesion();
      if (renovado) {
        return _ejecutar(peticion, yaReintentado: true);
      }
    }

    if (estado >= 200 && estado < 300) {
      final datos = respuesta.data;
      if (datos is Map<String, dynamic>) return datos;
      if (datos is List) return {'items': datos};
      return <String, dynamic>{};
    }

    throw _traducirRespuesta(respuesta);
  }

  AppException _traducirRespuesta(Response<dynamic> respuesta) {
    final datos = respuesta.data;
    String code = 'ERROR_INTERNO';
    String? mensaje;
    Map<String, dynamic>? meta;

    if (datos is Map<String, dynamic>) {
      final error = datos['error'];
      if (error is Map<String, dynamic>) {
        code = (error['code'] as String?) ?? code;
        mensaje = error['message'] as String?;
        final m = error['meta'];
        if (m is Map<String, dynamic>) meta = m;
      }
    }

    final estado = respuesta.statusCode ?? 0;
    if (code == 'ERROR_INTERNO') {
      if (estado == 429) code = 'DEMASIADAS_SOLICITUDES';
      if (estado == 502 || estado == 503) code = 'SERVIDOR_NO_DISPONIBLE';
    }

    if (ErrorCatalog.exigeReautenticacion(code)) {
      onSesionExpirada?.call();
    }

    return AppException(
      code: code,
      message: ErrorCatalog.mensaje(code, mensajeServidor: mensaje),
      meta: meta,
      statusCode: estado,
    );
  }

  AppException _traducirDio(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return AppException(
          code: 'TIEMPO_AGOTADO',
          message: ErrorCatalog.mensaje('TIEMPO_AGOTADO'),
        );
      case DioExceptionType.connectionError:
        return AppException(
          code: 'SERVIDOR_NO_DISPONIBLE',
          message: ErrorCatalog.mensaje('SERVIDOR_NO_DISPONIBLE'),
        );
      case DioExceptionType.cancel:
        return const AppException(
          code: 'ERROR_INTERNO',
          message: 'La operación fue cancelada.',
        );
      default:
        return AppException(
          code: 'SERVIDOR_NO_DISPONIBLE',
          message: ErrorCatalog.mensaje('SERVIDOR_NO_DISPONIBLE'),
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Renovacion de sesion
  // ---------------------------------------------------------------------------

  Future<bool> _renovarSesion() {
    // Si ya hay una renovacion en marcha, se espera a esa. Asi varias
    // peticiones que fallan a la vez no gastan el refresh token por duplicado,
    // lo que el servidor interpretaria como reutilizacion y cerraria todo.
    return _renovacionEnCurso ??= _hacerRenovacion().whenComplete(() {
      _renovacionEnCurso = null;
    });
  }

  Future<bool> _hacerRenovacion() async {
    final refresh = await _store.leer(ClavesSeguras.refreshToken);
    if (refresh == null) return false;

    try {
      final respuesta = await _dio.post(
        '/auth/refresh',
        data: {'refreshToken': refresh},
        options: Options(headers: await _device.headers()),
      );

      final estado = respuesta.statusCode ?? 0;
      if (estado < 200 || estado >= 300) {
        await _store.limpiarSesion();
        onSesionExpirada?.call();
        return false;
      }

      final datos = respuesta.data as Map<String, dynamic>;
      final tokens = datos['tokens'] as Map<String, dynamic>;
      await _store.escribir(
          ClavesSeguras.accessToken, tokens['accessToken'] as String);
      await _store.escribir(
          ClavesSeguras.refreshToken, tokens['refreshToken'] as String);
      return true;
    } catch (_) {
      await _store.limpiarSesion();
      onSesionExpirada?.call();
      return false;
    }
  }

  /// Guarda los tokens tras un inicio de sesion correcto.
  Future<void> guardarTokens(String access, String refresh) async {
    await _store.escribir(ClavesSeguras.accessToken, access);
    await _store.escribir(ClavesSeguras.refreshToken, refresh);
  }

  Future<void> limpiarSesion() => _store.limpiarSesion();

  Future<bool> haySesionGuardada() async =>
      await _store.leer(ClavesSeguras.refreshToken) != null;
}
