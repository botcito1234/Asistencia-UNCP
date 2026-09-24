# Despliegue en producción

De un servidor recién creado al sistema funcionando.

---

## 1. Requisitos

Para 30 sedes y 60 practicantes:

| Recurso | Mínimo | Recomendado |
|---|---|---|
| CPU | 2 núcleos | 2 núcleos |
| RAM | 2 GB | 4 GB |
| Disco | 20 GB | 40 GB SSD |
| Sistema | Ubuntu 22.04 / Debian 12 | Ubuntu 24.04 |

**Disco:** cada foto comprimida pesa ~120 KB. 60 practicantes × 2 marcaciones ×
22 días ≈ 2 640 fotos/mes ≈ **320 MB/mes**. Con 6 meses de retención, el
almacenamiento operativo se estabiliza en torno a **2 GB**.

---

## 2. Preparar el servidor

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

PostgreSQL (5432), la API (4000) y el panel (8080) se publican solo en
`127.0.0.1`: nada de eso queda expuesto a Internet.

---

## 3. Configurar

```bash
sudo mkdir -p /opt/asistencia && sudo chown $USER:$USER /opt/asistencia
cd /opt/asistencia            # copie aquí el proyecto
cp backend/.env.example .env
chmod 600 .env
nano .env
```

Valores obligatorios:

```bash
NODE_ENV=production
JWT_SECRET=<openssl rand -base64 48>
POSTGRES_PASSWORD=<contraseña fuerte>
PUBLIC_BASE_URL=https://asistencia.suinstitucion.pe   # https obligatorio en producción
WEB_ADMIN_ORIGIN=https://asistencia.suinstitucion.pe
TRUST_PROXY=true
APP_TIMEZONE=America/Lima

SEED_ADMIN_DNI=12345678
SEED_ADMIN_NAME=Nombre del Administrador
SEED_ADMIN_PASSWORD=          # vacío: se genera una aleatoria y se imprime una vez
```

El servicio **se niega a arrancar** en producción si `JWT_SECRET` conserva el
valor de ejemplo o si `PUBLIC_BASE_URL` no usa https.

---

## 4. Levantar

```bash
docker compose up -d --build
docker compose ps                                   # las tres en "healthy"
docker compose exec api npx tsx prisma/seed.ts      # anote las credenciales
```

Las migraciones se aplican solas al arrancar la API.

---

## 5. HTTPS con Caddy

Caddy obtiene y renueva el certificado solo.

```bash
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

```caddy
asistencia.suinstitucion.pe {
    encode gzip

    @sse path /api/v1/notificaciones/stream
    handle @sse {
        reverse_proxy 127.0.0.1:4000 {
            flush_interval -1
            transport http {
                read_timeout 24h
            }
        }
    }

    handle /api/* {
        reverse_proxy 127.0.0.1:4000
    }

    handle {
        reverse_proxy 127.0.0.1:8080
    }

    request_body {
        max_size 12MB
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "no-referrer"
        -Server
    }
}
```

```bash
sudo systemctl reload caddy
curl https://asistencia.suinstitucion.pe/api/v1/salud
```

El bloque `@sse` es imprescindible: sin él el proxy acumula el canal en tiempo
real y el panel deja de recibir novedades.

---

## 5-bis. Alternativa gestionada: Vercel + Railway + Neon

Sirve si no se quiere administrar un servidor. El panel es estático y va en
Vercel; la API en Railway; PostgreSQL en Neon. Hay **tres condiciones** que no
son opcionales.

### Condición 1: volumen persistente en Railway

Las fotografías se guardan en el sistema de archivos, no en la base de datos.
El contenedor de Railway tiene disco **efímero**: sin un volumen, cada
despliegue borra todas las evidencias.

En el servicio de Railway: **Variables → Volumes → Add volume**, montarlo en
`/datos` y poner `STORAGE_ROOT=/datos/evidencias`. Con 60 practicantes son unos
260 MB al mes; con la retención de 6 meses, 5 GB dan holgura.

### Condición 2: las dos conexiones de Neon

Neon pone un agrupador delante de PostgreSQL. La aplicación usa la conexión
agrupada; `prisma migrate` necesita la directa, porque el agrupador no admite
las sentencias de esquema.

```bash
DATABASE_URL=postgresql://...@ep-xxx-pooler.region.aws.neon.tech/asistencia?sslmode=require
DIRECT_DATABASE_URL=postgresql://...@ep-xxx.region.aws.neon.tech/asistencia?sslmode=require
```

La diferencia es el `-pooler` del nombre. Con un PostgreSQL propio, ambas valen
lo mismo.

### Condición 3: la API no puede dormirse

El cierre de jornada corre a las 23:30 y el archivado de madrugada, dentro del
propio proceso. Si el plan suspende el servicio por inactividad, **esas tareas
no se ejecutan**: las faltas del día no quedan registradas y las salidas
pendientes no se cierran. Hay que usar un plan que mantenga el servicio
despierto, o mover esas tareas a un programador externo que golpee
`POST /api/v1/asistencia/cerrar-jornada`.

### Pasos

**Neon**

1. Crear proyecto y base de datos `asistencia`.
2. Copiar las dos cadenas de conexión (agrupada y directa).

**Railway**

1. Nuevo proyecto → **Deploy from GitHub repo** → elegir el repositorio.
2. **Root Directory**: `backend`. Railway detecta el `Dockerfile`.
3. Añadir el volumen (condición 1).
4. Variables de entorno:

```bash
DATABASE_URL=<cadena agrupada de Neon>
DIRECT_DATABASE_URL=<cadena directa de Neon>
JWT_SECRET=<openssl rand -base64 48>
STORAGE_ROOT=/datos/evidencias
PUBLIC_BASE_URL=https://<tu-api>.up.railway.app
WEB_ADMIN_ORIGIN=https://<tu-panel>.vercel.app
NODE_ENV=production
ENABLE_CRON=true
APP_TIMEZONE=America/Lima
```

5. Aplicar las migraciones una vez, desde la máquina local:

```bash
cd backend
DATABASE_URL="<agrupada>" DIRECT_DATABASE_URL="<directa>" npx prisma migrate deploy
DATABASE_URL="<agrupada>" DIRECT_DATABASE_URL="<directa>" npm run seed
```

   El seed imprime la contraseña del administrador **una sola vez**.

**Vercel**

1. **Add New → Project** → el mismo repositorio.
2. **Root Directory**: `web-admin`. El `vercel.json` ya define la compilación y
   las reescrituras que necesita una aplicación de una sola página.
3. Variable de entorno: `VITE_API_BASE_URL=https://<tu-api>.up.railway.app`
4. Desplegar, copiar la URL y volver a Railway para poner esa URL exacta en
   `WEB_ADMIN_ORIGIN`. Sin eso el navegador bloquea las peticiones por CORS.

**Aplicación móvil**

```bash
cd mobile
flutter build apk --release --dart-define=API_BASE_URL=https://<tu-api>.up.railway.app
```

La URL queda dentro del APK: si cambia el dominio, hay que recompilar y
reinstalar en todos los teléfonos. Conviene usar un dominio propio
(`asistencia.uncp.edu.pe`) apuntando a Railway desde el principio, para no
depender del subdominio que asigna la plataforma.

### Qué se pierde frente al servidor propio

| | Servidor propio | Vercel + Railway + Neon |
|---|---|---|
| Respaldos | `ops/respaldo.sh`, con las fotos | Neon respalda la base; las fotos dependen del volumen, que hay que respaldar aparte |
| Evidencias | Disco del servidor | Volumen de Railway: sobrevive a los despliegues, pero no se replica |
| Costo | Un VPS | Neon y Vercel tienen plan gratuito; Railway cobra por uso |
| Control de datos | Completo | Los datos —incluidas fotografías de personas— quedan en infraestructura de terceros, fuera del país |

Ese último punto conviene consultarlo con la universidad antes de decidir:
son datos personales de practicantes, con fotografía y ubicación.

---

## 6. Google Drive (opcional)

Sin esto el archivado **funciona igual**: genera y verifica el paquete en disco y
lo marca como pendiente. Nunca borra nada sin verificar la copia remota.

1. <https://console.cloud.google.com> → crear proyecto.
2. Habilitar **Google Drive API**.
3. Crear **cuenta de servicio** → descargar la clave JSON. No hace falta cliente
   OAuth, ni pantalla de consentimiento, ni URI de redirección: el servidor se
   autentica solo, sin que nadie apruebe nada.
4. En Drive, crear una **unidad compartida** (no una carpeta de «Mi unidad») y
   agregar el `client_email` de la cuenta de servicio como **Administrador de
   contenido**.
5. Copiar el ID de la unidad, o de una carpeta dentro de ella, desde la URL.

> **Por qué una unidad compartida y no una carpeta normal.** Una cuenta de
> servicio no tiene espacio propio en Drive: su cuota es cero. Si sube a una
> carpeta de «Mi unidad» compartida con ella, el archivo queda a su nombre y
> Google lo rechaza con *«Service Accounts do not have storage quota»*, aunque
> los permisos sean correctos. En una unidad compartida los archivos pertenecen
> a la unidad, no a quien los sube, y el problema desaparece.
>
> Si la organización no puede crear unidades compartidas, la alternativa es
> delegación de dominio suplantando a un usuario real, que es bastante más
> trabajo de configurar.

```bash
GOOGLE_DRIVE_ENABLED=true
GOOGLE_SERVICE_ACCOUNT_EMAIL=asistencia@proyecto.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n
GOOGLE_DRIVE_ROOT_FOLDER_ID=1a2B3c4D5e6F7g8H9i0J
GOOGLE_DRIVE_SHARED_DRIVE_ID=0AB1c2D3e4F5g6H7i8J
```

La clave privada va en **una sola línea**, con los saltos como `
` literales.

### Alternativa: autorizar con una cuenta de usuario

Si la organización no puede crear unidades compartidas —hace falta ser
superadministrador, y no todas las ediciones de Workspace las incluyen—, la
salida es que el archivado actúe en nombre de una **persona real**. Los archivos
quedan a su nombre y consumen el espacio de la organización, no la cuota cero de
la cuenta de servicio.

1. En el mismo proyecto de Google Cloud: **APIs y servicios → Pantalla de
   consentimiento de OAuth** → tipo de usuario **Interno**. Interno importa: una
   aplicación externa en modo de prueba recibe tokens que caducan a los 7 días.
2. **Credenciales → Crear credenciales → ID de cliente de OAuth** → tipo
   **Aplicación de escritorio**. Con ese tipo no hay que registrar ninguna URI
   de redirección.
3. Ejecutar una sola vez, en la computadora de quien autoriza:

```bash
node ops/autorizar-drive.mjs "<ID_DE_CLIENTE>" "<SECRETO>"
```

   Se abre el navegador, la persona aprueba y la terminal imprime las líneas
   para el `.env`:

```bash
GOOGLE_DRIVE_ENABLED=true
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REFRESH_TOKEN=1//...
GOOGLE_DRIVE_ROOT_FOLDER_ID=<carpeta de destino, en el Drive de esa persona>
```

El token de refresco **no caduca por tiempo**, pero deja de servir si esa persona
revoca el acceso en <https://myaccount.google.com/permissions>, cambia su
contraseña o se desactiva su cuenta. Conviene usar una cuenta institucional
—no la de alguien que pueda irse de la organización— y tratar el token como una
contraseña.

Si hay credenciales de las dos formas, el servidor usa la del usuario.

```bash
docker compose up -d api
```

Verifique en el panel: **Archivado → Google Drive** debe decir *Conectado*.

---

## 7. Notificaciones push (opcional)

Sin esto las alertas siguen llegando dentro de la app y del panel.

1. <https://console.firebase.google.com> → crear proyecto.
2. Añadir app Android con paquete `pe.edu.personalclass.asistencia_app`.
3. Descargar `google-services.json` → `mobile/android/app/`.
4. *Cuentas de servicio* → **Generar nueva clave privada**.

```bash
PUSH_ENABLED=true
FCM_PROJECT_ID=su-proyecto
FCM_CLIENT_EMAIL=firebase-adminsdk-xxx@su-proyecto.iam.gserviceaccount.com
FCM_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
```

> El backend ya envía push (FCM HTTP v1) y la app ya registra tokens mediante
> `POST /auth/push-token`. Lo que falta para que el teléfono **reciba** el push
> es añadir `firebase_core` y `firebase_messaging` a la app y compilar con el
> `google-services.json`. Ver [LIMITACIONES.md](LIMITACIONES.md).

---

## 8. Correo para alertas críticas (opcional)

```bash
SMTP_ENABLED=true
SMTP_HOST=smtp.suproveedor.com
SMTP_PORT=587
SMTP_USER=alertas@suinstitucion.pe
SMTP_PASSWORD=<contraseña de aplicación>
SMTP_FROM=alertas@suinstitucion.pe
ALERT_EMAIL_RECIPIENTS=coordinacion@suinstitucion.pe
```

---

## 9. Respaldo automático

```bash
crontab -e
```

```cron
0 2 * * * /opt/asistencia/ops/respaldo.sh /mnt/respaldos >> /var/log/asistencia-respaldo.log 2>&1
```

Genera volcado de base, copia de evidencias y manifiesto SHA-256; rota los
respaldos de más de 30 días. **Pruebe la restauración una vez** antes de
necesitarla:

```bash
./ops/restaurar.sh /mnt/respaldos/asistencia_20260918_020000
```

---

## 10. Compilar el APK de producción

### Preparar el equipo de compilación

Requiere Android Studio (trae el JDK) y estos componentes del SDK. Las versiones
recientes de Android Studio reemplazaron `sdkmanager` por la **Android CLI**, que
ya no acepta nombres con `;`; por eso Gradle no logra instalar solo lo que falta
y hay que hacerlo a mano **una vez**:

```bash
ANDROID="$LOCALAPPDATA/Android/Sdk/cmdline-tools/latest/bin/android.exe"
"$ANDROID" sdk install platform-tools platforms/android-36 build-tools/36.0.0 ndk/28.2.13676358

flutter config --android-sdk "%LOCALAPPDATA%\Android\Sdk"
flutter config --jdk-dir "C:\Program Files\Android\Android Studio\jbr"
```

El NDK 28.2 lo exige Flutter 3.47 aunque la app no tenga código nativo propio
(ocupa ~2 GB). `flutter doctor` puede seguir diciendo *Android license status
unknown*: es porque no reconoce la nueva CLI, y no impide compilar si existe
`Sdk/licenses/android-sdk-license`.

Problemas de Windows ya resueltos en la configuración del proyecto:

| Síntoma | Causa | Solución aplicada |
|---|---|---|
| `this and base files have different roots` | Caché de paquetes en `C:` y proyecto en otra unidad | `kotlin.incremental=false` en `android/gradle.properties` |
| `Daemon compilation failed` con poca RAM | La plantilla reserva 8 GB para Gradle | `-Xmx3G` y Kotlin con 1,5 GB |
| `Inconsistent JVM Target Compatibility (17 y 25)` | Android Studio trae JDK 25 | `jvmTarget = JVM_17` en `app/build.gradle.kts` |
| `Cannot attach type annotations ... CallbackToFutureAdapter` | CameraX antiguo con JDK 25 | `camera: ^0.12.1` |

### Compilar

```bash
cd mobile
keytool -genkey -v -keystore android/asistencia-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias asistencia
cp android/key.properties.example android/key.properties   # complete los valores

flutter build apk --release \
  --dart-define=API_BASE_URL=https://asistencia.suinstitucion.pe
```

Resultado: `build/app/outputs/flutter-apk/app-release.apk`.

> **Guarde `asistencia-release.jks` y sus contraseñas fuera del repositorio y
> con respaldo.** Sin él no podrá publicar actualizaciones de la misma app.

Para Google Play use `flutter build appbundle`.

---

## 11. Comprobación final

| # | Comprobación | Cómo |
|---|---|---|
| 1 | API viva | `/api/v1/salud` → `"estado":"operativo"` |
| 2 | Login admin | Entrar y cambiar la contraseña inicial |
| 3 | Sede | Registrar, ajustar marcador y radio |
| 4 | Practicante | Registrar con horario; anotar contraseña temporal |
| 5 | App | El practicante entra; su teléfono queda vinculado |
| 6 | Marcación real | Dentro de la sede, entrada completa con foto |
| 7 | Tiempo real | El tablero la refleja en segundos; cabecera *En vivo* |
| 8 | Dispositivo único | Otro teléfono es rechazado y genera alerta crítica |
| 9 | Reportes | Descargar un Excel y un PDF |
| 10 | Cierre | `POST /asistencia/cerrar-jornada` sobre una fecha pasada |
| 11 | Respaldo | Ejecutar `ops/respaldo.sh` y revisar el manifiesto |

---

## 12. Actualizar

```bash
cd /opt/asistencia
./ops/respaldo.sh /mnt/respaldos      # siempre antes
git pull
docker compose up -d --build
docker compose logs -f api            # confirmar que las migraciones aplicaron
```

---

## 13. Diagnóstico

| Síntoma | Dónde mirar | Causa habitual |
|---|---|---|
| La API no arranca | `docker compose logs api` | `JWT_SECRET` de ejemplo o `PUBLIC_BASE_URL` sin https |
| Error de base | `docker compose logs db` | Contraseña de `.env` distinta a la del volumen |
| Panel sin datos | Consola del navegador | `WEB_ADMIN_ORIGIN` no coincide con el dominio |
| App no conecta | Registros de la API | `API_BASE_URL` incorrecta al compilar el APK |
| Panel sin *En vivo* | — | El proxy hace buffering del SSE |
| No cierran jornadas | `docker compose logs api` | `ENABLE_CRON=false` |
| Fotos no visibles | `docker volume ls` | Volumen de evidencias no montado |
