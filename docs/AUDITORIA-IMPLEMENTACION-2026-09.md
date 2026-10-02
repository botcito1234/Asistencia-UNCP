# Auditoría e implementación — septiembre de 2026

## Correcciones aplicadas

- SSE restringido a `ADMINISTRADOR`; los eventos en tiempo real no se difunden a cuentas no administrativas.
- Rotación de refresh token con reclamación atómica y bloqueo de dispositivo obligatorio cuando la sesión está vinculada.
- Archivado fail-closed: evidencia alterada o faltante detiene el lote antes de empaquetar, subir o liberar binarios.
- Validación de URLs, zona horaria, rangos numéricos y hora de cierre.
- Borrado físico de un practicante bloqueado en base de datos; la API continúa usando desactivación lógica.
- Script operativo `npm run bootstrap:admin` y lint reproducible con ESLint flat config.

## Funcionalidad de negocio incorporada

- Rol `DOCENTE_CONDUCTOR`, perfil y asignación muchos-a-muchos de practicantes.
- Suspensiones por sede, practicante o selección; las jornadas afectadas quedan `SUSPENDIDA` y no generan tardanza, falta ni salida pendiente.
- Nombre obligatorio de sesión y observación opcional en la marcación.
- Seguimiento docente privado con categoría, naturaleza, importancia, detalle y recomendación; los reportes importantes o incidentales notifican a administración.
- Dashboard, reportes y metadata de archivado preparados para sesiones y suspensiones.
- Aplicación móvil unificada con pantalla de docente conductor y formulario de reporte.
- Panel administrativo con vistas de suspensiones y seguimiento docente.

## Verificación ejecutada

- `backend`: typecheck, build y suite de PostgreSQL efímero.
- `web-admin`: typecheck y build Vite.
- `mobile`: analyze y build APK debug.
- Dependencias directas actualizadas: Nodemailer 10, node-cron 4, Google APIs 182 y React Router 7.18.4.

## Pendientes operativos explícitos

- Prisma y ExcelJS todavía tienen avisos de auditoría que requieren actualización mayor o sustitución validada; no se forzaron cambios incompatibles.
- SSE y cron siguen siendo locales al proceso; para varias réplicas se debe introducir un bus compartido y un lock distribuido.
- La ejecución de Docker depende de tener Docker instalado en el entorno de despliegue.
