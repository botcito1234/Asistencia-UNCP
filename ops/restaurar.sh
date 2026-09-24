#!/usr/bin/env bash
# =============================================================================
# Restauracion desde un respaldo.
#
#   ./ops/restaurar.sh /ruta/al/respaldo/asistencia_20260918_020000
#
# ATENCION: reemplaza la base de datos y las evidencias actuales. El script
# exige confirmacion explicita antes de tocar nada.
# =============================================================================
set -euo pipefail

ORIGEN="${1:-}"
CONTENEDOR_DB="${CONTENEDOR_DB:-asistencia-db}"
USUARIO_DB="${POSTGRES_USER:-asistencia}"
NOMBRE_DB="${POSTGRES_DB:-asistencia}"
VOLUMEN_EVIDENCIAS="${VOLUMEN_EVIDENCIAS:-asistencia_datos_evidencias}"

if [[ -z "${ORIGEN}" ]]; then
  echo "Uso: $0 /ruta/al/respaldo/asistencia_AAAAMMDD_HHMMSS"
  exit 1
fi

if [[ ! -f "${ORIGEN}/base_datos.dump" ]]; then
  echo "ERROR: no se encontro ${ORIGEN}/base_datos.dump"
  exit 1
fi

# --- 1. Verificacion de integridad ANTES de tocar nada ----------------------
echo "Verificando la integridad del respaldo..."
if [[ -f "${ORIGEN}/manifiesto.sha256" ]]; then
  ( cd "${ORIGEN}" && sha256sum -c manifiesto.sha256 ) || {
    echo "ERROR: el respaldo esta corrupto. No se restaura nada."
    exit 1
  }
  echo "Integridad correcta."
else
  echo "AVISO: el respaldo no incluye manifiesto; no se puede verificar."
fi

# --- 2. Confirmacion ---------------------------------------------------------
echo ""
echo "Se va a REEMPLAZAR la base de datos '${NOMBRE_DB}' y todas las evidencias."
echo "Esta operacion no se puede deshacer."
read -r -p "Escriba RESTAURAR para continuar: " confirmacion
if [[ "${confirmacion}" != "RESTAURAR" ]]; then
  echo "Cancelado."
  exit 0
fi

# --- 3. Base de datos --------------------------------------------------------
echo "Deteniendo la API para evitar escrituras durante la restauracion..."
docker compose stop api || true

echo "Restaurando la base de datos..."
docker exec -i "${CONTENEDOR_DB}" pg_restore \
  --username="${USUARIO_DB}" \
  --dbname="${NOMBRE_DB}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  < "${ORIGEN}/base_datos.dump"

# --- 4. Evidencias -----------------------------------------------------------
if [[ -f "${ORIGEN}/evidencias.tar.gz" ]]; then
  echo "Restaurando evidencias..."
  docker run --rm \
    -v "${VOLUMEN_EVIDENCIAS}:/destino" \
    -v "$(cd "${ORIGEN}" && pwd):/origen:ro" \
    alpine:3.20 \
    sh -c "rm -rf /destino/* && tar xzf /origen/evidencias.tar.gz -C /destino"
fi

echo "Reiniciando la API..."
docker compose start api

echo ""
echo "Restauracion terminada."
echo "Comprobaciones recomendadas:"
echo "  1. Abrir el panel y revisar el tablero del dia."
echo "  2. Abrir una jornada y comprobar que la fotografia se ve."
echo "  3. Revisar Archivado > Integridad para el ultimo mes."
