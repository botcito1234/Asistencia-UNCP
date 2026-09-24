/// Identidad del dispositivo.
///
/// Decision sobre que identificador usar en Android:
///
///  - NO se usa IMEI ni numero de serie. Android 10 y posteriores los bloquean
///    para aplicaciones que no son del fabricante, y ademas son identificadores
///    de hardware cuyo tratamiento seria desproporcionado para este fin.
///  - NO se usa solo ANDROID_ID, porque cambia al restaurar de fabrica y puede
///    repetirse entre perfiles de usuario del mismo telefono.
///
/// Lo que se usa es una huella compuesta y estable:
///   SHA-256( secreto_aleatorio_local + ANDROID_ID + modelo + fabricante )
///
/// El secreto se genera la primera vez que se abre la aplicacion y se guarda en
/// el almacen cifrado del sistema (Android Keystore, via flutter_secure_storage).
/// Consecuencias practicas, que son las deseadas:
///   - Sobrevive a actualizaciones de la aplicacion y a reinicios.
///   - Cambia si se borran los datos de la aplicacion o se reinstala, y en ese
///     caso el administrador debe volver a autorizar el dispositivo. Es el
///     comportamiento correcto: un borrado de datos es indistinguible de un
///     telefono nuevo.
///   - No expone ningun identificador de hardware al servidor.
///
/// Ninguna huella generada en el cliente es infalsificable. Por eso la defensa
/// es por capas: huella + sesion unica + geocerca + evidencia fotográfica +
/// auditoria del lado del servidor.
library;

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'secure_store.dart';

class DeviceIdentity {
  DeviceIdentity(this._store);

  final SecureStore _store;

  static const _claveSecreto = 'device_secret';

  String? _huellaCache;
  DeviceProfile? _perfilCache;

  /// Huella estable del dispositivo. Se calcula una vez por ejecucion.
  Future<String> fingerprint() async {
    if (_huellaCache != null) return _huellaCache!;

    final secreto = await _obtenerOCrearSecreto();
    final perfil = await profile();

    final material = [
      secreto,
      perfil.androidId,
      perfil.model,
      perfil.manufacturer,
    ].join('|');

    final digest = sha256.convert(utf8.encode(material));
    // base64url sin relleno: encaja en el patron que valida el servidor
    // (A-Z a-z 0-9 . _ : -) y mide 43 caracteres.
    _huellaCache = base64Url.encode(digest.bytes).replaceAll('=', '');
    return _huellaCache!;
  }

  Future<String> _obtenerOCrearSecreto() async {
    final existente = await _store.leer(_claveSecreto);
    if (existente != null && existente.length >= 32) return existente;

    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    final secreto = base64Url.encode(bytes);
    await _store.escribir(_claveSecreto, secreto);
    return secreto;
  }

  Future<DeviceProfile> profile() async {
    if (_perfilCache != null) return _perfilCache!;

    final plugin = DeviceInfoPlugin();
    final paquete = await PackageInfo.fromPlatform();

    try {
      final android = await plugin.androidInfo;
      _perfilCache = DeviceProfile(
        platform: 'android',
        model: '${android.manufacturer} ${android.model}'.trim(),
        manufacturer: android.manufacturer,
        osVersion: 'Android ${android.version.release} (API ${android.version.sdkInt})',
        androidId: android.id,
        appVersion: '${paquete.version}+${paquete.buildNumber}',
        // Un dispositivo no fisico es, por si solo, una senal a auditar.
        isPhysicalDevice: android.isPhysicalDevice,
      );
    } catch (_) {
      // Plataforma no Android (pruebas de escritorio): se degrada sin romper.
      _perfilCache = DeviceProfile(
        platform: 'desconocida',
        model: 'desconocido',
        manufacturer: 'desconocido',
        osVersion: 'desconocida',
        androidId: 'sin-id',
        appVersion: '${paquete.version}+${paquete.buildNumber}',
        isPhysicalDevice: false,
      );
    }

    return _perfilCache!;
  }

  /// Cabeceras que identifican el dispositivo en cada peticion.
  Future<Map<String, String>> headers() async {
    final perfil = await profile();
    return {
      'x-device-id': await fingerprint(),
      'x-device-platform': perfil.platform,
      'x-device-model': perfil.model,
      'x-device-os': perfil.osVersion,
      'x-app-version': perfil.appVersion,
    };
  }
}

class DeviceProfile {
  const DeviceProfile({
    required this.platform,
    required this.model,
    required this.manufacturer,
    required this.osVersion,
    required this.androidId,
    required this.appVersion,
    required this.isPhysicalDevice,
  });

  final String platform;
  final String model;
  final String manufacturer;
  final String osVersion;
  final String androidId;
  final String appVersion;
  final bool isPhysicalDevice;
}
