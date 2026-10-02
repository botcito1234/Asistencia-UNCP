# NEXORA · Plan de cierre del desarrollo

Fecha de corte: 29 de septiembre de 2026
Producto: NEXORA · Control de Asistencia — UNCP

## 1. Estado ejecutivo

El producto tiene una base funcional verificable en backend, panel web y aplicación móvil. En el último ciclo se corrigieron reglas de alcance para suspensiones, se añadió el filtro `SUSPENDIDA`, se restringieron las rutas de sedes a administradores y se reforzó la experiencia visual con movimiento breve y respetuoso de la preferencia de reducción de movimiento.

La salida a producción todavía depende de configuración real, aceptación operativa e integraciones externas. Esas actividades no se deben considerar resueltas solo porque el código compile.

## 2. Validaciones realizadas

| Área | Resultado |
|---|---|
| Backend: pruebas automatizadas | 10 archivos y 179 pruebas aprobadas |
| Backend: TypeScript, lint y build | Aprobados |
| Web admin: build de producción | Aprobado |
| Flutter: pruebas | 25 pruebas aprobadas |
| Flutter: análisis estático | Sin issues |
| Flutter: APK debug | Generado correctamente |
| Prisma | Esquema válido |
| Dependencias npm | `npm audit --audit-level=high`: 0 vulnerabilidades |
| Integridad del diff | `git diff --check`: sin errores de espacios |

### Observaciones no bloqueantes

- Flutter informa que algunos plugins todavía aplican Kotlin Gradle Plugin; debe resolverse mediante actualización de esos plugins antes de una futura versión de Flutter que lo convierta en error.
- Hay 46 paquetes Flutter con versiones nuevas incompatibles con las restricciones actuales; actualizar requiere una ventana propia de compatibilidad y regresión.
- Git muestra avisos de conversión LF/CRLF en Windows; no hay errores de espacios ni cambios funcionales asociados.

## 3. Trabajo completado en este ciclo

- Animación de entrada de páginas al cambiar de ruta.
- Apertura suave de modales, panel de notificaciones y avisos temporales.
- Respuesta de botones y métricas con elevación mínima al pasar el puntero, sin efectos excesivos.
- Estados de carga y error con roles accesibles (`status`, `alert`) y animación breve.
- Respeto global de `prefers-reduced-motion` y desplazamiento suave solo cuando el sistema lo permite.
- Transiciones de navegación nativas coherentes en Android, iOS, macOS, Windows y Linux.
- Conservación de la jerarquía NEXORA + UNCP: la marca del producto no sustituye la identidad institucional.

## 4. Pendientes necesarios para terminar el desarrollo

### 4.1 Configuración de producción

- Definir `DATABASE_URL` de producción y ejecutar `prisma migrate deploy`.
- Generar secretos reales: `JWT_SECRET` y claves de refresh, con al menos 32 caracteres aleatorios.
- Definir `APP_TIMEZONE`, `PUBLIC_BASE_URL`, `WEB_ADMIN_ORIGIN` y el nombre visible de NEXORA.
- Configurar almacenamiento de evidencias, permisos del directorio y política de retención.
- Configurar Google Drive si se usará archivo remoto; validar carpeta, credenciales y recuperación ante error.
- Configurar FCM para móvil y SMTP para correo; probar credenciales sin guardarlas en el repositorio.
- Mantener secretos en un gestor de secretos o variables protegidas, nunca en `.env` versionados.

### 4.2 Aceptación funcional con datos reales

Ejecutar y firmar una prueba por cada flujo:

1. Inicio de sesión, cierre de sesión, expiración y rotación de sesión.
2. Alta de sede, practicante, docente conductor y asignación de relaciones.
3. Creación de jornada y validación de horario, zona horaria y día no laborable.
4. Consentimiento, vinculación de dispositivo y marcación de entrada/salida.
5. Rechazo de GPS fuera de sede, precisión insuficiente, dispositivo no vinculado y doble marcación.
6. Evidencia local, hash, cola de sincronización, reintento y archivo remoto.
7. Cierre de jornada, consulta histórica, exportación de reportes y auditoría.
8. Suspensión total, por sede, por practicante y por selección; verificación de `SUSPENDIDA` en panel y API.
9. Flujo de docente conductor: seguimiento, reporte, notificación y permisos por rol.
10. Funcionamiento sin red y recuperación de conectividad en un dispositivo Android real.

### 4.3 Despliegue

- Publicar backend detrás de TLS, con proxy, límites de tamaño y encabezados de seguridad.
- Servir el panel web con variables de producción y control de caché de assets.
- Configurar backups automáticos de PostgreSQL y ejecutar una restauración de prueba.
- Generar APK/AAB firmado con la clave definitiva, revisar nombre, icono, permisos y versión.
- Definir procedimiento de rollback para backend, web, base de datos y móvil.
- Registrar quién puede desplegar y quién aprueba cambios de esquema o de permisos.

### 4.4 Operación y observabilidad

- Alertar por fallos de archivo remoto, errores de sincronización, sesiones rechazadas y caída de SSE.
- Medir latencia de API, tasa de error, marcaciones rechazadas y trabajos pendientes.
- Establecer retención de logs, auditoría y evidencias conforme a la política institucional.
- Verificar cron/tareas programadas, zona horaria del servidor y comportamiento al cambiar de día.
- Preparar un runbook de soporte: diagnóstico, reintento seguro, bloqueo de dispositivo y escalamiento.

### 4.5 Seguridad, privacidad y cumplimiento

- Revisar con la institución la base legal, consentimiento, retención y eliminación de datos personales.
- Cambiar cualquier contraseña inicial antes de entregar el sistema.
- Validar CORS, rate limiting, cookies/tokens, permisos por rol y exposición de datos en reportes.
- Realizar una prueba de autorización con cada rol sobre cada ruta administrativa.
- Revisar que las evidencias no queden accesibles por URL pública sin autorización.
- Ejecutar una revisión de seguridad externa antes de exponer el sistema a usuarios reales.

### 4.6 Cierre de experiencia

- Probar responsive en resoluciones de laptop, tablet y móvil.
- Revisar contraste, foco de teclado, lectores de pantalla y `prefers-reduced-motion`.
- Validar textos institucionales, iconos, logo real y datos de contacto de soporte.
- Hacer una sesión de aceptación con usuarios administrativos, docentes y practicantes.
- Registrar capturas aprobadas para la guía de usuario y el acta de entrega.

## 5. Definition of Done para producción

- [x] Backend compila, pasa lint y pasa la suite automatizada.
- [x] Web compila para producción.
- [x] Mobile analiza sin issues, pasa pruebas y genera APK.
- [x] Roles y reglas de alcance críticas tienen pruebas automatizadas.
- [x] Marca NEXORA aplicada sin desplazar la identidad UNCP.
- [x] Movimiento visual implementado con alternativa de reducción de movimiento.
- [ ] Variables y secretos de producción configurados en el entorno real.
- [ ] Migraciones, backups y restauración probados en infraestructura real.
- [ ] FCM, SMTP, archivo remoto y sincronización probados con cuentas reales.
- [ ] Aceptación funcional firmada por cada perfil de usuario.
- [ ] Revisión de seguridad, privacidad y retención aprobada.
- [ ] APK/AAB de release firmado y procedimiento de rollback documentado.

## 6. Comandos reproducibles

```powershell
cd backend
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx prisma validate
npm audit --audit-level=high

cd ..\web-admin
npm ci
npm run build

cd ..\mobile
flutter pub get
flutter test
flutter analyze
flutter build apk --debug
```

## 7. Evaluación final del ciclo

Resultado: **aprobado para continuar hacia aceptación y preparación de producción; no aprobado todavía como despliegue productivo final**.

La razón es objetiva: la calidad del código y las pruebas locales cumplen, pero todavía faltan decisiones y verificaciones que requieren infraestructura, credenciales, usuarios y aprobación institucional. El siguiente hito correcto es ejecutar la matriz de aceptación real y cerrar los pendientes marcados con `[ ]`.
