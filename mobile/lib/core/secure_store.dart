/// Almacenamiento cifrado.
///
/// Los tokens de sesion y el secreto que compone la huella del dispositivo se
/// guardan en el almacen protegido del sistema (Android Keystore mediante
/// EncryptedSharedPreferences). Nunca en SharedPreferences en claro ni en un
/// archivo del almacenamiento compartido.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStore {
  const SecureStore();

  static const _almacen = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  Future<String?> leer(String clave) async {
    try {
      return await _almacen.read(key: clave);
    } catch (_) {
      // Un almacen corrupto no debe impedir que la aplicacion abra: se trata
      // como si no hubiera dato y el usuario vuelve a iniciar sesion.
      return null;
    }
  }

  Future<void> escribir(String clave, String valor) async {
    await _almacen.write(key: clave, value: valor);
  }

  Future<void> borrar(String clave) async {
    await _almacen.delete(key: clave);
  }

  /// Limpia la sesion pero CONSERVA el secreto del dispositivo: cerrar sesion
  /// no debe forzar una nueva autorizacion administrativa.
  Future<void> limpiarSesion() async {
    await borrar(ClavesSeguras.accessToken);
    await borrar(ClavesSeguras.refreshToken);
    await borrar(ClavesSeguras.usuario);
  }
}

class ClavesSeguras {
  const ClavesSeguras._();
  static const accessToken = 'access_token';
  static const refreshToken = 'refresh_token';
  static const usuario = 'usuario';
  static const ultimoDni = 'ultimo_dni';
}
