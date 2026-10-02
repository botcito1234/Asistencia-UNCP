# NEXORA · Manual y resumen maestro del portal

Fecha de corte: **1 de octubre de 2026**
Producto: **NEXORA · Control de Asistencia**
Institución propietaria: **Universidad Nacional del Centro del Perú (UNCP)**

> Este es el documento maestro de revisión. Reúne el resultado de la auditoría, las decisiones de arquitectura, la funcionalidad implementada, los ciclos de UX/UI, las pruebas ejecutadas y todo lo necesario para terminar el desarrollo. `docs/AUDITORIA-IMPLEMENTACION-2026-09.md` y `docs/PLAN-CIERRE-DESARROLLO.md` quedan como registros históricos complementarios.

## 1. Veredicto ejecutivo

El sistema tiene una base funcional sólida y verificable en tres superficies:

- **Backend:** API, reglas de negocio, persistencia, seguridad, auditoría, evidencias, notificaciones, reportes y archivado.
- **Panel web:** operación administrativa de asistencia, sedes, practicantes, docentes conductores, seguridad, reportes, suspensiones, auditoría y parámetros.
- **Aplicación móvil:** autenticación, consentimiento, dispositivo, geolocalización, cámara, marcación, historial, notificaciones, administración móvil y seguimiento docente.

Resultado de la revisión: **aprobado técnicamente para pasar a aceptación con usuarios y preparación de producción**. No se declara todavía “100 % productivo” porque faltan configuración de infraestructura real, integraciones externas, pruebas con dispositivos y aprobación institucional.

## 2. Propósito y límites del producto

NEXORA controla la asistencia de practicantes de la UNCP con una cadena verificable:

1. El usuario se autentica.
2. La cuenta queda vinculada a un dispositivo autorizado.
3. El sistema valida jornada, horario, zona horaria, geolocalización, precisión y duplicidad.
4. La marcación de entrada o salida se acompaña de evidencia fotográfica cuando corresponde.
5. Se registra la trazabilidad técnica y de negocio.
6. La administración puede consultar, regularizar, reportar, auditar y archivar.

Fuera del núcleo actual quedan, hasta decisión institucional, integraciones académicas externas, nómina, pagos y gestión completa de recursos humanos.

## 3. Arquitectura completa

### 3.1 Capas

| Capa | Ubicación | Responsabilidad |
|---|---|---|
| Panel administrativo | `web-admin/` | Operación de administradores en navegador, consultas, formularios, tablas y reportes |
| API | `backend/src/` | Autenticación, autorización, reglas, casos de uso, notificaciones y archivos |
| Persistencia | `backend/prisma/` | PostgreSQL, modelos, restricciones y migraciones |
| Aplicación móvil | `mobile/` | Flujo de practicante, administrador y docente conductor |
| Operación | `ops/`, `backend/scripts/` | Entorno, bootstrap, despliegue y tareas operativas |
| Documentación | `docs/` | Pruebas, auditoría, manual y cierre |

### 3.2 Módulos funcionales

- Autenticación y sesiones con refresh token rotatorio.
- Usuarios, roles, estados y cambio obligatorio de contraseña.
- Sedes, coordenadas, radio de geocerca y zona horaria.
- Practicantes, datos de contacto, consentimiento y dispositivo.
- Cargas masivas de practicantes desde Excel, con previsualización, validación por fila y confirmación transaccional.
- Horarios semanales y jornadas diarias.
- Marcaciones de entrada y salida con idempotencia.
- Geolocalización, precisión, dispositivo, fotografía y hash de evidencia.
- Mapas con OpenStreetMap por defecto y rutas viales opcionales mediante Google Routes API.
- Alertas de seguridad e incidentes.
- Regularizaciones con motivo, referencia y auditoría.
- Notificaciones, correo, push y canal SSE para administración.
- Docentes conductores, asignación de practicantes y reportes de seguimiento.
- Suspensiones por sede, practicante o selección.
- Reportes PDF/Excel y vista previa.
- Archivado local/remoto con verificación fail-closed.
- Parámetros operativos, retención y bitácora de auditoría.

### 3.3 Roles

| Rol | Superficie | Alcance |
|---|---|---|
| `ADMINISTRADOR` | Web y móvil | Administración, seguridad, reportes, auditoría y operación completa |
| `PRACTICANTE` | Móvil | Consentimiento, marcación, historial y notificaciones propias |
| `DOCENTE_CONDUCTOR` | Móvil | Practicantes asignados y seguimiento docente privado |

El panel web está restringido a `ADMINISTRADOR`. Las rutas administrativas sensibles exigen rol explícito; sedes, seguridad, reportes, archivado, parámetros, suspensiones y seguimiento no deben quedar disponibles por el solo hecho de tener sesión.

## 4. Flujos de negocio implementados

### 4.1 Acceso

- Inicio de sesión con DNI y contraseña.
- Sesión persistente y restaurable en móvil.
- Refresh token rotatorio y reclamación atómica.
- Cierre de sesión y revocación.
- Cambio obligatorio de contraseña temporal.
- Mensajes de error orientados a la acción.

### 4.2 Consentimiento y dispositivo

- El practicante acepta la política antes de tratar ubicación o foto.
- El primer dispositivo se vincula.
- Un dispositivo no autorizado no puede marcar.
- El cambio de dispositivo requiere intervención administrativa.
- Los eventos de seguridad registran intento, contexto y resolución.

### 4.3 Marcación

- Se verifica que exista jornada y ventana válida.
- Se valida GPS, precisión, antigüedad y geocerca.
- Se evita entrada o salida duplicada mediante idempotencia.
- Se calcula puntualidad, tardanza y permanencia.
- La evidencia se almacena con hash y estado.
- Los errores diferenciados ofrecen reintento solo cuando tiene sentido.

### 4.4 Suspensiones

- `SITE`: suspende una sede.
- `INTERN`: suspende un practicante.
- `SELECTED_INTERNS`: suspende una selección.
- La jornada afectada queda `SUSPENDIDA`.
- Una jornada suspendida no se interpreta como falta, tardanza ni salida pendiente.
- El panel permite filtrar y visualizar `SUSPENDIDA`.
- La API valida que los identificadores enviados correspondan al alcance elegido.

### 4.5 Seguimiento docente

- Administración registra docentes conductores.
- Se asignan practicantes con relación histórica y revocación trazable.
- El docente ve únicamente su cartera.
- El reporte tiene categoría, naturaleza, importancia, detalle y recomendación.
- Reportes importantes o incidentales pueden notificar a administración.

### 4.6 Archivado

- Se prepara el periodo.
- Se verifican evidencias.
- Se empaqueta y sube solo si la verificación es correcta.
- Una evidencia faltante o alterada detiene el lote.
- Se conserva metadata del lote, estado, hash, error y fecha.

## 5. Seguridad y trazabilidad

Correcciones y controles aplicados:

- SSE restringido a administradores.
- Refresh token con rotación y detección de reutilización.
- Dispositivo vinculado obligatorio cuando la política lo exige.
- CORS y configuración de origen parametrizados.
- Validación de URLs, zona horaria, rangos numéricos y hora de cierre.
- Autorización por rol y por alcance.
- Auditoría de acciones sensibles.
- Eventos de seguridad separados de los indicadores de asistencia.
- Evidencia remota con política fail-closed.
- Eliminación física disponible para el flujo administrativo bloqueado; la API ordinaria mantiene desactivación lógica.
- Secretos fuera del repositorio y variables de entorno documentadas.

## 6. Sistema visual NEXORA + UNCP

### 6.1 Jerarquía de marca

- **UNCP** es la institución propietaria y se identifica con el escudo.
- **NEXORA** identifica la plataforma y aparece como sistema visual/crédito.
- Las marcas no son intercambiables.
- El escudo no se usa como textura, marca de agua, sombra o elemento decorativo.
- Los logos se escalan proporcionalmente y no se recolorean ni deforman.

### 6.2 Paleta

| Papel | Valor | Uso |
|---|---|---|
| Dominante | `#0B1F3A` | Barras, encabezados y texto fuerte |
| Acción | `#2563EB` | Botones primarios, enlaces y foco |
| Acento | `#38BDF8` | Selección e indicadores |
| Borde | `#E5E7EB` | Campos, tarjetas y separadores |
| Superficie | `#FFFFFF` | Tarjetas, formularios y tablas |
| Fondo | `#F8FAFC` | Lienzo general |

Estados de información:

- Verde: presente/puntual.
- Ámbar: tardanza/aviso.
- Rojo: falta/peligro/crítico.
- Azul: información/suspendida.

Los colores de estado no se reutilizan como decoración de marca.

### 6.3 Tipografía y datos

- Sora se sirve localmente, sin CDN.
- SemiBold para títulos, cifras y etiquetas.
- Regular para lectura general.
- Horas y cifras con numeración tabular.
- Contraste y foco visible definidos en el panel web.

## 7. Ciclos de UX/UI ejecutados

### Loop 0 · Línea base

Se revisaron arquitectura, rutas, componentes compartidos, pantallas móviles, estados de carga/error/vacío, formularios y reglas de marca. Se identificó que el sistema ya tenía buena base de componentes, pero quedaban inconsistencias de interacción y estados incompletos.

### Loop 1 · Movimiento y jerarquía visual web

Implementado en `web-admin/src/index.css`, `Layout.tsx` y `ui.tsx`:

- Entrada breve de contenido al cambiar de ruta.
- Apertura controlada de diálogo, overlay, notificación y toast.
- Respuesta sutil de botones, métricas y elementos interactivos.
- Estados de carga y error con transición breve.
- `role="status"`, `aria-live` y `role="alert"` donde correspondía.
- `prefers-reduced-motion` para desactivar la animación.
- Duraciones cortas de 160–220 ms; sin efectos decorativos prolongados.

Decisión de diseño: el movimiento acompaña comprensión y respuesta; no se agregaron fondos degradados, sombras largas ni animaciones llamativas.

### Loop 2 · Formularios y navegación web

Implementado y corregido:

- Asociación explícita entre etiqueta y control en docentes y suspensiones.
- Selección múltiple de practicantes convertida de lista Ctrl/Cmd a casillas visibles.
- Menú móvil con `aria-expanded`, `aria-controls`, backdrop y cierre claro.
- Pantalla de suspensiones con `PageHeader` coherente.
- Confirmación visual de suspensión creada.
- Estado de carga y vacío para el histórico de suspensiones.
- Mensaje de error con reintento para la mutación de suspensión.
- Lista de asignación docente con nombre, sede y estado seleccionable.

### Loop 3 · Aplicación móvil

Implementado y probado:

- Transiciones nativas coherentes por plataforma.
- `SUSPENDIDA` representada como estado informativo en color y etiqueta.
- Pantalla de docente conductor con error recuperable; antes podía quedar indefinidamente en spinner.
- Estado vacío explicativo cuando no hay practicantes asignados.
- Reporte docente con campos visibles de categoría, naturaleza e importancia.
- Validación del detalle mínimo dentro del diálogo, sin cerrar silenciosamente.
- Error de envío comunicado con mensaje accionable.
- Estados de red, error, reintento y vacío conservan componentes comunes.

### Loop 4 · Verificación

- Se levantó el panel local y se inspeccionó visualmente la pantalla de login.
- La jerarquía observada fue: NEXORA, escudo UNCP, producto, institución, formulario y crédito.
- El formulario es legible, centrado, con foco, contraste y CTA primario claro.
- Se corrigió formato Prettier en los archivos tocados y se repitió el build.
- El resultado final del loop quedó sin errores de compilación ni análisis.

### Loop 5 · Refinamiento de microinteracciones

Aplicado después de la segunda inspección visual:

- Pulso discreto del punto “En vivo” para comunicar conexión activa sin distraer.
- Panel de notificaciones con ancho máximo seguro para móvil y `aria-expanded`/`aria-controls`.
- Modal con botón semántico para cerrar por overlay y `aria-labelledby` asociado al título.
- Indicador de carga con `aria-busy` y spinner marcado como decorativo.
- Transición breve para cambios de estado y cifras en componentes Flutter.
- `MediaQuery.disableAnimations` respetado en esas transiciones móviles.
- Transición de filas de tabla limitada al color de fondo, sin desplazamientos inesperados.

Resultado: los efectos comunican actividad, cambio o respuesta; no se introdujeron loops visuales decorativos ni animaciones largas.

### Loop 6 · Profundidad 3D controlada y revisión transversal

Se revisaron las 17 vistas web, las 12 pantallas móviles y los componentes compartidos que las alimentan. La mejora quedó centralizada para que no haya pantallas con criterios distintos:

- Tarjetas web: profundidad 3D mínima al pasar el puntero o enfocar con teclado, con elevación y rotación casi imperceptibles.
- Métricas web: profundidad propia para comunicar que son superficies de lectura o acceso rápido.
- Login web: formulario con perspectiva suave y lockup NEXORA con microinclinación del isotipo.
- Móvil: entrada de pantallas y superficies con escala/perspectiva breve mediante `AnimatedSwitcher`, `TweenAnimationBuilder` y `Matrix4`.
- Los efectos 3D no se activan como interacción forzada en pantallas táctiles; la profundidad se percibe en la entrada y en la jerarquía visual.
- `prefers-reduced-motion` y `MediaQuery.disableAnimations` eliminan las transformaciones y transiciones cuando la persona lo solicita.
- No se añadieron gradientes, parallax continuo, loops decorativos ni sombras largas; el efecto conserva la identidad sobria definida para NEXORA.

Resultado: todas las vistas heredan una misma gramática de movimiento desde `Layout`, `Card`, `Metric`, `TarjetaSeccion` y `_Enrutador`, con rendimiento y accesibilidad verificables.

### Loop 7 · Integración segura de rutas Google

- Se agregó `GET /api/v1/mapas/ruta` para administradores, con validación de coordenadas y modo de transporte.
- El backend usa Google Routes API / Compute Routes y devuelve distancia, duración y polyline codificada.
- La clave se lee desde `GOOGLE_MAPS_API_KEY`, nunca desde el frontend ni el APK.
- El detalle de jornada incorpora el botón `Ruta vial`; calcula desde la sede hasta la última marcación y pinta la ruta sobre el mapa existente.
- Si Maps está deshabilitado, el mapa OpenStreetMap continúa funcionando y la ruta responde con una dependencia externa controlada.
- Se añadieron pruebas para configuración, cabecera de clave, normalización de respuesta y errores del proveedor.

### Loop 8 · Espacio de cargas masivas

- Se incorporó la ruta web protegida `/cargas-masivas` y el acceso `Cargas masivas` en la navegación del panel.
- La plantilla oficial vive en `web-admin/public/plantillas/plantilla-carga-masiva-practicantes.xlsx` y contiene instrucciones, hoja operativa y ejemplos.
- El backend expone `POST /api/v1/cargas-masivas/practicantes/preview` y `POST /api/v1/cargas-masivas/practicantes/commit`.
- Se valida estructura, límite de filas, DNI, duplicados, datos de contacto, horarios, sedes activas y conflictos contra la base de datos antes de escribir.
- La confirmación revalida el archivo y crea cuentas, fichas, horarios y auditoría dentro de una sola transacción.
- Las contraseñas temporales se generan en servidor, no se guardan en auditoría y se muestran una sola vez; el panel permite descargar un CSV inmediato.

## 8. Inventario de pantallas

### Panel web

- Login.
- Tablero general.
- Asistencia e historial de jornadas.
- Detalle de jornada, ubicación, evidencia y regularización.
- Practicantes y detalle individual.
- Docentes conductores y asignaciones.
- Sedes y tablero por sede.
- Alertas de seguridad.
- Reportes PDF/Excel y vista previa.
- Archivado histórico e integridad de evidencias.
- Auditoría.
- Parámetros operativos.
- Suspensiones.
- Seguimiento docente.
- Cargas masivas con plantilla Excel, previsualización, detalle de errores y credenciales de alta.

### Aplicación móvil

- Inicio de sesión.
- Cambio de contraseña.
- Consentimiento.
- Política de privacidad.
- Inicio de practicante.
- Flujo de marcación: ubicación, cámara, revisión, envío y resultado.
- Historial.
- Notificaciones.
- Inicio de administrador.
- Alertas administrativas.
- Practicantes administrativos.
- Inicio de docente conductor.
- Formulario de seguimiento docente.

## 9. Mapa de archivos principales

| Área | Archivos relevantes |
|---|---|
| Marca web | `web-admin/src/components/Brand.tsx`, `web-admin/src/index.css`, `web-admin/index.html` |
| Layout web | `web-admin/src/components/Layout.tsx`, `web-admin/src/components/ui.tsx` |
| Web de operación | `web-admin/src/pages/` |
| API | `backend/src/app.ts`, `backend/src/http/`, `backend/src/modules/` |
| Modelo de datos | `backend/prisma/schema.prisma`, `backend/prisma/migrations/` |
| Seguridad | `backend/src/modules/auth/`, `backend/src/modules/audit/`, `backend/src/http/middleware/` |
| Móvil | `mobile/lib/app.dart`, `mobile/lib/core/`, `mobile/lib/screens/`, `mobile/lib/widgets/` |
| Entorno | `backend/.env.example`, `ops/despliegue/entorno.ejemplo` |
| Pruebas | `backend/src/tests/`, `mobile/test/`, `docs/PRUEBAS.md` |

## 10. Validación reproducible

### Resultado actual

| Verificación | Resultado | Momento |
|---|---:|---|
| Backend suite PostgreSQL efímero | 12 archivos / 185 pruebas | 1 de octubre de 2026 |
| Backend TypeScript | Aprobado | Última ejecución completa |
| Backend ESLint | Aprobado | Última ejecución completa |
| Backend build | Aprobado | Última ejecución completa |
| Web TypeScript + Vite build | Aprobado | Después del loop 6 3D |
| Web Prettier en archivos modificados | Aprobado | Después del loop 6 3D |
| Flutter tests | 26 pruebas aprobadas | Después del loop 6 3D |
| Flutter analyze | Sin issues | Después del loop 6 3D |
| Prisma validate | Esquema válido | Última auditoría |
| npm audit high | 0 vulnerabilidades | Última auditoría |
| git diff --check | Sin errores funcionales de espacios | Última auditoría |
| APK debug | Generado correctamente | 30 de septiembre de 2026 |
| Parser de plantilla de carga masiva | 2 pruebas unitarias aprobadas | 1 de octubre de 2026 |

### Comandos

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
npx prettier --check src/pages/Conductors.tsx src/pages/Suspensions.tsx src/components/Layout.tsx

cd ..\mobile
flutter pub get
flutter test
flutter analyze
flutter build apk --debug
```

## 11. Observaciones y riesgos conocidos

### No bloqueantes de código

- Flutter informa que algunos plugins todavía aplican Kotlin Gradle Plugin; actualizar antes de una futura versión que lo convierta en error.
- Hay 46 paquetes Flutter con versiones nuevas incompatibles con las restricciones actuales; actualizarlos requiere regresión propia.
- Git muestra avisos LF/CRLF en Windows; no hay errores de espacios funcionales.

### Riesgos de operación

- SSE y cron son locales al proceso; para varias réplicas se necesita bus compartido y lock distribuido.
- Docker debe estar instalado en el entorno de despliegue.
- Prisma y ExcelJS tienen avisos de actualización mayor o sustitución validada; no se forzaron cambios incompatibles.
- El APK generado hasta ahora es debug; el release debe firmarse con la clave definitiva.
- La prueba visual local cubre la jerarquía del login; falta aceptación visual con datos y usuarios reales en todas las rutas.

## 12. Pendientes necesarios para cerrar producción

### Infraestructura y configuración

- [ ] `DATABASE_URL` real y `prisma migrate deploy` ejecutado.
- [ ] `JWT_SECRET` y secretos de refresh generados fuera del repositorio.
- [ ] `APP_TIMEZONE`, `PUBLIC_BASE_URL` y `WEB_ADMIN_ORIGIN` definidos.
- [ ] Almacenamiento de evidencias, permisos y retención configurados.
- [ ] Google Drive configurado y restauración validada, si aplica.
- [ ] Google Maps Routes API habilitada, clave restringida por API y `GOOGLE_MAPS_ENABLED` validado, si aplica.
- [ ] FCM y SMTP configurados con cuentas reales, si aplican.
- [ ] TLS, proxy, límites de tamaño y encabezados de seguridad habilitados.

### Aceptación con usuarios

- [ ] Administrador prueba login, sesiones, sedes, practicantes, jornadas y reportes.
- [ ] Administrador descarga la plantilla, valida un archivo con errores, corrige y confirma una carga masiva; conserva el CSV de credenciales.
- [ ] Practicante prueba consentimiento, dispositivo, GPS, cámara, entrada, salida e historial.
- [ ] Docente prueba cartera, reporte positivo, observación, incidencia y permisos.
- [ ] Se prueba suspensión por sede, practicante y selección.
- [ ] Se prueba modo sin red y recuperación en Android real.
- [ ] Se prueban GPS fuera de sede, precisión insuficiente, doble marcación y dispositivo no autorizado.
- [ ] Se prueba archivo remoto con evidencia válida, faltante y alterada.
- [ ] Se firma la matriz de aceptación por perfil.

### Seguridad, privacidad y operación

- [ ] Revisión institucional de consentimiento, base legal, retención y eliminación.
- [ ] Prueba de autorización por rol para cada ruta administrativa.
- [ ] Verificación de que las evidencias no estén expuestas por URL pública.
- [ ] Backups automáticos de PostgreSQL y restauración de prueba.
- [ ] Alertas de API, SSE, sincronización, archivo remoto y tareas programadas.
- [ ] Runbook de soporte, reintento seguro, bloqueo de dispositivo y escalamiento.
- [ ] Revisión de seguridad externa antes de usuarios reales.

### Release

- [ ] APK/AAB firmado, versionado y probado en dispositivos de la institución.
- [ ] Icono, nombre, permisos, URLs y política de privacidad revisados.
- [ ] Variables web de producción y caché de assets revisadas.
- [ ] Rollback de backend, web, esquema y móvil documentado.
- [ ] Acta de entrega y guía de usuario generadas.

## 13. Definition of Done

### Hecho

- [x] Arquitectura backend/web/mobile conectada.
- [x] Roles y restricciones de acceso principales implementados.
- [x] Marcación, GPS, dispositivo y evidencia con reglas de negocio.
- [x] Auditoría, seguridad y archivado fail-closed.
- [x] Suspensiones y seguimiento docente.
- [x] Marca NEXORA aplicada respetando la identidad UNCP.
- [x] Componentes visuales consistentes.
- [x] UX/UI con estados de carga, error, vacío y confirmación.
- [x] Movimiento sutil y reducción de movimiento.
- [x] Pruebas automatizadas y análisis estático verdes.

### Falta antes de producción

- [ ] Infraestructura real y secretos.
- [ ] Integraciones externas.
- [ ] Aceptación funcional con datos y dispositivos reales.
- [ ] Seguridad, privacidad y retención aprobadas.
- [ ] Release firmado y rollback.

## 14. Evaluación final propia

**Calificación técnica local: 9/10.**

La solución pasa la evaluación porque compila, tiene pruebas, maneja errores críticos, conserva trazabilidad y presenta una experiencia coherente en web y móvil. No se asigna 10/10 porque el último punto depende de infraestructura, integraciones, seguridad institucional y usuarios reales, no de seguir agregando estilos al código.

**Criterio de cierre recomendado:** no declarar producción hasta que todos los pendientes de las secciones 12 y 13 estén marcados y firmados por la persona responsable.

## 15. Próximo orden de trabajo

1. Preparar un entorno de staging con PostgreSQL real.
2. Ejecutar migraciones y configurar secretos mediante gestor protegido.
3. Probar FCM, SMTP, Drive y backups.
4. Ejecutar la matriz de aceptación por rol.
5. Resolver hallazgos de aceptación.
6. Ejecutar revisión de seguridad y privacidad.
7. Generar release móvil, desplegar staging y validar rollback.
8. Obtener aprobación institucional y publicar producción.
