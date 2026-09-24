# Contrato de la API

Base: `/api/v1`

Todas las respuestas son JSON salvo las de descarga (reportes, imágenes).

---

## Autenticación

Cabecera en toda ruta protegida:

```
Authorization: Bearer <accessToken>
```

La aplicación móvil añade además, en cada petición:

```
x-device-id:        <huella del dispositivo>      (obligatoria para practicantes)
x-device-platform:  android
x-device-model:     Google Pixel 7
x-device-os:        Android 14 (API 34)
x-app-version:      1.0.0+1
```

El `accessToken` dura 15 minutos. El cliente lo renueva con `POST /auth/refresh`
usando el `refreshToken`, que **rota en cada uso**.

---

## Formato de error

Estable y uniforme en toda la API:

```json
{
  "error": {
    "code": "FUERA_DE_GEOCERCA",
    "message": "Debes estar dentro de tu sede para registrar asistencia. Estas a 187 m (maximo 50 m).",
    "meta": { "distanceMeters": 187.4, "radiusMeters": 50 },
    "requestId": "a3f1b2c4-..."
  }
}
```

El cliente reacciona al `code`, no al texto. El `message` es lo que se muestra
al usuario. `meta` trae datos concretos para guiar la acción.

### Códigos

| Código | HTTP | Significado |
|---|---|---|
| `CREDENCIALES_INVALIDAS` | 401 | DNI o contraseña incorrectos |
| `CUENTA_INACTIVA` | 401 | Cuenta, practicante o sede desactivados |
| `CUENTA_BLOQUEADA` | 401 | Bloqueo temporal por intentos fallidos |
| `TOKEN_EXPIRADO` | 401 | Access o refresh caducado |
| `TOKEN_INVALIDO` | 401 | Token malformado o manipulado |
| `SESION_REVOCADA` | 401 | Sesión cerrada, o reutilización de refresh detectada |
| `CAMBIO_PASSWORD_REQUERIDO` | 403 | Debe cambiar la contraseña inicial. Aplica a **todas** las rutas salvo `/auth/me`, `/auth/cambiar-password` y `/auth/logout`, también para administradores |
| `DISPOSITIVO_NO_AUTORIZADO` | 401 | El teléfono no es el vinculado |
| `PROHIBIDO` | 403 | Rol insuficiente |
| `SIN_HORARIO_HOY` | 409 | Sin jornada programada ese día |
| `FUERA_DE_VENTANA` | 409 | Aún no abre la ventana de entrada. `meta.opensAt` |
| `ENTRADA_DUPLICADA` | 409 | Ya existe entrada ese día |
| `SALIDA_DUPLICADA` | 409 | Ya existe salida ese día |
| `SALIDA_SIN_ENTRADA` | 409 | No hay entrada previa |
| `FUERA_DE_GEOCERCA` | 409 | `meta.distanceMeters`, `meta.radiusMeters` |
| `UBICACION_SIMULADA` | 409 | El sistema reportó la posición como simulada |
| `SEDE_INACTIVA` | 409 | La sede está desactivada |
| `GPS_IMPRECISO` | 422 | `meta.accuracyMeters`, `meta.maxAccuracyMeters` |
| `GPS_OBSOLETO` | 422 | Lectura demasiado antigua |
| `EVIDENCIA_REQUERIDA` | 422 | Falta la fotografía |
| `EVIDENCIA_INVALIDA` | 422 | No es imagen, formato no permitido o resolución baja |
| `EVIDENCIA_NO_ALMACENADA` | 500 | Fallo al guardar el binario |
| `VALIDACION` | 422 | Entrada inválida. `details` lista campo y problema |
| `NO_ENCONTRADO` | 404 | |
| `CONFLICTO` | 409 | |
| `DEMASIADAS_SOLICITUDES` | 429 | Límite de tasa |
| `DEPENDENCIA_EXTERNA` | 502 | Base de datos o servicio externo no disponible |
| `ERROR_INTERNO` | 500 | |

---

## Rutas públicas

### `GET /salud`

```json
{
  "estado": "operativo",
  "servicio": "Control de Asistencia",
  "version": "1.0.0",
  "baseDatos": "ok",
  "horaServidor": "2026-09-18T13:00:00.000Z",
  "zonaHoraria": "America/Lima"
}
```

Devuelve 503 si la base no responde. Es el endpoint del healthcheck de Docker.

### `GET /privacidad`

Política de privacidad vigente. Pública a propósito: debe poder leerse **antes**
de aceptarla.

---

## Autenticación — `/auth`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/auth/login` | — | DNI + contraseña. El practicante debe enviar cabeceras `x-device-*` |
| POST | `/auth/refresh` | — | Rota el refresh token |
| POST | `/auth/logout` | cualquiera | Revoca la sesión actual |
| GET | `/auth/me` | cualquiera | Usuario, sede y hora del servidor |
| POST | `/auth/cambiar-password` | cualquiera | Cierra todas las sesiones |
| POST | `/auth/consentimiento` | practicante | Registra la aceptación con versión |
| GET | `/auth/dispositivo` | cualquiera | Estado del teléfono vinculado |
| POST | `/auth/push-token` | cualquiera | Registra token de notificaciones |
| DELETE | `/auth/push-token` | cualquiera | Lo revoca |

<details>
<summary><code>POST /auth/login</code> — respuesta</summary>

```json
{
  "user": {
    "id": "uuid", "dni": "40000001", "role": "PRACTICANTE",
    "displayName": "Ana Quispe", "mustChangePassword": false,
    "intern": {
      "id": "uuid", "firstNames": "Ana", "lastNames": "Quispe Mamani",
      "areaGroup": "Aula A", "consentAccepted": true,
      "site": {
        "id": "uuid", "code": "SEDE-01", "name": "Sede Central",
        "latitude": -12.046374, "longitude": -77.042793,
        "radiusMeters": 50, "timezone": "America/Lima"
      }
    }
  },
  "tokens": {
    "accessToken": "eyJ...", "refreshToken": "xK9...",
    "accessTokenExpiresAt": "2026-09-18T13:15:00.000Z",
    "refreshTokenExpiresAt": "2026-10-18T13:00:00.000Z"
  },
  "device": { "bound": true, "firstBinding": false, "rebound": false },
  "privacyPolicyVersion": "1.0"
}
```
</details>

---

## Asistencia — `/asistencia`

### Practicante

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/asistencia/hoy` | Estado del día y qué puede hacer ahora |
| POST | `/asistencia/entrada` | Registra entrada (multipart) |
| POST | `/asistencia/salida` | Registra salida (multipart) |
| POST | `/asistencia/incidente` | Informa un intento que la app detuvo antes de enviar |
| GET | `/asistencia/mi-historial` | `?from=&to=` con resumen del periodo |

### `POST /asistencia/entrada` · `POST /asistencia/salida`

`Content-Type: multipart/form-data`

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `foto` | archivo | Sí | JPEG/PNG/WebP, máx. 5 MB, mín. 240×240 |
| `latitude` | número | Sí | −90 a 90 |
| `longitude` | número | Sí | −180 a 180 |
| `accuracyMeters` | número | Sí | Precisión reportada por el GPS |
| `mockLocationReported` | booleano | Sí | `Position.isMocked` de Android |
| `locationAgeMs` | entero | No | Antigüedad de la lectura |
| `altitude`, `speed` | número | No | Solo auditoría |
| `deviceTime` | ISO-8601 | No | Reloj del teléfono, solo auditoría |
| `idempotencyKey` | texto | Recomendado | También admitido como cabecera `Idempotency-Key` |

Respuesta `201`:

```json
{
  "markId": "uuid", "attendanceDayId": "uuid", "type": "ENTRADA",
  "businessDate": "2026-09-18", "serverTime": "2026-09-18T13:00:00.000Z",
  "localTime": "08:00", "punctuality": "PUNTUAL", "lateMinutes": 0,
  "distanceMeters": 8.42, "accuracyMeters": 6.1,
  "scheduledStartTime": "08:00", "evidenceId": "uuid",
  "deduplicated": false
}
```

`deduplicated: true` indica que la petición se resolvió devolviendo una
marcación existente: el reintento no creó un registro nuevo.

### `GET /asistencia/hoy`

```json
{
  "businessDate": "2026-09-18",
  "serverTime": "2026-09-18T12:40:00.000Z",
  "localTime": "07:40:00",
  "site": { "id": "uuid", "name": "Sede Central", "radiusMeters": 50, "...": "" },
  "schedule": { "startTime": "08:00", "endTime": "17:00", "hasSchedule": true },
  "checkIn": null,
  "checkOut": null,
  "status": "PROGRAMADO",
  "punctuality": null,
  "lateMinutes": 0,
  "pendingExit": false,
  "actions": {
    "canCheckIn": false,
    "canCheckOut": false,
    "checkInOpensAt": "07:45",
    "reason": "Podra marcar entrada a partir de las 07:45."
  },
  "gpsRequirements": { "maxAccuracyMeters": 35, "maxAgeSeconds": 60 }
}
```

La aplicación no decide si se puede marcar: presenta `actions` y su `reason`.

> **Dispositivo no vinculado.** Las tres rutas exigen el teléfono vinculado a la
> sesión. Si llega un token válido desde otro teléfono —la señal de una
> credencial robada— la respuesta es `401 DISPOSITIVO_NO_AUTORIZADO` y además se
> registra un evento de seguridad **crítico** con aviso inmediato al
> administrador. El límite de tasa se evalúa antes que esa comprobación, así que
> un cliente insistente no puede inundar la bitácora.

### `POST /asistencia/incidente`

La aplicación corta ciertos intentos en el teléfono, antes de enviar nada. Sin
este aviso el servidor nunca se enteraría de que alguien intentó marcar con
ubicación falsa o desde otro lugar, que es justo lo que hay que vigilar.

```json
{
  "tipo": "UBICACION_SIMULADA | GPS_IMPRECISO | FUERA_DE_GEOCERCA",
  "tipoMarcacion": "ENTRADA | SALIDA",
  "latitude": -12.062085,
  "longitude": -75.211988,
  "accuracyMeters": 200,
  "distanceMeters": 2081,
  "intentos": 3,
  "detalle": "texto libre, opcional"
}
```

Responde **202** sin cuerpo útil. Exige el dispositivo vinculado. Registra un
evento de seguridad (`CRITICO` y con aviso inmediato si es ubicación simulada,
`ADVERTENCIA` fuera de geocerca, `INFO` si es precisión insuficiente) y lo
audita como `MARCACION_RECHAZADA`. **Nunca crea asistencia.**

Tiene su propio límite de tasa, separado del de marcación: avisar de muchos
intentos fallidos no puede dejar a nadie sin cupo para marcar cuando por fin
consigue una lectura buena.

La **distancia la recalcula el servidor** con las coordenadas recibidas y la
sede del practicante. Lo que informa el teléfono se conserva aparte, en
`details.distanciaInformadaPorElTelefono`, para poder comparar.

---

### Administrador

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/asistencia/tablero` | `?date=&siteId=` Totales globales y por sede |
| GET | `/asistencia` | `?from=&to=&siteId=&internId=&status=&punctuality=&pendingExitOnly=` |
| GET | `/asistencia/:id` | Detalle con datos de mapa y URLs firmadas de las fotos |
| POST | `/asistencia/:id/regularizar` | `{ field, newValue, reason }` — motivo ≥ 10 caracteres |
| GET | `/asistencia/regularizaciones/listado` | |
| POST | `/asistencia/cerrar-jornada` | `{ siteId, date, force? }` Ejecución manual |

Campos regularizables: `ENTRADA_HORA`, `SALIDA_HORA`, `PUNTUALIDAD`,
`ESTADO_DIA`, `JUSTIFICACION`.

---

## Sedes — `/sedes`

| Método | Ruta | Rol |
|---|---|---|
| GET | `/sedes` | cualquiera |
| GET | `/sedes/:id` | cualquiera |
| GET | `/sedes/:id/tablero` | admin |
| POST | `/sedes` | admin |
| PATCH | `/sedes/:id` | admin |
| DELETE | `/sedes/:id` | admin — **desactiva**, no elimina |

No se puede desactivar una sede con practicantes activos: hay que reasignarlos
primero.

---

## Practicantes — `/practicantes` (admin)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/practicantes` | `?siteId=&search=&includeInactive=` |
| POST | `/practicantes` | Alta. Devuelve `temporaryPassword` **una sola vez** |
| GET | `/practicantes/:id` | |
| GET | `/practicantes/:id/ficha` | `?from=&to=` Datos + indicadores + historial + alertas |
| PATCH | `/practicantes/:id` | |
| DELETE | `/practicantes/:id` | Desactiva |
| GET | `/practicantes/:id/horario` | Vigente e historial completo |
| PUT | `/practicantes/:id/horario` | `{ effectiveFrom, slots[] }` Nueva vigencia |
| GET | `/practicantes/:id/dispositivos` | |
| DELETE | `/practicantes/:id/dispositivos/:bindingId` | `{ reason }` Desvincula |
| POST | `/practicantes/:id/dispositivos/autorizar-cambio` | `{ reason }` Permiso de un solo uso, 48 h |
| POST | `/practicantes/:id/restablecer-password` | Devuelve contraseña temporal |

---

## Seguridad y auditoría — `/seguridad` (admin)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/seguridad/eventos` | `?from=&to=&siteId=&internId=&type=&severity=&onlyPending=` |
| GET | `/seguridad/resumen` | Conteo por tipo y severidad |
| POST | `/seguridad/eventos/:id/atender` | `{ note? }` |
| GET | `/seguridad/auditoria` | `?entityType=&entityId=&actorUserId=&action=&from=&to=` |

---

## Evidencias — `/evidencias`

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/evidencias/:id` | Metadatos: hash, tamaño, origen, estado de archivado |
| GET | `/evidencias/:id/url-firmada` | Enlace HMAC de 10 minutos |
| GET | `/evidencias/:id/imagen` | Binario. Acepta Bearer **o** firma |
| GET | `/evidencias/:id/descargar` | Con `Content-Disposition` |

Cabeceras de respuesta de la imagen:

```
x-evidence-sha256:     <hash calculado al leer>
x-evidence-integrity:  ok | alterada
```

Un practicante solo accede a sus propias evidencias. **Toda lectura se audita.**

---

## Reportes — `/reportes` (admin)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/reportes/tipos` | Catálogo de tipos y formatos |
| GET | `/reportes/vista-previa` | Mismos datos en JSON, máx. 500 filas |
| GET | `/reportes/generar` | Descarga el archivo |

Parámetros: `tipo`, `formato` (`excel` \| `pdf`), `from`, `to`, `siteId?`,
`internId?`.

Tipos: `diario`, `semanal`, `mensual`, `rango`, `practicante`, `sede`,
`consolidado`, `puntualidad`, `tardanzas`, `faltas`, `entradas`, `salidas`,
`pendientes`, `incidencias`.

Generar un reporte se audita: es una lectura masiva de datos personales.

---

## Archivado — `/archivado` (admin)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/archivado` | Lotes, retención configurada y estado de Drive |
| GET | `/archivado/drive/estado` | Diagnóstico: indica exactamente qué variables faltan |
| GET | `/archivado/integridad` | `?from=&to=&siteId=` Verifica hashes sin archivar |
| POST | `/archivado/ejecutar` | `{ siteId?, year, month, release? }` |
| POST | `/archivado/retencion` | Barrido manual de retención |
| GET | `/archivado/:batchId` | Detalle de un lote |

`release: true` solo libera el almacenamiento local **si** la verificación
remota fue satisfactoria.

---

## Notificaciones — `/notificaciones`

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/notificaciones` | `?onlyUnread=` |
| POST | `/notificaciones/:id/leida` | |
| POST | `/notificaciones/leer-todas` | |
| GET | `/notificaciones/stream` | **SSE.** `?token=<accessToken>` |

El canal SSE emite `notificacion`, `asistencia`, `evento-seguridad` y `ping`.
El token viaja por query string porque `EventSource` no admite cabeceras; la
conexión no transporta datos de negocio en la URL y el token es de vida corta.

---

## Parámetros — `/parametros` (admin)

| Método | Ruta |
|---|---|
| GET | `/parametros` |
| PATCH | `/parametros` |

| Parámetro | Rango | Por defecto |
|---|---|---|
| `checkinEarlyWindowMinutes` | 0–180 | 15 |
| `gpsMaxAccuracyMeters` | 5–200 | 35 |
| `gpsMaxAgeSeconds` | 5–600 | 60 |
| `defaultSiteRadiusMeters` | 10–2000 | 50 |
| `maxDeviceClockSkewSeconds` | 30–3600 | 300 |
| `retentionMonths` | 1–120 | 6 |
| `dayCloseLocalTime` | HH:mm | 23:30 |
| `privacyPolicyVersion` | texto | 1.0 |

Un valor fuera de rango se rechaza con 422: estos parámetros gobiernan reglas de
negocio reales y un valor absurdo dejaría el sistema inoperable.

---

## Rangos de fecha

Los parámetros `from` y `to` son fechas de calendario (`YYYY-MM-DD`), **no**
instantes, y se interpretan en la zona horaria de la institución
(`APP_TIMEZONE`; la de la sede, en el archivado). `from=2026-09-22&to=2026-09-22`
cubre de las 00:00:00 a las 23:59:59.999 de ese día en esa zona.

Esto importa: interpretarlas en UTC dejaría fuera todo lo ocurrido después de
las 19:00 hora de Lima, que es cuando más incidentes hay.

---

## Límites de tasa

| Ámbito | Ventana | Límite | Clave |
|---|---|---|---|
| General | 1 min | 300 | IP |
| Login | 15 min | 10 | IP + DNI |
| Marcación | 5 min | 20 | Usuario |
| Avisos de intento rechazado | 5 min | 40 | Usuario |
| Reportes | 1 min | 20 | Usuario |

El login se limita por IP **y** DNI para no castigar a toda una oficina por un
solo atacante.
