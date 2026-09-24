# Limitaciones conocidas

Lo que el sistema no hace, no garantiza o no se pudo verificar. Se documenta
para que nadie lo descubra en producción.

---

## 1. No verificado en este entorno

### El APK compila y se probó en un teléfono real

Con el Android SDK instalado se compilaron **debug** (161 MB) y **release**
(55,8 MB, con R8 y ofuscación). Hizo falta resolver cinco problemas de
configuración, todos documentados en [DESPLIEGUE.md](DESPLIEGUE.md) §10: el NDK
que exige Flutter, la compilación incremental de Kotlin entre unidades distintas,
la memoria de Gradle, el `jvmTarget` con JDK 25 y las reglas de R8 para Play Core.

El release se inspeccionó con `aapt`: paquete, `minSdk` 24, `targetSdk` 36 y
**solo** los permisos declarados. Los plugins añadían `RECORD_AUDIO` y acceso al
almacenamiento externo; se eliminan en el manifiesto porque contradecían la
política de privacidad.

**Pendiente:** firmar con una clave propia (`android/key.properties`). Sin ella
el release queda firmado con la clave de depuración y no sirve para distribuir.

### Probado en un teléfono, con dos salvedades

El 21 de septiembre de 2026 se ejecutó el ciclo completo en un motorola moto
g85 5G: contraseña temporal, cambio obligatorio, lectura de GPS, mapa, cámara,
entrada **PUNTUAL** a las 17:58 contra las 17:59 programadas, salida a las 18:00,
evidencias con su SHA-256 verificado y bitácora completa. El detalle está en
[PRUEBAS.md](PRUEBAS.md).

Queda sin ejercitar en hardware:

- **`isMocked` con una aplicación de ubicación falsa instalada.** La ruta que
  atiende el aviso del teléfono sí se probó: el servidor registró el evento y
  avisó al administrador.
- **Una fijación GPS fina.** El teléfono estaba dentro de un edificio y solo
  conseguía 200 m de precisión por red. El sistema la rechaza con los valores
  por defecto —eso se verificó— así que la marcación de prueba se completó con
  los parámetros subidos temporalmente a 200 m y radio 400 m, y devueltos
  después a 35 m y 50 m.

### Integraciones externas

**Google Drive: probado contra el servicio real** el 24 de septiembre de 2026.
Se archivó un periodo completo, se subió el paquete y se verificó de forma
independiente que lo almacenado en Drive coincide con lo generado (559 284
bytes, mismo MD5). Probarlo destapó dos cosas que ninguna prueba automatizada
podía detectar:

- El cliente pedía el permiso `drive.file`, que solo alcanza a los archivos que
  crea la propia aplicación: una carpeta compartida con la cuenta respondía
  *File not found* aunque los permisos fueran correctos. Corregido a `drive`.
- Una cuenta de servicio tiene **cuota cero**. En una carpeta de «Mi unidad»,
  Google rechaza la subida con *Service Accounts do not have storage quota*
  aunque el permiso esté bien. Por eso el servidor admite además autorizar con
  una cuenta de usuario (ver [DESPLIEGUE.md](DESPLIEGUE.md) §6).

Cuando la subida falló, el sistema se comportó como debía: generó el paquete,
verificó su integridad, marcó el lote como `FALLIDO` y **no liberó ni borró
nada**.

**Firebase y SMTP** siguen implementados pero sin ejercitar contra los servicios
reales. El sistema funciona sin ellos y lo indica claramente.

---

## 2. Notificaciones push: falta el receptor en la app

**Qué está hecho:**

- El backend envía push por FCM HTTP v1, con prioridad alta para lo crítico,
  registra el resultado de cada envío y purga tokens inválidos.
- La API expone `POST /auth/push-token` para registrar el token del teléfono.
- El manifiesto de Android declara `POST_NOTIFICATIONS`.

**Qué falta:** los paquetes `firebase_core` y `firebase_messaging` en la app
móvil. No se añadieron porque el plugin de Gradle de Google Services **exige**
el archivo `google-services.json` para compilar: incluirlo sin ese archivo
rompería la compilación del APK para cualquiera que no tenga el proyecto de
Firebase creado.

**Consecuencia hoy:** las alertas llegan dentro de la aplicación (pantalla de
notificaciones, con contador) y en tiempo real al panel web, pero el teléfono no
muestra un aviso del sistema con la app cerrada.

**Cómo completarlo** (una vez creado el proyecto Firebase):

```bash
cd mobile
flutter pub add firebase_core firebase_messaging
# copiar google-services.json a android/app/
```

Y en `main.dart`, tras `Firebase.initializeApp()`, obtener el token con
`FirebaseMessaging.instance.getToken()` y enviarlo con
`NotificationService.registrarTokenPush()`, que ya existe.

---

## 3. Detección de ubicación simulada: no es infalible

Se usa la señal del sistema operativo (`Location.isFromMockProvider()` vía
`geolocator`). Detecta las aplicaciones de ubicación falsa que usan el mecanismo
estándar de Android.

**No detecta:**

- Teléfonos con root y módulos que ocultan la marca (Magisk, LSPosed).
- Emuladores configurados para simular un GPS físico.
- Hardware GPS externo manipulado.

**Mitigaciones que sí existen:** precisión GPS exigida, geocerca recalculada en
servidor, fotografía tomada en el momento, dispositivo único y auditoría
completa que permite detectar patrones a posteriori (mismas coordenadas exactas
día tras día, precisión sospechosamente perfecta).

**No implementado y posible en el futuro:** Play Integrity API, que certifica
en el servidor que la app corre sin modificar en un dispositivo legítimo.
Requiere publicar en Google Play y una cuenta de Google Cloud.

---

## 4. Huella de dispositivo: no es infalsificable

La huella se genera en el teléfono y el servidor la trata como un dato opaco.
Alguien con acceso técnico al teléfono vinculado podría extraerla. Por eso no es
la única barrera: requiere además las credenciales, la sesión única, estar en la
sede y la fotografía.

Borrar los datos de la app o reinstalarla cambia la huella: el practicante
necesitará que el administrador autorice el "nuevo" teléfono. Es intencional.

---

## 5. Fotografía: evidencia, no identificación

- **No hay reconocimiento facial**, por decisión de alcance. Una foto de otra
  persona se aceptaría; la detección depende de la revisión humana.
- El modelo reserva `faceEmbedding` y `faceEmbeddingModel` para añadirlo sin
  migrar.
- Se impide elegir una imagen de la galería (no hay ninguna ruta en la app que
  lo permita y no se declaran permisos de lectura de almacenamiento). No se
  puede impedir que alguien fotografíe con la cámara una foto impresa o una
  pantalla.

---

## 6. Hora oficial

La hora de la marcación es la del **servidor**. Si el reloj del servidor se
desajusta, todas las marcaciones se desplazan. En producción el servidor debe
sincronizar hora (NTP); en Ubuntu viene activo por defecto con
`systemd-timesyncd`.

---

## 7. Mapas

OpenStreetMap tiene una política de uso justo para sus teselas. Con 60 usuarios
y un panel administrativo el consumo es mínimo, pero si el uso crece mucho
conviene un proveedor de teselas propio o comercial (`VITE_MAP_TILE_URL`,
`MAP_TILE_URL`).

---

## 8. Escala

Dimensionado para decenas de sedes y cientos de practicantes. Algunas decisiones
dejarían de ser óptimas con miles:

| Componente | Límite práctico | Qué cambiar al superarlo |
|---|---|---|
| Fotos en disco local | Decenas de miles | Mover a almacenamiento de objetos (S3 o compatible). La interfaz ya está aislada en `evidence-storage.ts` |
| Canal SSE en memoria | Una instancia de API | Con varias réplicas, publicar eventos por Redis pub/sub |
| Tablero calculado al vuelo | Cientos de practicantes | Vista materializada o agregados diarios |
| Tareas programadas en el proceso | Una instancia | `ENABLE_CRON=false` en todas menos una, o un planificador externo |

---

## 9. Idioma y zona horaria

La interfaz está solo en español. Cada sede tiene su propia zona horaria, pero la
interfaz asume que el administrador y las sedes comparten la misma región para
mostrar fechas.

---

## 10. Lo que se dejó fuera por decisión explícita

Reconocimiento facial, varias sedes por practicante, asistencia sin conexión,
más de una entrada o salida por día, roles distintos de ADMINISTRADOR y
PRACTICANTE, importación masiva desde Excel y módulos académicos o de ERP.
