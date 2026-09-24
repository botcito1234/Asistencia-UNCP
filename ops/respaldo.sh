#!/usr/bin/env bash
# =============================================================================
# Respaldo completo del sistema.
#
#   ./ops/respaldo.sh [carpeta_destino]
#
# Genera tres cosas, que juntas permiten reconstruir el sistema entero:
#   1. Volcado de la base de datos (estructura y datos).
#   2. Copia de las evidencias fotograficas.
#   3. Un manifiesto con hashes, para comprobar despues que la copia esta integra.
#
# Se programa con cron, por ejemplo todos los dias a las 02:00:
#   0 2 * * * /ruta/al/proyecto/ops/respaldo.sh /mnt/respaldos >> /var/log/asistencia-respaldo.log 2>&1
# =============================================================================
set -euo pipefail

DESTINO="${1:-./ops/backup}"
MARCA="$(date +%Y%m%d_%H%M%S)"
CARPETA="${DESTINO}/asistencia_${MARCA}"
CONTENEDOR_DB="${CONTENEDOR_DB:-asistencia-db}"
USUARIO_DB="${POSTGRES_USER:-asistencia}"
NOMBRE_DB="${POSTGRES_DB:-asistencia}"
VOLUMEN_EVIDENCIAS="${VOLUMEN_EVIDENCIAS:-asistencia_datos_evidencias}"

echo "[$(date '+%H:%M:%S')] Iniciando respaldo en ${CARPETA}"
mkdir -p "${CARPETA}"

# --- 1. Base de datos --------------------------------------------------------
echo "[$(date '+%H:%M:%S')] Volcando la base de datos..."
docker exec "${CONTENEDOR_DB}" pg_dump \
  --username="${USUARIO_DB}" \
  --dbname="${NOMBRE_DB}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  > "${CARPETA}/base_datos.dump"

# --- 2. Evidencias fotograficas ---------------------------------------------
echo "[$(date '+%H:%M:%S')] Copiando evidencias..."
docker run --rm \
  -v "${VOLUMEN_EVIDENCIAS}:/origen:ro" \
  -v "$(cd "${CARPETA}" && pwd):/destino" \
  alpine:3.20 \
  tar czf /destino/evidencias.tar.gz -C /origen .

# --- 3. Manifiesto de integridad --------------------------------------------
echo "[$(date '+%H:%M:%S')] Calculando hashes..."
(
  cd "${CARPETA}"
  sha256sum base_datos.dump evidencias.tar.gz > manifiesto.sha256
  {
    echo "fecha=${MARCA}"
    echo "base_datos_bytes=$(stat -c%s base_datos.dump)"
    echo "evidencias_bytes=$(stat -c%s evidencias.tar.gz)"
  } > informacion.txt
)

TAMANO=$(du -sh "${CARPETA}" | cut -f1)
echo "[$(date '+%H:%M:%S')] Respaldo terminado: ${CARPETA} (${TAMANO})"

# --- 4. Rotacion -------------------------------------------------------------
# Se conservan 30 dias. Ajuste RETENCION_DIAS si necesita otro plazo.
RETENCION_DIAS="${RETENCION_DIAS:-30}"
echo "[$(date '+%H:%M:%S')] Eliminando respaldos con mas de ${RETENCION_DIAS} dias..."
find "${DESTINO}" -maxdepth 1 -type d -name 'asistencia_*' -mtime "+${RETENCION_DIAS}" -exec rm -rf {} + 2>/dev/null || true

echo "[$(date '+%H:%M:%S')] Listo."
