#!/usr/bin/env bash
# =============================================================================
# Prepara un servidor Ubuntu recien creado para alojar la API.
#
# Pensado para una instancia Always Free de Oracle Cloud (Ampere ARM o AMD),
# pero sirve para cualquier Ubuntu 22.04 o 24.04.
#
#   sudo bash preparar-servidor.sh
#
# Deja instalado Docker, abre 80 y 443, y ajusta la zona horaria. NO despliega
# nada: eso es el paso siguiente, con docker compose.
# =============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Ejecutelo con sudo." >&2
  exit 1
fi

ZONA_HORARIA="${ZONA_HORARIA:-America/Lima}"

echo "==> Actualizando el sistema"
apt-get update -qq
apt-get upgrade -y -qq

echo "==> Zona horaria: $ZONA_HORARIA"
timedatectl set-timezone "$ZONA_HORARIA"
# El cierre de jornada depende de la hora: sin NTP, las marcaciones se
# desplazan silenciosamente.
timedatectl set-ntp true

echo "==> Instalando Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

USUARIO="${SUDO_USER:-ubuntu}"
if id "$USUARIO" >/dev/null 2>&1; then
  usermod -aG docker "$USUARIO"
  echo "    $USUARIO agregado al grupo docker (cierre y vuelva a entrar)"
fi

echo "==> Abriendo los puertos 80 y 443"
# Las imagenes de Oracle traen reglas de iptables que descartan todo menos el
# 22. Es el tropiezo clasico: el puerto se abre en la consola web, el servidor
# sigue sin responder, y no hay ningun mensaje que lo explique.
if command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save
  else
    apt-get install -y -qq iptables-persistent
    netfilter-persistent save
  fi
fi

echo "==> Espacio de intercambio"
# Una instancia pequena se queda sin memoria al compilar la imagen.
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    2 GB de swap activados"
fi

echo
echo "Servidor listo."
echo
echo "Falta abrir 80 y 443 TAMBIEN en la consola de Oracle:"
echo "  Networking -> Virtual Cloud Networks -> su VCN -> Security Lists"
echo "  -> Add Ingress Rules: 0.0.0.0/0, TCP, puertos 80 y 443"
echo
echo "Despues:"
echo "  git clone https://github.com/botcito1234/Asistencia-UNCP.git"
echo "  cd Asistencia-UNCP/ops/despliegue"
echo "  cp entorno.ejemplo entorno.env   # y complete los valores"
echo "  export DOMINIO=asistencia.suinstitucion.pe"
echo "  docker compose -f docker-compose.produccion.yml up -d --build"
