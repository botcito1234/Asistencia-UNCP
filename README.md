# Control de Asistencia de Practicantes

Sistema de control de asistencia con verificación por GPS, geocerca y evidencia
fotográfica obligatoria. Pensado para ~30 sedes y ~60 practicantes, con una
arquitectura que admite crecer sin rehacerse.

---

## Qué hace

Un practicante marca entrada y salida desde su teléfono. La marcación solo se
registra si **todas** estas condiciones se cumplen, y todas se verifican en el
servidor:

| Condición | Cómo se verifica |
|---|---|
| Usuario autenticado y activo | Token de sesión vivo, validado contra la base en cada petición |
| Dispositivo autorizado | Huella del teléfono coincide con la vinculación activa |
| Hay Internet | No existe modo sin conexión: sin red no hay marcación |
| Dentro de la sede | Distancia **recalculada en el servidor** ≤ radio de la sede |
| GPS suficientemente preciso | Precisión ≤ 70 % del radio (35 m para un radio de 50 m) |
| Ubicación no simulada | Señal `isMocked` del sistema operativo Android |
| Dentro de la ventana horaria | Desde 15 min antes de la hora programada |
| Fotografía tomada con la cámara | Capturada en el momento; no hay acceso a galería |
| Evidencia almacenada íntegra | SHA-256 verificado releyendo el archivo del disco |

Cualquier rechazo genera un **evento de seguridad** con su detalle técnico y
notifica al administrador. Los intentos rechazados **nunca** entran en los
conteos de asistencia.

---

## Componentes

```
Control de asistencia/
├── backend/          API en Node.js + TypeScript + Express + Prisma + PostgreSQL
├── web-admin/        Panel administrativo en React + Vite + Tailwind + Leaflet
├── mobile/           Aplicación Android en Flutter
├── docs/             Arquitectura, API, operación y limitaciones
├── ops/              Respaldo y restauración
├── .frontend-design/ Contrato de identidad visual (BRAND.md)
└── docker-compose.yml
```

| Pieza | Tecnología | Estado |
|---|---|---|
| Backend | Node 22 · TypeScript · Express · Prisma · PostgreSQL 16 | Compila · 164 pruebas en verde |
| Panel web | React 18 · Vite 6 · Tailwind 3 · TanStack Query · Leaflet | Compila |
| App móvil | Flutter 3.47 · Riverpod · Dio · geolocator · camera | Analiza sin avisos · 24 pruebas · APK debug y release compilan |
| Base de datos | PostgreSQL 16 con restricciones, triggers e índices parciales | 2 migraciones |

### Identidad visual

El sistema es de la **Universidad Nacional del Centro del Perú**: su escudo
identifica el ingreso, la cabecera y los reportes. El sistema visual —paleta
azul y tipografía Sora— es el de **Nexora**, el estudio que lo construyó, que
aparece como crédito en el pie.

Las reglas están en [.frontend-design/BRAND.md](.frontend-design/BRAND.md) y los
archivos en `web-admin/public/marca/`, `mobile/assets/marca/` y
`backend/assets/marca/`. La tipografía se sirve desde el propio servidor y se
empaqueta con la aplicación: nada depende de un CDN.

---

## Arranque rápido

### Con Docker (recomendado)

```bash
cp backend/.env.example .env
# Edite .env: complete POSTGRES_PASSWORD y genere JWT_SECRET
#   openssl rand -base64 48

docker compose up -d --build
docker compose exec api npx tsx prisma/seed.ts
```

El seed imprime **una sola vez** las credenciales del administrador inicial.
Anótelas.

- Panel web: <http://localhost:8080>
- API: <http://localhost:4000/api/v1/salud>

### Sin Docker, para desarrollo

```bash
# 1. PostgreSQL 16 corriendo en localhost:5432

# 2. Backend
cd backend
cp .env.example .env          # complete DATABASE_URL y JWT_SECRET
npm install
npx prisma migrate deploy
npm run seed                  # anote las credenciales que imprime
npm run dev                   # http://localhost:4000

# 3. Panel web (otra terminal)
cd web-admin
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173

# 4. Aplicación móvil (otra terminal)
cd mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000
```

> `10.0.2.2` es la dirección con la que el emulador de Android ve el equipo
> anfitrión. Para un teléfono físico use la IP de su equipo en la red local.

---

## Configuración inicial

Todo se hace desde el panel web, en este orden:

1. **Cambiar la contraseña** del administrador (se exige al primer ingreso).
2. **Sedes** → *Registrar sede*. Arrastre el marcador hasta la entrada del local
   y ajuste el radio (50 m por defecto).
3. **Practicantes** → *Registrar practicante*. Asigne sede, área y horario
   semanal. El sistema devuelve una contraseña temporal que se muestra **una
   sola vez**: entréguela por un canal seguro.
4. **Parámetros** → revise ventana de entrada, precisión GPS exigida, hora de
   cierre de jornada y meses de retención.
5. El practicante instala el APK, entra con su DNI, cambia la contraseña, acepta
   la política de privacidad y su teléfono queda vinculado.

---

## Compilar el APK

```bash
cd mobile

# 1. Generar el almacén de claves (una sola vez; consérvelo con cuidado)
keytool -genkey -v -keystore android/asistencia-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias asistencia

# 2. Configurar la firma
cp android/key.properties.example android/key.properties
#    complete storePassword, keyPassword, keyAlias y storeFile

# 3. Compilar
flutter build apk --release \
  --dart-define=API_BASE_URL=https://asistencia.suinstitucion.pe

# APK en: build/app/outputs/flutter-apk/app-release.apk
```

Para reducir el tamaño de descarga, un APK por arquitectura:

```bash
flutter build apk --release --split-per-abi \
  --dart-define=API_BASE_URL=https://asistencia.suinstitucion.pe
```

> Compilar el APK requiere preparar el equipo una vez (componentes del SDK y
> NDK). En Windows hay particularidades ya resueltas en la configuración: ver
> [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) §10.

---

## Credenciales que debe completar el propietario

Ninguna está en el código ni en el APK. Todas viven en el `.env` del servidor.

| Variable | Para qué | Si falta |
|---|---|---|
| `JWT_SECRET` | Firma de tokens de sesión | **Obligatoria.** El servicio no arranca |
| `POSTGRES_PASSWORD` | Acceso a la base de datos | **Obligatoria.** El servicio no arranca |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`<br>`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`<br>`GOOGLE_DRIVE_ROOT_FOLDER_ID` | Archivado histórico en Drive | El archivado se genera y **verifica en disco local**, marcado como pendiente. Nada se borra |
| `FCM_PROJECT_ID`<br>`FCM_CLIENT_EMAIL`<br>`FCM_PRIVATE_KEY` | Notificaciones push del sistema | Las alertas siguen llegando en la app y el panel (canal interno y tiempo real) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Alertas críticas por correo | Las alertas críticas siguen visibles en el panel |

Los pasos exactos para obtener cada credencial están comentados en
[`backend/.env.example`](backend/.env.example).

---

## Reglas de negocio implementadas

### Ventana de entrada

Con entrada programada a las **08:00** y ventana de 15 minutos:

| Momento | Resultado |
|---|---|
| Antes de 07:45 | **Rechazado.** Se informa a partir de qué hora se puede |
| 07:45 – 08:00 | **PUNTUAL** |
| 08:01 en adelante | **TARDANZA**, con los minutos contados |

No hay tolerancia adicional. Una llegada tardía sigue siendo válida durante todo
el día: nunca se bloquea el ingreso por haber pasado la hora.

### Cierre de jornada

A la hora local configurada (23:30 por defecto), para cada sede:

- Con horario y **sin entrada** → `AUSENTE` (falta) + alerta
- Con entrada y **sin salida** → `SALIDA PENDIENTE` + alerta
- Sin horario ese día → `NO LABORABLE`, no genera falta

### Integridad garantizada por la base de datos

No basta con el código de aplicación. Estas reglas están en PostgreSQL:

- `UNIQUE(intern_id, business_date)` — una jornada por persona y día
- `UNIQUE(attendance_day_id, type)` — una entrada y una salida por jornada
- Trigger `fn_salida_exige_entrada` — no hay salida sin entrada previa
- Trigger `fn_evidencia_del_mismo_practicante` — la foto pertenece a quien marca
- Trigger `fn_auditoria_inmutable` — la bitácora no se edita ni se borra
- Índice único parcial — un solo dispositivo **activo** por usuario
- `CHECK` sobre coordenadas, radios, horarios y minutos de tardanza

Además, cada marcación acepta una **clave de idempotencia**: una doble pulsación
o un reintento por corte de red devuelve la marcación ya creada, no una nueva.

### Regularización

El administrador puede corregir una jornada, pero:

- El motivo es **obligatorio** (mínimo 10 caracteres)
- Se conserva el valor anterior, el nuevo, quién lo hizo y cuándo
- **No** puede fabricar una marcación que nunca existió: una marcación incluye
  foto y GPS, y crearla a mano destruiría el valor probatorio del sistema
- **No** puede marcar AUSENTE una jornada con entrada registrada

### Archivado con verificación previa

```
Generar → Verificar hashes → Empaquetar → Subir → Comprobar → Liberar
```

El paso de liberación **solo** se ejecuta si la comprobación remota confirmó que
el archivo existe y coincide en tamaño y checksum. Sin Drive configurado, o si
la verificación falla, el paquete queda en disco y no se borra nada.

---

## Pruebas

```bash
# Backend: 151 pruebas contra PostgreSQL real y efímero
cd backend && npm test

# App móvil: 24 pruebas
cd mobile && flutter test && flutter analyze

# Comprobación de tipos
cd backend && npm run typecheck
cd web-admin && npm run typecheck
```

El arnés del backend levanta un PostgreSQL real y descartable, aplica las
migraciones y ejecuta los casos contra él. Las reglas que viven en la base
(restricciones únicas, triggers, `CHECK`) se prueban donde realmente actúan.

Cobertura de los 26 casos exigidos: ver [docs/PRUEBAS.md](docs/PRUEBAS.md).

---

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Decisiones técnicas y su porqué |
| [docs/API.md](docs/API.md) | Contrato completo de la API |
| [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) | Puesta en producción paso a paso |
| [docs/OPERACION.md](docs/OPERACION.md) | Tareas diarias, respaldo, incidencias |
| [docs/PRUEBAS.md](docs/PRUEBAS.md) | Los 26 casos y dónde se verifica cada uno |
| [docs/LIMITACIONES.md](docs/LIMITACIONES.md) | Qué no cubre el sistema y por qué |

---

## Fuera de alcance, por decisión explícita

- Reconocimiento facial — la estructura de evidencias lo admite (campos
  `faceEmbedding` y `faceEmbeddingModel` reservados), pero no se implementa
- Varias sedes por practicante
- Asistencia sin conexión
- Más de una entrada o salida por día
- Roles adicionales a ADMINISTRADOR y PRACTICANTE
- Importación masiva desde Excel
- Módulos académicos o de ERP
