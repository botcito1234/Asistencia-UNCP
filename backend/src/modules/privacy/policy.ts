/**
 * Politica de privacidad y consentimiento informado.
 *
 * Se sirve desde el servidor (no embebida en el APK) para poder actualizarla
 * sin publicar una nueva version de la aplicacion. El practicante debe aceptar
 * la version vigente antes de poder marcar asistencia, y su aceptacion queda
 * registrada con fecha y version.
 */
import { config } from '../../config/env.js';

export const PRIVACY_POLICY = {
  version: config.PRIVACY_POLICY_VERSION,
  actualizada: '2026-01-01',
  titulo: 'Política de privacidad y tratamiento de datos - Control de asistencia',
  responsable: config.APP_NAME,
  resumen:
    'Esta aplicación registra su asistencia laboral. Para hacerlo necesita su ubicación y una fotografía ' +
    'en el momento de marcar. Solo se usan con ese fin.',
  secciones: [
    {
      titulo: 'Que datos se tratan',
      contenido: [
        'Datos de identificación: DNI, nombres, apellidos, sede y área asignada.',
        'Datos de contacto: teléfono y correo, cuando usted los proporciona.',
        'Datos de ubicación: latitud, longitud y precisión, unicamente en el instante de cada marcación.',
        'Fotografía de evidencia: una imagen capturada con la cámara en cada entrada y cada salida.',
        'Datos técnicos del dispositivo: identificador interno de la aplicación, modelo, versión del sistema y versión de la aplicación.',
        'Registros de acceso: fecha, hora y dirección IP de sus inicios de sesión.',
      ],
    },
    {
      titulo: 'Para que se usan',
      contenido: [
        'Verificar que la marcación se realiza dentro de la sede asignada.',
        'Determinar puntualidad, tardanza, falta y salida pendiente.',
        'Acreditar que la marcación la hizo usted y no otra persona.',
        'Detectar y documentar intentos de manipulacion del registro.',
        'Elaborar los reportes de asistencia de la institucion.',
      ],
    },
    {
      titulo: 'Uso del GPS',
      contenido: [
        'La ubicación se lee UNICAMENTE cuando usted pulsa el boton de marcar entrada o salida.',
        'La aplicación NO realiza seguimiento continuo ni en segundo plano.',
        'No se registra su ubicación fuera del acto de marcar.',
        'Si la precisión de la lectura es insuficiente, la marcación se rechaza y se le pide repetirla.',
      ],
    },
    {
      titulo: 'Uso de la cámara',
      contenido: [
        'La fotografía se captura en el momento, desde la cámara. No se puede elegir una imagen de la galeria.',
        'Se toma exclusivamente al marcar entrada o salida.',
        'No se aplica reconocimiento facial ni ningún tratamiento biometrico.',
        'La imagen se guarda cifrada en transito y en almacenamiento privado del servidor.',
      ],
    },
    {
      titulo: 'Un solo dispositivo',
      contenido: [
        'Su cuenta queda vinculada al primer teléfono con el que inicia sesión.',
        'No se recogen identificadores de hardware como IMEI o número de serie.',
        'El identificador que se usa lo genera la propia aplicación y solo sirve para reconocer su teléfono.',
        'Para cambiar de teléfono debe solicitarlo al administrador.',
      ],
    },
    {
      titulo: 'Conservacion',
      contenido: [
        'La información permanece disponible en el sistema durante ' + config.RETENTION_MONTHS + ' meses.',
        'Después se archiva de forma automática en un repositorio histórico controlado por la institucion.',
        'Antes de liberar espacio se verifica que la copia histórica se guardó íntegra.',
        'Los registros de asistencia no se eliminan: son evidencia laboral.',
      ],
    },
    {
      titulo: 'Quien accede',
      contenido: [
        'Usted: a sus propios registros, fotografías e historial.',
        'Los administradores del sistema: a los registros de todas las sedes, por su funcion de supervision.',
        'Toda consulta de una fotografía queda registrada en la bitacora de auditoria, con quien la vio y cuando.',
        'No se comparten datos con terceros ni se usan con fines comerciales.',
      ],
    },
    {
      titulo: 'Minimizacion',
      contenido: [
        'Solo se recoge lo necesario para acreditar la asistencia.',
        'No se accede a contactos, mensajes, archivos, historial de navegacion ni otras aplicaciones.',
        'No se activa el microfono.',
        'La ubicación no se consulta salvo en el acto de marcar.',
      ],
    },
    {
      titulo: 'Sus derechos',
      contenido: [
        'Acceder a sus datos y a sus evidencias desde la propia aplicación.',
        'Solicitar la rectificacion de un registro erroneo; el administrador puede regularizarlo dejando constancia del valor anterior, del nuevo y del motivo.',
        'Solicitar información sobre quien ha consultado sus evidencias.',
        'Retirar su consentimiento, entendiendo que sin el no es posible registrar asistencia por este medio.',
      ],
    },
    {
      titulo: 'Seguridad',
      contenido: [
        'Las comunicaciones viajan cifradas mediante HTTPS.',
        'Las contraseñas se almacenan con una funcion de derivacion resistente a ataques por fuerza bruta; nunca en texto plano.',
        'Cada fotografía tiene un código de verificación (SHA-256) que permite detectar cualquier alteracion posterior.',
        'El acceso a las evidencias exige autenticacion y queda auditado.',
      ],
    },
  ],
  consentimiento:
    'Al aceptar, usted autoriza el tratamiento de su ubicación y de su fotografía en el momento de cada ' +
    'marcación, con la finalidad exclusiva de registrar y acreditar su asistencia, en los terminos descritos.',
};

export type PrivacyPolicy = typeof PRIVACY_POLICY;
