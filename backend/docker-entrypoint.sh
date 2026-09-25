#!/bin/sh
# Arranque del contenedor.
#
# Cuando se monta un volumen (Railway, Docker, Kubernetes), el punto de montaje
# llega perteneciendo a root, y eso pisa los permisos que se fijaron al
# construir la imagen. La aplicacion, que corre sin privilegios, no puede
# escribir las evidencias y el proceso muere al arrancar.
#
# Por eso el contenedor entra como root, ajusta el dueno de la carpeta de
# evidencias y recien entonces baja de privilegios. Un servicio que guarda
# fotografias como prueba de asistencia no puede quedarse sin poder escribirlas.
set -e

CARPETA="${STORAGE_ROOT:-/datos/evidencias}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$CARPETA"
  chown -R asistencia:nodejs "$CARPETA" 2>/dev/null || \
    echo "AVISO: no se pudo ajustar el dueno de $CARPETA; se continua igual."
  exec su-exec asistencia:nodejs "$@"
fi

# Ya se entro sin privilegios: solo se comprueba que la carpeta sea utilizable.
mkdir -p "$CARPETA" 2>/dev/null || true
if [ ! -w "$CARPETA" ]; then
  echo "ERROR: $CARPETA no es escribible por el usuario $(id -un)." >&2
  echo "       Revise el volumen montado en esa ruta y sus permisos." >&2
  exit 1
fi

exec "$@"
