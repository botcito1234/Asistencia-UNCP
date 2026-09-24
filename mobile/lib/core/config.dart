/// Configuracion de la aplicacion.
///
/// La URL del servidor se inyecta al compilar con --dart-define, de modo que el
/// mismo codigo sirve para desarrollo, pruebas y produccion sin recompilar
/// nada distinto:
///
///   flutter build apk --release --dart-define=API_BASE_URL=https://api.ejemplo.pe
///
/// Aqui no vive NINGUNA credencial. El APK no contiene claves de Google Drive,
/// ni secretos de firma de tokens, ni contrasenas: todo eso queda en el
/// servidor.
library;

class AppConfig {
  const AppConfig._();

  /// URL base del servidor, sin barra final.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    // 10.0.2.2 es el host anfitrion visto desde el emulador de Android.
    defaultValue: 'http://10.0.2.2:4000',
  );

  static String get apiUrl => '$apiBaseUrl/api/v1';

  static const String appName = 'Control de Asistencia';

  /// Tiempos de espera de red. Marcar asistencia sube una fotografia, por eso
  /// el envio tolera mas que una lectura normal.
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 30);
  static const Duration uploadTimeout = Duration(seconds: 60);

  /// Calidad de compresion de la evidencia. Suficiente para reconocer a la
  /// persona y lo bastante ligera para subirse con datos moviles.
  static const int photoQuality = 78;
  static const int photoMaxWidth = 1080;
  static const int photoMaxHeight = 1440;

  /// Tiempo maximo esperando una lectura GPS utilizable.
  static const Duration locationTimeout = Duration(seconds: 25);

  /// Reintentos de lectura GPS antes de rendirse, cuando la precision no basta.
  static const int locationAttempts = 3;

  /// Servidor de teselas del mapa. OpenStreetMap no exige clave de API.
  static const String mapTileUrl = String.fromEnvironment(
    'MAP_TILE_URL',
    defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  );

  static const String mapUserAgent = 'pe.edu.personalclass.asistencia_app';
}
