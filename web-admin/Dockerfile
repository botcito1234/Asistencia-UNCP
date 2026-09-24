# =============================================================================
# Imagen del panel web.
#
# El panel es una aplicacion estatica: se compila y se sirve con nginx. La URL
# de la API se fija en tiempo de compilacion porque Vite la incrusta en el
# bundle.
# =============================================================================

FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Vacia por defecto: el panel llama a /api/v1 del mismo origen, que el proxy
# reenvia al backend. Evita problemas de CORS y no expone la URL interna.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build


FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
