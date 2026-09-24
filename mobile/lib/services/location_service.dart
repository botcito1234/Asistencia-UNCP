/// Obtencion y validacion de la ubicacion.
///
/// Reglas que se aplican aqui, en el dispositivo, para dar una respuesta rapida
/// y util al usuario. El servidor vuelve a validarlo TODO: nada de lo que se
/// decide aqui se acepta como verdad al otro lado.
///
/// Secuencia:
///   1. Comprobar que el servicio de ubicacion del telefono esta encendido.
///   2. Pedir permiso si hace falta, distinguiendo el rechazo permanente.
///   3. Leer la posicion con precision alta.
///   4. Si el sistema marca la posicion como simulada, abortar de inmediato.
///   5. Si la precision no alcanza el umbral que exige la sede, reintentar
///      unas cuantas veces antes de rendirse: el GPS suele mejorar en segundos.
library;

import 'dart:async';

import 'package:geolocator/geolocator.dart';

import '../core/config.dart';
import '../core/errors.dart';

class LecturaUbicacion {
  const LecturaUbicacion({
    required this.latitud,
    required this.longitud,
    required this.precisionMetros,
    required this.simulada,
    required this.antiguedadMs,
    required this.momento,
    this.altitud,
    this.velocidad,
  });

  final double latitud;
  final double longitud;
  final double precisionMetros;
  final bool simulada;
  final int antiguedadMs;
  final DateTime momento;
  final double? altitud;
  final double? velocidad;
}

class LocationService {
  const LocationService();

  /// Distancia en metros entre dos puntos. Solo para mostrarla mientras el
  /// usuario se acerca; la distancia que decide es la que calcula el servidor.
  double distanciaMetros(
    double lat1,
    double lon1,
    double lat2,
    double lon2,
  ) {
    return Geolocator.distanceBetween(lat1, lon1, lat2, lon2);
  }

  /// Comprueba servicio y permisos. Lanza con un codigo accionable.
  Future<void> asegurarPermisos() async {
    final servicioActivo = await Geolocator.isLocationServiceEnabled();
    if (!servicioActivo) {
      throw const LocalException(
        'GPS_APAGADO',
        'Activa la ubicación (GPS) de tu teléfono para poder marcar.',
      );
    }

    var permiso = await Geolocator.checkPermission();

    if (permiso == LocationPermission.denied) {
      permiso = await Geolocator.requestPermission();
    }

    if (permiso == LocationPermission.deniedForever) {
      throw const LocalException(
        'PERMISO_UBICACION_PERMANENTE',
        'El permiso de ubicación está bloqueado. Habílitalo desde los ajustes del teléfono.',
      );
    }

    if (permiso == LocationPermission.denied) {
      throw const LocalException(
        'PERMISO_UBICACION_DENEGADO',
        'Necesitamos tu ubicación para verificar que estás en tu sede.',
      );
    }
  }

  /// Lee la posicion exigiendo una precision minima.
  ///
  /// [precisionMaxima] viene del servidor y depende del radio de la sede: una
  /// geocerca de 50 m no se puede verificar con una lectura de +-80 m.
  Future<LecturaUbicacion> obtener({
    required double precisionMaxima,
    required int antiguedadMaximaSegundos,
    void Function(String mensaje, int intento)? onProgreso,
  }) async {
    await asegurarPermisos();

    LecturaUbicacion? mejor;

    for (var intento = 1; intento <= AppConfig.locationAttempts; intento++) {
      onProgreso?.call(
        intento == 1
            ? 'Obteniendo tu ubicación...'
            : 'Mejorando la precisión (intento $intento)...',
        intento,
      );

      final Position posicion;
      try {
        posicion = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.best,
            timeLimit: AppConfig.locationTimeout,
          ),
        );
      } on TimeoutException {
        if (intento == AppConfig.locationAttempts) {
          throw const LocalException(
            'GPS_SIN_LECTURA',
            'No se pudo obtener tu ubicación. Verifica que el GPS esté activo y sal al exterior.',
          );
        }
        continue;
      } catch (_) {
        if (intento == AppConfig.locationAttempts) {
          throw const LocalException(
            'GPS_SIN_LECTURA',
            'No se pudo obtener tu ubicación. Verifica que el GPS esté activo.',
          );
        }
        continue;
      }

      final ahora = DateTime.now();
      final antiguedad =
          ahora.difference(posicion.timestamp).inMilliseconds.abs();

      final lectura = LecturaUbicacion(
        latitud: posicion.latitude,
        longitud: posicion.longitude,
        precisionMetros: posicion.accuracy,
        // En Android, isMocked es la senal del propio sistema operativo cuando
        // la posicion procede de un proveedor de ubicacion simulada.
        simulada: posicion.isMocked,
        antiguedadMs: antiguedad,
        momento: ahora,
        altitud: posicion.altitude,
        velocidad: posicion.speed,
      );

      // La ubicacion simulada es un incidente de seguridad, no un problema de
      // senal: no se reintenta, se corta.
      if (lectura.simulada) {
        throw LocalException(
          'UBICACION_SIMULADA',
          'Se detectó una ubicación simulada. Desactiva las aplicaciones de ubicación falsa e intenta nuevamente.',
          meta: {
            'latitud': lectura.latitud,
            'longitud': lectura.longitud,
            'precision': lectura.precisionMetros,
            'intentos': intento,
          },
        );
      }

      // Coordenadas invalidas o sin fijacion real de posicion.
      if (!_coordenadaValida(lectura)) {
        if (intento == AppConfig.locationAttempts) {
          throw const LocalException(
            'GPS_SIN_LECTURA',
            'No se pudo fijar tu posición. Sal al exterior e intenta nuevamente.',
          );
        }
        continue;
      }

      if (mejor == null || lectura.precisionMetros < mejor.precisionMetros) {
        mejor = lectura;
      }

      final precisionSuficiente = lectura.precisionMetros <= precisionMaxima;
      final lecturaFresca =
          antiguedad <= antiguedadMaximaSegundos * 1000;

      if (precisionSuficiente && lecturaFresca) return lectura;

      // Una pausa breve da tiempo al receptor a fijar mas satelites.
      if (intento < AppConfig.locationAttempts) {
        await Future<void>.delayed(const Duration(milliseconds: 1200));
      }
    }

    // Se agotaron los intentos: se informa con el mejor dato conseguido, que es
    // lo que el usuario necesita saber para decidir que hacer.
    final precision = mejor?.precisionMetros.round() ?? 0;
    throw LocalException(
      'GPS_IMPRECISO',
      'Tu ubicación no tiene suficiente precisión ($precision m; se requieren '
      '${precisionMaxima.round()} m o menos). Sal al exterior, alejate de paredes y vuelve a intentarlo.',
      meta: {
        'precision': precision,
        'maxima': precisionMaxima,
        'latitud': mejor?.latitud,
        'longitud': mejor?.longitud,
        'intentos': AppConfig.locationAttempts,
      },
    );
  }

  bool _coordenadaValida(LecturaUbicacion l) {
    if (l.latitud.isNaN || l.longitud.isNaN) return false;
    if (l.latitud.abs() > 90 || l.longitud.abs() > 180) return false;
    // (0,0) es el valor por defecto de un receptor que no fijo posicion.
    if (l.latitud.abs() < 1e-7 && l.longitud.abs() < 1e-7) return false;
    if (l.precisionMetros.isNaN || l.precisionMetros < 0) return false;
    return true;
  }

  Future<void> abrirAjustesUbicacion() => Geolocator.openLocationSettings();
  Future<void> abrirAjustesAplicacion() => Geolocator.openAppSettings();
}
