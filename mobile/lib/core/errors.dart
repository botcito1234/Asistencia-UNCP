/// Errores de la aplicacion.
///
/// El servidor devuelve un `code` estable. La aplicacion decide que mensaje
/// mostrar y que accion ofrecer a partir de ese codigo, nunca del texto libre,
/// para que un cambio de redaccion en el servidor no rompa la interfaz.
library;

class AppException implements Exception {
  const AppException({
    required this.code,
    required this.message,
    this.meta,
    this.statusCode,
  });

  final String code;
  final String message;
  final Map<String, dynamic>? meta;
  final int? statusCode;

  @override
  String toString() => 'AppException($code): $message';
}

/// Errores que origina el propio dispositivo, antes de llegar al servidor.
class LocalException extends AppException {
  const LocalException(String code, String message, {super.meta})
      : super(code: code, message: message);
}

/// Catalogo de mensajes orientados a la persona que usa la aplicacion.
/// Cada entrada dice que pasa y que puede hacer.
class ErrorCatalog {
  const ErrorCatalog._();

  static const Map<String, String> _mensajes = {
    // --- Conexion --------------------------------------------------------
    'SIN_CONEXION':
        'Necesitas conexión a Internet para registrar tu asistencia.',
    'TIEMPO_AGOTADO':
        'El servidor no respondio a tiempo. Verifica tu conexión e intenta nuevamente.',
    'SERVIDOR_NO_DISPONIBLE':
        'No se pudo contactar con el servidor. Intenta nuevamente en unos minutos.',

    // --- Acceso ----------------------------------------------------------
    'CREDENCIALES_INVALIDAS': 'DNI o contraseña incorrectos.',
    'CUENTA_INACTIVA':
        'Tu cuenta no está activa. Comunícate con el administrador.',
    'CUENTA_BLOQUEADA':
        'Cuenta bloqueada temporalmente por intentos fallidos. Espera unos minutos.',
    'TOKEN_EXPIRADO': 'Tu sesión expiró. Vuelve a iniciar sesión.',
    'SESION_REVOCADA':
        'Tu sesión se cerró. Es posible que hayas iniciado sesión en otro lugar.',
    'CAMBIO_PASSWORD_REQUERIDO':
        'Debes cambiar tu contraseña antes de continuar.',
    'PASSWORD_DEBIL': 'La contraseña no cumple los requisitos de seguridad.',

    // --- Dispositivo -----------------------------------------------------
    'DISPOSITIVO_NO_AUTORIZADO':
        'Dispositivo no autorizado. Solicite autorización al administrador.',

    // --- Ubicacion -------------------------------------------------------
    'PERMISO_UBICACION_DENEGADO':
        'Necesitamos tu ubicación para verificar que estás en tu sede.',
    'PERMISO_UBICACION_PERMANENTE':
        'El permiso de ubicación está bloqueado. Habílitalo desde los ajustes del teléfono.',
    'GPS_APAGADO':
        'Activa la ubicación (GPS) de tu teléfono para poder marcar.',
    'GPS_IMPRECISO':
        'Tu ubicación no tiene suficiente precisión. Sal al exterior y vuelve a intentarlo.',
    'GPS_OBSOLETO':
        'La ubicación obtenida está desactualizada. Vuelve a intentarlo.',
    'GPS_SIN_LECTURA':
        'No se pudo obtener tu ubicación. Verifica que el GPS esté activo.',
    'UBICACION_SIMULADA':
        'Se detectó una ubicación simulada. Desactiva las aplicaciones de ubicación falsa e intenta nuevamente.',
    'FUERA_DE_GEOCERCA':
        'Debes estar dentro de tu sede para registrar asistencia.',

    // --- Camara ----------------------------------------------------------
    'PERMISO_CAMARA_DENEGADO':
        'Necesitamos la cámara para registrar la evidencia de tu asistencia.',
    'PERMISO_CAMARA_PERMANENTE':
        'El permiso de cámara está bloqueado. Habílitalo desde los ajustes del teléfono.',
    'CAMARA_NO_DISPONIBLE': 'No se pudo abrir la cámara de tu teléfono.',
    'CAMARA_CANCELADA':
        'No se tomó la fotografía. Es obligatoria para registrar tu asistencia.',
    'EVIDENCIA_REQUERIDA':
        'La fotografía es obligatoria para registrar tu asistencia.',
    'EVIDENCIA_INVALIDA': 'La fotografía no es válida. Vuelve a tomarla.',
    'EVIDENCIA_NO_ALMACENADA':
        'No se pudo guardar la fotografía. Intenta nuevamente.',

    // --- Reglas de marcacion ---------------------------------------------
    'SIN_HORARIO_HOY': 'Hoy no tienes una jornada programada.',
    'FUERA_DE_VENTANA': 'Aún no puedes marcar tu entrada.',
    'ENTRADA_DUPLICADA': 'Ya registraste tu entrada de hoy.',
    'SALIDA_DUPLICADA': 'Ya registraste tu salida de hoy.',
    'SALIDA_SIN_ENTRADA':
        'No puedes registrar salida porque no registraste tu entrada de hoy.',
    'SEDE_INACTIVA':
        'Tu sede está inactiva. Comunícate con el administrador.',

    // --- Generales -------------------------------------------------------
    'DEMASIADAS_SOLICITUDES':
        'Demasiados intentos seguidos. Espera un momento antes de reintentar.',
    'VALIDACION': 'Los datos enviados no son validos.',
    'NO_ENCONTRADO': 'No se encontro la información solicitada.',
    'PROHIBIDO': 'No tienes permisos para esta acción.',
    'ERROR_INTERNO':
        'Ocurrio un error inesperado. Si persiste, informa al administrador.',
  };

  /// Mensaje para mostrar. Si el servidor envio uno, se prefiere el suyo
  /// porque suele traer datos concretos (distancia, hora de apertura).
  static String mensaje(String code, {String? mensajeServidor}) {
    if (mensajeServidor != null && mensajeServidor.trim().isNotEmpty) {
      return mensajeServidor;
    }
    return _mensajes[code] ?? _mensajes['ERROR_INTERNO']!;
  }

  /// Indica si el error admite reintento inmediato con el mismo flujo.
  static bool esReintentable(String code) => const {
        'SIN_CONEXION',
        'TIEMPO_AGOTADO',
        'SERVIDOR_NO_DISPONIBLE',
        'GPS_IMPRECISO',
        'GPS_OBSOLETO',
        'GPS_SIN_LECTURA',
        'EVIDENCIA_NO_ALMACENADA',
        'ERROR_INTERNO',
      }.contains(code);

  /// Errores que obligan a cerrar la sesion local.
  static bool exigeReautenticacion(String code) => const {
        'TOKEN_EXPIRADO',
        'TOKEN_INVALIDO',
        'SESION_REVOCADA',
        'CUENTA_INACTIVA',
        'DISPOSITIVO_NO_AUTORIZADO',
      }.contains(code);

  /// Errores que se resuelven abriendo los ajustes del sistema.
  static bool abreAjustes(String code) => const {
        'PERMISO_UBICACION_PERMANENTE',
        'PERMISO_CAMARA_PERMANENTE',
        'GPS_APAGADO',
      }.contains(code);
}
