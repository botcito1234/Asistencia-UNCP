# Operación diaria

Guía para quien administra el sistema una vez en marcha.

---

## Tareas automáticas

No requieren intervención. Están en el propio backend (`ENABLE_CRON=true`).

| Tarea | Cuándo | Qué hace |
|---|---|---|
| Cierre de jornada | Cada 15 min; actúa cuando la sede llega a su hora de cierre (23:30 local por defecto) | Marca faltas y salidas pendientes, genera alertas y un aviso agregado |
| Retención | Día 2 de cada mes, 03:00 | Archiva y libera los meses que superaron la retención (6 meses) |
| Limpieza | Diaria, 03:30 | Borra sesiones caducadas hace más de 90 días y cancela autorizaciones vencidas |
| Respaldo | Según `crontab` (recomendado 02:00) | Volcado de base + evidencias + manifiesto de hashes |

Todas son idempotentes: si el servidor se reinicia a mitad de una, reejecutarla
no duplica faltas, alertas ni lotes.

---

## Situaciones frecuentes

### "Me dice que mi dispositivo no está autorizado"

El practicante cambió de teléfono, reinstaló la app o borró sus datos.

**Panel → Practicantes → ficha → Dispositivo → Gestionar**

| Opción | Cuándo usarla |
|---|---|
| **Autorizar cambio de teléfono** | El practicante tiene el teléfono nuevo en la mano. El actual sigue funcionando hasta que entre con el nuevo. La autorización vale 48 h y una sola vez |
| **Desvincular ahora** | Teléfono perdido o robado. Corta el acceso de inmediato y cierra todas sus sesiones |

Ambas exigen motivo y quedan auditadas. También se pueden hacer desde la app del
administrador.

### "No me deja marcar, dice que no estoy en la sede"

1. Abra la alerta en **Alertas**: muestra la distancia exacta y las coordenadas.
2. Si la distancia es pequeña (p. ej. 55 m con radio 50) y ocurre a menudo, el
   centro de la sede puede estar mal ubicado: **Sedes → Editar**, arrastre el
   marcador a la entrada real.
3. Si la sede es grande, amplíe el radio. Tenga en cuenta que la precisión GPS
   exigida se calcula como el 70 % del radio, con el tope configurado.

### "Dice que mi GPS no es preciso"

Dentro de edificios la precisión empeora. Indique al practicante que salga a la
puerta o a una ventana. Si el problema es constante en una sede, valore subir el
radio (y con él el umbral de precisión) o el tope en **Parámetros**.

### "Olvidé marcar la salida"

La jornada queda como **salida pendiente**. No se puede crear la marcación a
mano: una marcación es evidencia (foto + GPS + dispositivo). Opciones:

- Si hay justificación, **Regularizar → Justificación** con el motivo.
- Si hubo un error del sistema documentado, regularice el **estado del día**
  explicando el motivo.

### "Llegué a tiempo pero me puso tardanza"

Revise la jornada: la hora registrada es la del **servidor**, no la del teléfono.
Si procede corregir, **Regularizar → Puntualidad** o **Hora de entrada** con
motivo. El valor original queda registrado.

### "Olvidé mi contraseña"

**Practicantes → ficha → Restablecer contraseña.** Se genera una temporal que se
muestra una sola vez; entréguela por un canal seguro. Se cierran todas sus
sesiones y deberá cambiarla al entrar.

### Cuenta bloqueada

Tras 5 intentos fallidos la cuenta se bloquea 15 minutos. Se desbloquea sola.
Restablecer la contraseña también la desbloquea.

---

## Alertas de seguridad

**Panel → Alertas.** Revíselas a diario. Marque como atendidas las revisadas,
con una nota de lo que se verificó.

| Alerta | Severidad | Qué revisar |
|---|---|---|
| Ubicación simulada | Crítica | Hable con el practicante. Repetida, es un intento deliberado |
| Dispositivo no autorizado | Crítica | ¿Cambió de teléfono? ¿Alguien intenta entrar con sus credenciales? |
| Fuera del radio | Advertencia | Distancia. Si es sistemática en una sede, revise su ubicación |
| Sesión simultánea | Advertencia | Normal si reinstaló la app; sospechoso si es frecuente |
| Fallo de archivado | Crítica | **Archivado**: detalle del error y reintento |
| Evidencia inválida | Advertencia / Crítica | Crítica si apareció al archivar: una foto no coincide con su hash |

---

## Archivado

**Panel → Archivado.** Muestra cada lote con su estado:

| Estado | Significado | Acción |
|---|---|---|
| Pendiente de subida | Paquete generado y verificado en disco; Drive no configurado | Configurar Drive y volver a archivar ese periodo |
| Subido y verificado | Copia remota confirmada; fotos locales aún disponibles | Ninguna |
| Archivado y liberado | Copia remota confirmada y espacio local liberado | Ninguna |
| Fallido | Algo falló; **no se borró nada** | Revisar el error y reintentar |

Para consultar un periodo archivado y liberado: **Abrir en Drive** desde el lote.
El ZIP contiene `asistencias.xlsx`, `reporte.pdf`, `metadata.json` y la carpeta
`fotos/`. Los datos de la jornada (horas, estado, distancias) siguen en la base
de datos y en los reportes; lo único que sale del servidor son las imágenes.

### Verificar integridad sin archivar

**Archivado → Integridad** (o `GET /archivado/integridad?from=&to=`) compara el
hash de cada foto en disco con el registrado al recibirla. Cualquier alteración
posterior se detecta.

---

## Respaldo y restauración

```bash
./ops/respaldo.sh /mnt/respaldos
./ops/restaurar.sh /mnt/respaldos/asistencia_AAAAMMDD_HHMMSS
```

La restauración verifica el manifiesto de hashes **antes** de tocar nada, pide
confirmación escribiendo `RESTAURAR`, detiene la API durante el proceso y la
vuelve a levantar al terminar.

Recomendación: una vez al trimestre, restaure un respaldo en un servidor de
prueba. Un respaldo que nunca se probó no es un respaldo.

---

## Registros

```bash
docker compose logs -f api                    # en vivo
docker compose logs api --since 1h            # última hora
docker compose logs api | grep '"level":50'   # solo errores
```

Cada petición lleva un `requestId`. Cuando un usuario reporta un error, el panel
y la app lo muestran; búsquelo en los registros para ver la traza completa.

Los registros **nunca** contienen contraseñas, tokens ni claves: el logger las
redacta antes de escribir.

---

## Auditoría

**Panel → Auditoría.** Registro inmutable (la base de datos rechaza cualquier
modificación o borrado) de:

- Inicios de sesión, fallidos y correctos
- Altas, cambios y desactivaciones de sedes y practicantes
- Cambios de horario
- Vinculación y revocación de dispositivos
- Cada marcación aceptada y cada rechazada
- Cada regularización, con valor anterior, nuevo y motivo
- **Cada consulta o descarga de una fotografía**
- **Cada reporte generado**
- Cambios de parámetros

Un practicante tiene derecho a saber quién consultó sus evidencias: filtre por
*Evidencia consultada* y por su identificador.
