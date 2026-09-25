# =============================================================================
# Imagen del backend.
#
# Compilacion en dos etapas: la imagen final no lleva TypeScript, ni las
# dependencias de desarrollo, ni el codigo fuente. Solo el JavaScript compilado
# y las dependencias de produccion.
# =============================================================================

# --- Etapa 1: compilacion ----------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Se copian primero los manifiestos para aprovechar la cache de capas: si no
# cambian las dependencias, no se vuelve a instalar.
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# Dependencias de produccion en una carpeta limpia.
RUN npm ci --omit=dev && npx prisma generate


# --- Etapa 2: ejecucion ------------------------------------------------------
FROM node:22-alpine AS runtime

# tini gestiona las senales correctamente: sin el, SIGTERM no llega al proceso
# de Node y el apagado ordenado nunca se ejecuta. su-exec permite bajar de
# privilegios despues de ajustar los permisos del volumen.
RUN apk add --no-cache tini su-exec

ENV NODE_ENV=production
WORKDIR /app

# No se ejecuta como root.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs asistencia

COPY --from=build --chown=asistencia:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=asistencia:nodejs /app/dist ./dist
COPY --from=build --chown=asistencia:nodejs /app/prisma ./prisma
COPY --chown=asistencia:nodejs package*.json ./
# Escudo institucional para la cabecera de los reportes PDF.
COPY --chown=asistencia:nodejs assets ./assets

# Carpeta de evidencias: se monta como volumen, pero debe existir y pertenecer
# al usuario de la aplicacion.
RUN mkdir -p /datos/evidencias && chown -R asistencia:nodejs /datos

COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/entrada.sh

# El contenedor entra como root y baja de privilegios en el arranque, despues de
# ajustar el dueno del volumen: un volumen recien montado pertenece a root y
# pisa los permisos fijados al construir la imagen.
EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrada.sh"]

# Las migraciones se aplican al arrancar: un despliegue nuevo no puede quedar
# con el esquema viejo. `prisma` viaja en dependencies a proposito, para que el
# CLI este dentro de la imagen y el arranque no dependa de poder descargarlo.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
