# Pruebas

## Cómo se ejecutan

```bash
cd backend && npm test          # 151 pruebas, PostgreSQL real y efímero
cd mobile  && flutter test      # 24 pruebas
cd mobile  && flutter analyze   # análisis estático
cd backend && npm run typecheck
cd web-admin && npm run typecheck && npm run build
```

### Por qué PostgreSQL real

El arnés (`backend/src/tests/global-setup.ts`) levanta un PostgreSQL de verdad,
descartable, en un puerto libre, aplica las **mismas migraciones** que
producción y lo destruye al terminar.

Buena parte de las reglas críticas viven en la base de datos: las restricciones
únicas que impiden la doble entrada, el trigger que exige entrada antes de
salida, los `CHECK` de coordenadas, la inmutabilidad de la auditoría. Probarlas
contra un simulador no demostraría nada.

### Por qué la suite no depende de la hora

Muchas pruebas construyen horarios relativos a "ahora" (entrada programada hace
30 minutos, dentro de 40...). Si la suite corriera de madrugada, esos cálculos
cruzarían la medianoche y fallarían por la hora del reloj, no por un defecto.
El arnés elige una zona horaria en la que *ahora mismo* sea media jornada
(09:00–18:00), sin falsear el reloj del sistema. Esto se descubrió porque una
prueba falló realmente al ejecutarse cerca de medianoche en Lima.

---

## Los 26 casos exigidos

| # | Caso | Dónde | Qué se verifica |
|---|---|---|---|
| 1 | Entrada puntual | `attendance.test.ts` | 201, `PUNTUAL`, jornada `PRESENTE`, evidencia con SHA-256, auditoría, notificación |
| 2 | Entrada 15 min antes | `attendance.test.ts` · `attendance-rules.test.ts` | Límite inclusivo aceptado como `PUNTUAL` |
| 3 | Demasiado temprano | `attendance.test.ts` · `attendance-rules.test.ts` | 409 `FUERA_DE_VENTANA` con `opensAt`; evento de seguridad; **cero** filas de asistencia |
| 4 | Entrada tardía | `attendance.test.ts` · `attendance-rules.test.ts` | `TARDANZA` con minutos; 08:01 ya es tardanza; 5 h tarde sigue permitido |
| 5 | Fuera de geocerca | `attendance.test.ts` | 409 a 200 m; evento con distancia; notificación inmediata |
| 6 | Límite cercano a 50 m | `attendance.test.ts` · `geo.test.ts` | 45 m aceptado, 55 m rechazado; 49,5 / 50,6 en la función pura; radio ampliado respetado |
| 7 | GPS impreciso | `attendance.test.ts` · `attendance-rules.test.ts` | 80 m rechazado, 35 m aceptado, lectura antigua rechazada |
| 8 | Ubicación simulada | `attendance.test.ts` · `attendance-rules.test.ts` | Rechazo crítico; prevalece sobre cualquier otra validación |
| 9 | Cámara cancelada | `attendance.test.ts` | Sin foto → 422; archivo que no es imagen → 422; imagen de 100×100 → 422 |
| 10 | Sin Internet | `widget_test.dart` · `api_client.dart` | El cliente corta **antes** de enviar con `SIN_CONEXION`; no existe cola offline. Mensaje y barra de aviso verificados |
| 11 | Dispositivo incorrecto | `attendance.test.ts` · `auth.test.ts` | Login y marcación rechazados desde otro teléfono; evento crítico con huella enmascarada |
| 12 | Sesión simultánea | `auth.test.ts` | La sesión nueva invalida la anterior; queda constancia; el administrador sí puede tener varias |
| 13 | Entrada duplicada | `attendance.test.ts` | 409 `ENTRADA_DUPLICADA`; misma clave de idempotencia devuelve la marcación existente |
| 14 | Salida | `attendance.test.ts` | Registrada; la jornada deja de estar pendiente; sin permanencia mínima |
| 15 | Salida sin entrada | `attendance.test.ts` | 409 por la API **y** el trigger rechaza la inserción directa en la base |
| 16 | Salida duplicada | `attendance.test.ts` | 409 `SALIDA_DUPLICADA`; una sola fila |
| 17 | Salida fuera de sede | `attendance.test.ts` | 409; la jornada sigue con salida pendiente |
| 18 | Falta de salida | `closure.test.ts` | El cierre marca salida pendiente, crea alerta y aparece en el tablero |
| 19 | Regularización | `closure.test.ts` | Motivo obligatorio; conserva valor anterior, autor y motivo; recalcula puntualidad; no fabrica marcaciones; auditoría inmutable |
| 20 | Archivado | `reports-archive.test.ts` | Paquete con Excel, PDF, metadata y fotos; integridad verificada; lote consultable |
| 21 | Fallo de Drive | `reports-archive.test.ts` | Sin credenciales queda `PENDIENTE`; **no libera nada** aunque se pida; el diagnóstico nombra las variables que faltan |
| 22 | Excel | `reports-archive.test.ts` | Archivo xlsx válido (firma ZIP); los 14 tipos generan; contiene los datos; queda auditado |
| 23 | PDF | `reports-archive.test.ts` | Firma `%PDF-` y `EOF`; vacío también se genera; 60 filas paginan en varias hojas |
| 24 | Concurrencia | `attendance.test.ts` | 2 y 5 entradas simultáneas → exactamente una; sin evidencias huérfanas |
| 25 | Reinicio de la app | `auth.test.ts` | El refresh token recupera la sesión; la reutilización de un refresh viejo revoca todo; refresh desde otro teléfono rechazado |
| 26 | Expiración de sesión | `auth.test.ts` | Logout invalida al instante; sesión revocada corta aunque el JWT siga vigente; refresh caducado; token manipulado |

---

## Pruebas adicionales

| Área | Qué se prueba |
|---|---|
| Faltas | Sin entrada → `AUSENTE`; sin horario → no genera falta; el cierre es idempotente |
| Horarios | Cambiar horario conserva la vigencia anterior; salida anterior a entrada rechazada; la jornada guarda copia del horario del día |
| Base de datos | Dos jornadas del mismo día rechazadas; dos dispositivos activos rechazados; coordenadas y radios absurdos rechazados |
| Contraseñas | Nunca en texto plano; bloqueo tras 5 intentos; cambio exige la actual y cierra sesiones; política de complejidad; la temporal nunca llega a la auditoría |
| Enumeración | DNI inexistente y contraseña incorrecta dan la misma respuesta |
| Dispositivo | La autorización de cambio es de un solo uso; desvincular cierra sesiones; la historia de vinculaciones se preserva |
| Autorización | Un practicante recibe 403 en rutas administrativas; ninguna ruta de negocio responde sin token |
| Evidencias | El practicante ve la suya y no la de otro; lectura auditada; enlace firmado caduca y rechaza firma manipulada; alteración en disco detectada |
| Tablero | Los intentos rechazados cuentan como alertas, nunca como asistencia |

---

## Cobertura en la aplicación móvil

`mobile/test/widget_test.dart`:

- Catálogo de errores: cada código tiene un mensaje útil; el del servidor tiene
  prioridad; qué errores admiten reintento, cuáles exigen reautenticar y cuáles
  abren los ajustes del sistema.
- Colores de estado: falta, puntual, tardanza y severidades se distinguen.
- Lectura del estado del día, del resultado de una marcación (puntual, tardanza,
  deduplicada) y del usuario (rol, sede, consentimiento).
- Componentes: etiquetas de estado, barra sin conexión, vista de error con
  reintento, indicadores.

---

## Prueba de humo contra el sistema en ejecución

Además de las pruebas automatizadas, se levantó el **backend compilado**
(`node dist/main.js`) sobre un PostgreSQL real, con migraciones y seed, y el
**panel compilado** servido con proxy hacia la API. Luego se recorrió el flujo
completo por HTTP, como lo harían la app y el panel:

| Bloque | Verificaciones |
|---|---|
| Administrador | Login, tablero global con las sedes del seed |
| Alta | Sede con radio 50 m; practicante con horario y contraseña temporal |
| App | Vinculación en el primer login; cambio de contraseña obligatorio antes de marcar; política pública y consentimiento |
| Marcaciones | Rechazo fuera de geocerca (222 m), ubicación simulada, GPS impreciso y otro teléfono; entrada válida con tardanza calculada por el servidor; reintento idempotente; doble entrada rechazada; salida |
| Panel | Tablero refleja la jornada; 4 intentos rechazados como alertas; detalle con mapa; foto servida íntegra por enlace firmado; regularización; Excel y PDF; auditoría |
| Tiempo real | El canal SSE entrega el evento de seguridad al instante |
| Sesión | Logout invalida el token de inmediato |
| Panel web | `index.html` y assets servidos; enrutado SPA; proxy `/api`; login por el mismo origen; 403 a un practicante en rutas administrativas |

**Resultado: 29 de 29 correctas.** Esta prueba destapó un defecto real (un
reintento idempotente devolvía la hora programada en lugar de la hora real de la
marcación), que se corrigió y quedó cubierto por una aserción de regresión.

El script está en [`ops/prueba-humo.mjs`](../ops/prueba-humo.mjs) para repetirlo
tras cada despliegue:

```bash
API_URL=https://asistencia.suinstitucion.pe/api/v1 ADMIN_DNI=12345678 ADMIN_PASSWORD='...' node ops/prueba-humo.mjs
```

---

## Prueba en teléfono real

Ejecutada el **21 de septiembre de 2026** sobre un **motorola moto g85 5G**
(Android 16, API 36) con el APK de depuración instalado y el servidor corriendo
en la computadora, alcanzado desde el teléfono con `adb reverse tcp:4000`.

| Paso | Resultado |
|---|---|
| Restablecer la contraseña desde el panel | La sesión abierta en el teléfono quedó revocada al instante y la app volvió al inicio de sesión |
| Ingresar con la contraseña temporal | La app exigió cambiarla antes de mostrar nada más |
| Guardar la contraseña nueva | Se cerraron todas las sesiones y pidió ingresar de nuevo |
| Abrir el flujo de entrada | Leyó el GPS, dibujó el mapa y confirmó *Estás dentro de tu sede*, 0 m de distancia |
| Tomar la fotografía | Se abrió la cámara frontal directamente; no hay ninguna ruta a la galería |
| Confirmar la entrada | **Entrada registrada 17:58**, hora del servidor, contra las 17:59 programadas → **PUNTUAL** |
| Pantalla de inicio tras la entrada | Pasó a *Presente*, entrada 17:58, salida *Pendiente*, y el único botón disponible fue *Marcar salida* |
| Confirmar la salida | **Salida registrada 18:00** |
| Jornada en el servidor | `PRESENTE` / `PUNTUAL`, 0 minutos de tardanza, entrada y salida con su evidencia |
| Evidencias | 100 176 y 108 177 bytes, `image/jpeg`; el SHA-256 descargado coincide con el guardado |
| URL firmada manipulada | `401` |
| Verificación de integridad del periodo | `2 revisadas, 2 íntegras, 0 alteradas, 0 faltantes` |
| Bitácora del día | `ENTRADA_REGISTRADA`, `SALIDA_REGISTRADA`, `PASSWORD_CAMBIADA`, `PASSWORD_RESTABLECIDA`, `HORARIO_ACTUALIZADO`, `SEDE_ACTUALIZADA`, `PARAMETROS_ACTUALIZADOS`, `LOGIN_EXITOSO` |
| Eventos de seguridad | Un `SESION_SIMULTANEA`, por haber abierto sesión dos veces |

**Condición del ensayo:** el teléfono estaba dentro de un edificio y solo
conseguía posición de red con **200 m** de precisión, que el sistema rechaza con
los valores por defecto (35 m para un radio de 50 m). Para poder completar la
marcación se subieron temporalmente los parámetros de la sede de prueba a
200 m de precisión y 400 m de radio, **por el panel de parámetros**, y se
devolvieron a 35 m y 50 m al terminar. Ese rechazo con los valores por defecto
ya se había verificado antes: la app mostró *no se obtuvo la precisión
necesaria* y el intento quedó como evento `GPS_IMPRECISO` en el servidor.

### Segunda corrida: 22 de septiembre de 2026

Se repitió el ciclo buscando los caminos que la primera vez no se ejercitaron.
**Encontró dos defectos reales**, los dos ya corregidos y con prueba de
regresión (ver abajo).

| Paso | Resultado |
|---|---|
| Aviso previo de tardanza | La pantalla de inicio anunció *Tu entrada se registrará como TARDANZA (50 min)* antes de marcar |
| Horario con salida pasada la medianoche | El servidor lo rechazó: *En Martes la hora de salida debe ser posterior a la de entrada* |
| GPS insuficiente, con los valores por defecto | Tres intentos de mejorar la precisión y rechazo: *200 m; se requieren 35 m o menos*. Quedó como evento `GPS_IMPRECISO` |
| Intento fuera del radio | *Estás fuera del radio*: 2081 m contra 400 m permitidos, mapa en rojo, sin acceso a la cámara. Quedó como evento `FUERA_DE_GEOCERCA` con la distancia, y avisó al administrador |
| **Entrada con tardanza** | **23:12** contra las 22:13 programadas → `TARDANZA`, **59 minutos** |
| **Salida** | **23:14** |
| Jornada en el servidor | `PRESENTE` / `TARDANZA`, 59 min, ambas marcaciones a 0,24 m de la sede |
| Evidencias | 98 960 y 97 256 bytes; SHA-256 descargado = guardado; integridad del periodo 2/2 íntegras |
| URL firmada manipulada | `401` |
| Bitácora del día | `ENTRADA_REGISTRADA`, `SALIDA_REGISTRADA`, `MARCACION_RECHAZADA` ×2, `HORARIO_ACTUALIZADO`, `SEDE_ACTUALIZADA`, `PARAMETROS_ACTUALIZADOS`, `TOKEN_RENOVADO`, `LOGIN_EXITOSO` |

#### Defecto 1: los rangos de fecha se interpretaban en UTC

El incidente de las 22:55 **no aparecía** al filtrar por su propio día. El rango
se construía con `new Date(fecha + 'T00:00:00Z')`, de modo que en Lima (UTC-5)
el "día de hoy" iba de las 19:00 de ayer a las 18:59 de hoy: todo el turno
tarde caía en el día siguiente.

Afectaba a las alertas de seguridad, su resumen, la bitácora de auditoría, el
listado de regularizaciones, la verificación de integridad, el historial del
practicante y los reportes de incidencias. Se corrigió con
`startOfLocalDay` / `endOfLocalDay` en `core/time.ts`, que construyen el rango
en la zona horaria de la institución (la de la sede, en el archivado).

#### Defecto 2: el intento fuera del radio no dejaba rastro

La aplicación cortaba la marcación en el teléfono y **no enviaba nada**, así que
el servidor nunca se enteraba de que alguien intentó marcar desde otro sitio
—justo el caso que más importa vigilar—. El §9 exige que todo intento rechazado
quede registrado.

Ahora la app informa también ese caso por `POST /asistencia/incidente`, que
acepta `FUERA_DE_GEOCERCA` con la distancia, lo guarda como evento de seguridad
de severidad ADVERTENCIA, avisa al administrador y lo audita como
`MARCACION_RECHAZADA`. Nunca crea asistencia.

Ambos quedaron cubiertos por pruebas automatizadas: `src/tests/rangos-fecha.test.ts`
(4 casos con fechas fijas, para no depender de la hora de ejecución) y un caso
nuevo en `attendance.test.ts`.

---

### Tercera corrida: 23 de septiembre de 2026 — endurecimiento

Revisión de la familia de problemas que destapó la corrida anterior. Tres
cambios, todos con prueba de regresión y el de geocerca verificado otra vez en
el teléfono.

| Qué | Por qué | Cómo quedó |
|---|---|---|
| Los avisos de intento rechazado compartían cupo con la marcación | Quien pelea con un GPS malo genera un aviso por intento; con 20 por cada 5 minutos podía quedarse **sin poder marcar** al llegar a la sede. Lo introdujo el arreglo del día anterior | Limitador propio, 40 por 5 minutos. Una prueba manda 21 avisos y después marca |
| El servidor se creía la distancia que informaba el teléfono | Es un dato del cliente, como las coordenadas. Un cliente modificado podía declarar *estoy a 5 m* estando a dos kilómetros | La recalcula el servidor con las coordenadas recibidas. Lo que dijo el teléfono se guarda aparte, en `details.distanciaInformadaPorElTelefono` |
| Marcar desde un teléfono no vinculado devolvía `401` sin dejar rastro | Es la señal de una credencial robada: token válido usado desde otro aparato. Quedaba invisible | Evento **crítico** con aviso inmediato. El límite de tasa se evalúa antes, para que nadie inunde la bitácora |

En el teléfono se repitió el intento fuera del radio: el evento quedó con
**2022,2 m calculados por el servidor** y, como dato aparte, los 2024,46 m que
informó la aplicación.

También se corrigió el panel, que calculaba *hoy* con la zona horaria del
navegador: ahora toma la de la institución de `GET /salud` antes de pintar nada,
de modo que un administrador que consulte desde otra región vea el mismo día que
las sedes.

---

## Lo que no se pudo probar en este entorno

| Qué | Motivo | Cómo probarlo |
|---|---|---|
| `isMocked` con una app de ubicación falsa | No se instaló una en el teléfono de prueba | Paso 7 de la lista de abajo |
| Fijación GPS fina (menos de 35 m) | El teléfono estaba dentro de un edificio | Repetir la marcación al aire libre con los valores por defecto |
| Subida real a Google Drive | Requiere credenciales del propietario | `GET /archivado/drive/estado` y archivar un mes de prueba |
| Envío push FCM real | Requiere proyecto Firebase | Ver LIMITACIONES.md |

### Verificación manual en teléfono real

1. Primer ingreso → pide cambiar contraseña → pide aceptar la política.
2. Fuera de la sede → *Estás fuera del radio*, con distancia y mapa.
3. Dentro de la sede → mapa en verde → cámara frontal se abre sola.
4. Verificar que **no existe** ningún botón de galería.
5. Tomar foto → vista previa → confirmar → resultado con hora del servidor.
6. Volver a marcar entrada → *Ya registraste tu entrada de hoy*.
7. Activar una app de ubicación falsa → *Se detectó una ubicación simulada*.
8. Modo avión → *Necesitas conexión a Internet...*
9. Cerrar la app y reabrirla → entra sin pedir contraseña.
10. Entrar con la misma cuenta en otro teléfono → rechazado.
