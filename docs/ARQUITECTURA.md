# Arquitectura y decisiones técnicas

Este documento recoge las decisiones que condicionan el resto del sistema y el
motivo de cada una. Donde hubo alternativas razonables, se indican.

---

## 1. Principio rector: el servidor decide

El cliente móvil es una interfaz, no una autoridad. Todo lo que determina si una
asistencia es válida se evalúa en el servidor:

| Dato | Quién lo calcula | Por qué |
|---|---|---|
| Hora de la marcación | Servidor (`new Date()`) | El reloj del teléfono es modificable por el usuario |
| Distancia a la sede | Servidor (haversine sobre las coordenadas recibidas) | La distancia que reporte el cliente no es verificable |
| Puntualidad / tardanza | Servidor, contra el horario vigente ese día | Depende de la hora oficial |
| Validez de la evidencia | Servidor (firma binaria + SHA-256 tras releer del disco) | El `content-type` que declara el cliente no prueba nada |

La hora del teléfono sí se guarda, pero solo como dato de auditoría: si difiere
del servidor más de lo tolerado, se levanta un evento de seguridad.

---

## 2. Base de datos: la integridad vive en PostgreSQL

**Decisión:** las reglas que no pueden violarse nunca están expresadas como
restricciones de base de datos, no solo como código.

**Motivo:** el código de aplicación se puede saltar (una consulta manual, un
script de migración, un error de concurrencia). Una restricción de base de datos
no.

| Regla de negocio | Mecanismo |
|---|---|
| Una jornada por persona y día | `UNIQUE(intern_id, business_date)` |
| Una entrada y una salida por jornada | `UNIQUE(attendance_day_id, type)` |
| No hay salida sin entrada | Trigger `fn_salida_exige_entrada` con `SELECT ... FOR UPDATE` |
| La foto pertenece a quien marca | Trigger `fn_evidencia_del_mismo_practicante` |
| La auditoría no se altera | Trigger `fn_auditoria_inmutable` sobre `UPDATE` y `DELETE` |
| Un solo dispositivo activo por usuario | Índice único parcial `WHERE status = 'ACTIVO'` |
| Una autorización de cambio vigente | Índice único parcial `WHERE consumed_at IS NULL AND cancelled_at IS NULL` |
| Coordenadas y radios válidos | `CHECK` sobre latitud, longitud y radio |
| Un día puntual no tiene minutos de tardanza | `CHECK (punctuality <> 'PUNTUAL' OR late_minutes = 0)` |
| Un día ausente no tiene puntualidad | `CHECK (status <> 'AUSENTE' OR punctuality IS NULL)` |

El bloqueo `FOR UPDATE` dentro del trigger de salida serializa las marcaciones
concurrentes de la misma jornada: elimina la condición de carrera sin recurrir a
un nivel de aislamiento serializable global, que penalizaría todas las demás
consultas.

### Modelo de asistencia

```
attendance_day  (una fila por practicante y día)
  ├── UNIQUE(intern_id, business_date)
  ├── copia inmutable del horario vigente ese día
  └── attendance_mark (0..2 filas: ENTRADA, SALIDA)
        ├── UNIQUE(attendance_day_id, type)
        ├── hora del servidor, coordenadas, precisión, distancia recalculada
        └── evidence_photo (1:1, con SHA-256)
```

Modelar el día como entidad propia, en vez de dejar solo marcaciones sueltas,
es lo que permite expresar "una entrada por día" como una restricción y no como
una consulta previa sujeta a carreras. También da un lugar natural donde guardar
lo que caracteriza al día completo: estado, puntualidad, salida pendiente,
horario que regía.

### La historia se preserva

Ningún cambio sobrescribe el pasado:

- **Horarios** — cambiar un horario cierra la vigencia anterior con
  `effective_to` y crea una fila nueva. La asistencia de marzo siempre se puede
  evaluar contra el horario que regía en marzo.
- **Dispositivos** — se revocan, no se borran. Queda quién lo revocó y por qué.
- **Regularizaciones** — guardan valor anterior, valor nuevo, autor y motivo.
- **Sedes y practicantes** — se desactivan, nunca se eliminan.
- **Evidencias** — se archivan y, solo tras verificar la copia remota, se libera
  el binario local. Los metadatos permanecen siempre.

Además, cada `attendance_day` guarda una **copia** de la hora programada de ese
día. Así un cambio posterior de horario no reescribe la interpretación de las
jornadas ya registradas.

---

## 3. Autenticación

| Elemento | Decisión | Alternativa descartada |
|---|---|---|
| Hash de contraseña | `scrypt` de `node:crypto`, N=32768, r=8, p=1 | argon2/bcrypt: requieren compilación nativa, que falla con frecuencia en Windows y añade fricción en Docker. scrypt es memory-hard, viene en el runtime y el formato almacenado incluye los parámetros, así que subirlos en el futuro no invalida los hashes existentes |
| Access token | JWT HS256, 15 minutos | Sesión en base en cada petición: más lento sin ganancia real, dado que igualmente se valida la sesión |
| Refresh token | Opaco de 48 bytes, guardado **solo como SHA-256**, rotación en cada uso | JWT de larga duración: no se puede revocar |
| Reutilización de refresh | Revoca **todas** las sesiones del usuario | Ignorarla: es la señal clásica de robo de token |
| Sesión única | Solo para practicantes | El administrador usa legítimamente panel web y móvil a la vez |

La comprobación de sesión contra la base en cada petición es lo que hace que
cerrar sesión, revocar un dispositivo o desactivar a alguien surta efecto **de
inmediato**, sin esperar a que caduque el JWT.

---

## 4. Identidad del dispositivo

**Decisión:** huella compuesta generada por la aplicación.

```
SHA-256( secreto_aleatorio_local ‖ ANDROID_ID ‖ modelo ‖ fabricante )
```

El secreto se genera en la primera ejecución y se guarda en el Android Keystore
(vía `flutter_secure_storage` con `EncryptedSharedPreferences`).

**Lo que se descartó y por qué:**

| Identificador | Por qué no |
|---|---|
| IMEI / número de serie | Android 10+ los bloquea para apps que no son del fabricante. Además su tratamiento sería desproporcionado para este fin |
| Solo `ANDROID_ID` | Se reinicia al restaurar de fábrica y puede repetirse entre perfiles del mismo teléfono |
| Publicidad (AAID) | El usuario puede restablecerlo cuando quiera |

**Consecuencias, que son las buscadas:**

- Sobrevive a actualizaciones de la aplicación y a reinicios.
- Cambia si se borran los datos de la app o se reinstala. En ese caso el
  administrador debe reautorizar — correcto, porque un borrado de datos es
  indistinguible de un teléfono nuevo.
- No expone ningún identificador de hardware al servidor.

Las copias de seguridad de Android están **desactivadas** (`allowBackup=false` y
reglas de extracción que excluyen todo): restaurar el secreto en otro teléfono
permitiría saltarse el control de dispositivo único.

**Ninguna huella generada en el cliente es infalsificable.** Por eso la defensa
es por capas: huella + sesión única + geocerca + evidencia fotográfica +
auditoría en el servidor.

---

## 5. Detección de ubicación simulada

Se usa `Position.isMocked` de `geolocator`, que refleja
`Location.isFromMockProvider()` de Android: la señal del **propio sistema
operativo** cuando la posición procede de un proveedor de ubicación simulada.

Se evalúa **antes** que cualquier criterio de calidad: una ubicación simulada es
un incidente de seguridad, no un problema de señal. No se reintenta, se rechaza
y se notifica de inmediato con severidad crítica.

**Esto no es infalible y el sistema no pretende que lo sea.** Un dispositivo con
root o un sistema modificado puede ocultar la marca. Las capas que complementan
esta detección:

1. Precisión GPS exigida (una ubicación falsa suele reportar precisión anómala).
2. Geocerca recalculada en servidor.
3. Evidencia fotográfica tomada en el momento.
4. Dispositivo único vinculado.
5. Auditoría completa que permite detectar patrones a posteriori.

---

## 6. Umbral de precisión GPS

```
precisión_máxima = min(techo_configurado, max(10, radio × 0.7))
```

Para un radio de 50 m y techo de 35 m, el límite es **35 m**.

**Motivo:** si la incertidumbre del GPS es comparable al radio de la geocerca,
"estar dentro" deja de ser verificable. Una lectura de ±80 m sobre una geocerca
de 50 m no distingue entre estar en la puerta y estar a una cuadra.

El suelo de 10 m evita que un radio muy pequeño vuelva imposible marcar.

La aplicación reintenta hasta tres veces con pausas breves antes de rendirse: el
receptor GPS suele mejorar en segundos, y rendirse al primer intento generaría
fricción innecesaria.

---

## 7. Evidencia fotográfica

| Aspecto | Decisión |
|---|---|
| Origen | Cámara, en el momento. **No existe ninguna ruta en la app que permita elegir de la galería**: no se usa `image_picker` ni ningún selector de archivos, y no se declaran permisos de lectura de almacenamiento |
| Cámara preferida | Frontal — la evidencia es de la persona, no del entorno |
| Compresión | En el cliente (calidad 78, máx. 1080×1440) para que funcione con datos móviles |
| Validación | El servidor inspecciona la **firma binaria** real, no el `content-type` declarado |
| Integridad | SHA-256 calculado **releyendo el archivo del disco** tras escribirlo |
| Almacenamiento | Sistema de archivos privado, particionado `sede/año/mes`, permisos `0600` |
| Acceso | Nunca por URL pública. Endpoint autenticado o enlace firmado (HMAC) de 10 minutos |
| Auditoría | **Cada lectura** de una evidencia queda registrada: es una lectura sensible |

Si la transacción de base de datos falla después de guardar la foto, el archivo
se borra: no quedan evidencias huérfanas. Esto se verifica en una prueba.

**Reconocimiento facial:** no se implementa. El modelo reserva `faceEmbedding` y
`faceEmbeddingModel` en `evidence_photo` para poder añadirlo después sin migrar
la estructura.

---

## 8. Notificaciones multicanal

```
notificación → SIEMPRE se persiste (canal interno)
            ├→ tiempo real (SSE) al panel abierto
            ├→ push (FCM)  si hay credenciales
            └→ correo      si hay credenciales y el evento es crítico
```

**Motivo:** el administrador no puede perder un aviso porque FCM estuviera caído
o sin configurar. El canal interno no depende de nadie. El resultado de cada
canal externo queda registrado en `notification_delivery`.

**SSE en lugar de WebSocket:** el flujo es unidireccional (servidor → panel),
atraviesa proxies sin configuración especial y el navegador reconecta solo. Un
WebSocket añadiría complejidad sin aportar nada aquí.

**FCM por REST en lugar de `firebase-admin`:** el SDK completo pesa decenas de
megabytes y aquí solo se necesita un endpoint. Se firma un JWT de cuenta de
servicio y se llama a la API HTTP v1.

---

## 9. Mapas: Leaflet + OpenStreetMap

**Decisión:** OpenStreetMap, sin clave de API.

**Motivo:** el sistema debe poder desplegarse sin depender de una cuenta
comercial ni de una facturación asociada. Google Maps exigiría una clave, una
tarjeta y gestión de cuotas para mostrar un círculo y dos marcadores.

Si la institución prefiere otro proveedor, basta cambiar `VITE_MAP_TILE_URL` (en
el panel) o `MAP_TILE_URL` (en la app). La clave queda en la configuración del
entorno, **nunca en el código ni en el APK**.

---

## 10. Reportes: ExcelJS y PDFKit

**PDFKit en lugar de renderizar HTML con navegador headless:** Puppeteer
arrastraría ~300 MB de Chromium al servidor y al contenedor para dibujar tablas.
PDFKit las dibuja directamente, sin dependencias del sistema.

Un único módulo (`report.data.ts`) decide **qué** datos lleva cada tipo de
reporte. Los generadores de Excel y PDF solo se ocupan del formato, de modo que
ambos muestran siempre exactamente la misma información.

---

## 11. Archivado: verificar antes de liberar

```
1. GENERANDO    Excel + PDF + metadata.json + fotografías
2. (integridad) SHA-256 de cada foto contra el registrado
3. SUBIENDO     ZIP a Asistencias/Sede/Año/Mes en Drive
4. VERIFICANDO  Relectura remota: existencia, tamaño y checksum MD5
5. COMPLETADO   Se guarda el id de Drive
6. LIBERADO     Solo ahora se borran los binarios locales
```

El paso 6 **exige** que el paso 4 haya confirmado. Sin Drive configurado, el
lote queda en `PENDIENTE` con el paquete verificado en disco. Los metadatos
nunca se borran, en ningún caso.

La cuenta de servicio de Drive se autentica con JWT, no con OAuth de usuario: el
proceso es desatendido y no debe depender de que alguien mantenga una sesión.

---

## 12. Tareas programadas

| Tarea | Frecuencia | Idempotencia |
|---|---|---|
| Cierre de jornada | Cada 15 min | `JobRun` con clave `(job, sede:fecha)` |
| Archivado por retención | Día 2 de cada mes, 03:00 | `UNIQUE(site_id, year, month)` en `archive_batch` |
| Limpieza de sesiones | Diaria, 03:30 | Operación naturalmente idempotente |

El cierre se ejecuta cada 15 minutos y comprueba **qué sedes ya alcanzaron su
hora local de cierre**. Con todas las sedes en una zona horaria bastaría una
ejecución diaria, pero esto deja el sistema preparado para sedes en zonas
distintas sin tocar código.

Con `ENABLE_CRON=false` el planificador no arranca: permite desplegar varias
réplicas de la API y dejar las tareas en una sola.

---

## 13. Fecha de negocio y zonas horarias

- En base de datos, todo instante se guarda en **UTC** (`timestamptz`).
- La **fecha de negocio** (a qué día laboral pertenece una marcación) se calcula
  en la zona horaria de la **sede**, no en la del servidor ni en la del teléfono.
- Cada sede tiene su propia `timezone` (`America/Lima` por defecto).

Esto evita el error clásico de que una marcación a las 23:50 quede asignada al
día siguiente porque el servidor está en otra zona.

---

## 14. Seguridad transversal

| Control | Implementación |
|---|---|
| Denegar por defecto | Ninguna ruta de negocio es pública; las excepciones (login, salud, privacidad) se declaran explícitamente |
| HTTPS | `cleartextTrafficPermitted=false` en Android; HSTS en producción; el arranque falla si `PUBLIC_BASE_URL` no es https |
| Limitación de tasa | Tres niveles: general, login (por IP **y** DNI) y marcación (por usuario) |
| Validación de entrada | Zod en todas las rutas; el error se traduce a una respuesta 422 uniforme |
| Secretos en logs | Redacción preventiva en el logger (`password`, tokens, claves privadas) |
| Bloqueo por fuerza bruta | 5 intentos, 15 minutos de bloqueo, evento de seguridad |
| Path traversal | La ruta de una evidencia se resuelve y se comprueba que sigue dentro de la raíz |
| Enumeración de usuarios | Misma respuesta y mismo mensaje para DNI inexistente y contraseña incorrecta |
| Auditoría de lecturas | Consultar una evidencia o generar un reporte queda registrado |

---

## 15. Lo que se dejó fuera, a propósito

| Descartado | Motivo |
|---|---|
| Reconocimiento facial | Fuera del alcance pedido. La estructura lo admite sin migrar |
| Modo sin conexión | Requisito explícito: una marcación sin verificación en servidor no tendría valor probatorio |
| Crear marcaciones desde el panel | Una marcación es evidencia (foto + GPS + dispositivo). Fabricarla destruiría el valor del sistema. Para un día sin marcación se usa `ESTADO_DIA` + motivo |
| Importación masiva de practicantes | Requisito explícito de esta versión |
| Microservicios | 60 usuarios y 30 sedes. Un monolito bien organizado es más fácil de operar y depurar |
| ORM sin migraciones versionadas | El esquema debe poder reconstruirse y auditarse |
