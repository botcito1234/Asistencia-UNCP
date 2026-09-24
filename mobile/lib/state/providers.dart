/// Estado de la aplicacion con Riverpod.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/device_identity.dart';
import '../core/errors.dart';
import '../core/secure_store.dart';
import '../models/models.dart';
import '../services/api_services.dart';
import '../services/camera_service.dart';
import '../services/location_service.dart';

// ---------------------------------------------------------------------------
// Infraestructura
// ---------------------------------------------------------------------------

final secureStoreProvider = Provider<SecureStore>((ref) => const SecureStore());

final deviceIdentityProvider = Provider<DeviceIdentity>(
  (ref) => DeviceIdentity(ref.watch(secureStoreProvider)),
);

final apiClientProvider = Provider<ApiClient>((ref) {
  final cliente = ApiClient(
    store: ref.watch(secureStoreProvider),
    device: ref.watch(deviceIdentityProvider),
  );
  // Si el servidor invalida la sesion (cierre remoto, dispositivo desvinculado,
  // cuenta desactivada), la aplicacion vuelve al inicio de sesion sola.
  cliente.onSesionExpirada = () {
    ref.read(sesionProvider.notifier).forzarCierre();
  };
  return cliente;
});

final locationServiceProvider =
    Provider<LocationService>((ref) => const LocationService());

final cameraServiceProvider =
    Provider<CameraService>((ref) => const CameraService());

final authServiceProvider = Provider<AuthService>(
  (ref) => AuthService(ref.watch(apiClientProvider), ref.watch(secureStoreProvider)),
);

final attendanceServiceProvider = Provider<AttendanceService>(
  (ref) => AttendanceService(ref.watch(apiClientProvider)),
);

final notificationServiceProvider = Provider<NotificationService>(
  (ref) => NotificationService(ref.watch(apiClientProvider)),
);

final adminServiceProvider = Provider<AdminService>(
  (ref) => AdminService(ref.watch(apiClientProvider)),
);

// ---------------------------------------------------------------------------
// Sesion
// ---------------------------------------------------------------------------

enum FaseSesion { cargando, sinSesion, autenticado }

@immutable
class EstadoSesion {
  const EstadoSesion({
    required this.fase,
    this.usuario,
    this.error,
  });

  final FaseSesion fase;
  final Usuario? usuario;
  final String? error;

  bool get autenticado => fase == FaseSesion.autenticado && usuario != null;

  EstadoSesion copiar({FaseSesion? fase, Usuario? usuario, String? error}) =>
      EstadoSesion(
        fase: fase ?? this.fase,
        usuario: usuario ?? this.usuario,
        error: error,
      );
}

class SesionNotifier extends StateNotifier<EstadoSesion> {
  SesionNotifier(this._ref)
      : super(const EstadoSesion(fase: FaseSesion.cargando)) {
    _restaurar();
  }

  final Ref _ref;

  Future<void> _restaurar() async {
    final auth = _ref.read(authServiceProvider);
    try {
      final usuario = await auth.restaurarSesion();
      state = usuario == null
          ? const EstadoSesion(fase: FaseSesion.sinSesion)
          : EstadoSesion(fase: FaseSesion.autenticado, usuario: usuario);
    } catch (_) {
      state = const EstadoSesion(fase: FaseSesion.sinSesion);
    }
  }

  Future<void> iniciarSesion(String dni, String password) async {
    state = const EstadoSesion(fase: FaseSesion.cargando);
    try {
      final usuario =
          await _ref.read(authServiceProvider).iniciarSesion(dni, password);
      state = EstadoSesion(fase: FaseSesion.autenticado, usuario: usuario);
    } on AppException catch (e) {
      state = EstadoSesion(fase: FaseSesion.sinSesion, error: e.message);
      rethrow;
    } catch (e) {
      state = EstadoSesion(
        fase: FaseSesion.sinSesion,
        error: 'No se pudo iniciar sesión.',
      );
      rethrow;
    }
  }

  Future<void> cerrarSesion() async {
    await _ref.read(authServiceProvider).cerrarSesion();
    state = const EstadoSesion(fase: FaseSesion.sinSesion);
  }

  /// Cierre forzado por el servidor. No intenta llamar al endpoint de logout.
  void forzarCierre() {
    if (state.fase == FaseSesion.sinSesion) return;
    state = const EstadoSesion(
      fase: FaseSesion.sinSesion,
      error: 'Tu sesión se cerró. Vuelve a iniciar sesión.',
    );
  }

  Future<void> refrescarUsuario() async {
    final usuario = await _ref.read(authServiceProvider).restaurarSesion();
    if (usuario != null) {
      state = EstadoSesion(fase: FaseSesion.autenticado, usuario: usuario);
    }
  }

  void limpiarError() {
    if (state.error != null) state = state.copiar();
  }
}

final sesionProvider =
    StateNotifierProvider<SesionNotifier, EstadoSesion>((ref) => SesionNotifier(ref));

final usuarioProvider = Provider<Usuario?>((ref) => ref.watch(sesionProvider).usuario);

// ---------------------------------------------------------------------------
// Estado del dia
// ---------------------------------------------------------------------------

final estadoHoyProvider = FutureProvider.autoDispose<EstadoHoy>((ref) async {
  // Se vuelve a leer cuando cambia el usuario (por ejemplo, tras marcar).
  ref.watch(usuarioProvider);
  return ref.watch(attendanceServiceProvider).estadoHoy();
});

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

@immutable
class RangoFechas {
  const RangoFechas(this.desde, this.hasta);
  final String desde;
  final String hasta;

  @override
  bool operator ==(Object other) =>
      other is RangoFechas && other.desde == desde && other.hasta == hasta;

  @override
  int get hashCode => Object.hash(desde, hasta);
}

final historialProvider = FutureProvider.autoDispose
    .family<({List<Jornada> jornadas, ResumenPeriodo resumen}), RangoFechas>(
  (ref, rango) async {
    return ref
        .watch(attendanceServiceProvider)
        .historial(desde: rango.desde, hasta: rango.hasta);
  },
);

// ---------------------------------------------------------------------------
// Notificaciones
// ---------------------------------------------------------------------------

final notificacionesProvider = FutureProvider.autoDispose<
    ({List<Notificacion> items, int sinLeer})>((ref) async {
  return ref.watch(notificationServiceProvider).listar();
});

// ---------------------------------------------------------------------------
// Administracion
// ---------------------------------------------------------------------------

final tableroProvider = FutureProvider.autoDispose
    .family<({TableroTotales totales, List<TableroSede> sedes}), String>(
  (ref, fecha) async => ref.watch(adminServiceProvider).tablero(fecha),
);

final alertasProvider =
    FutureProvider.autoDispose.family<List<EventoSeguridad>, RangoFechas>(
  (ref, rango) async => ref
      .watch(adminServiceProvider)
      .alertas(desde: rango.desde, hasta: rango.hasta),
);

final practicantesProvider =
    FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>(
  (ref, busqueda) async =>
      ref.watch(adminServiceProvider).practicantes(busqueda: busqueda),
);

// ---------------------------------------------------------------------------
// Conectividad
// ---------------------------------------------------------------------------

final hayConexionProvider = FutureProvider.autoDispose<bool>((ref) async {
  return ref.watch(apiClientProvider).hayConexion();
});
