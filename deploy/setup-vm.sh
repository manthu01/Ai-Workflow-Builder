#!/usr/bin/env bash
# One-shot setup of the shared demo VM (Ubuntu 24.04, e.g. Oracle Cloud Always
# Free ARM) for AI Workflow Builder, following M:\Projects\SHARED_VM_SETUP.md:
# Docker, swap, firewall, DuckDNS, the shared Caddy proxy (HTTPS), and the app's
# production stack in public demo mode. Safe to re-run: every step checks first.
#
#   bash setup-vm.sh --domain <name>.duckdns.org [--duckdns-token <token>]
#
# The app is served at https://workflows.<domain>.
set -euo pipefail

DOMAIN=""
DUCKDNS_TOKEN=""
REPO="https://github.com/manthu01/Ai-Workflow-Builder.git"
BRANCH="main"
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --duckdns-token) DUCKDNS_TOKEN="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done
if [ -z "$DOMAIN" ]; then
  echo "usage: bash setup-vm.sh --domain <name>.duckdns.org [--duckdns-token <token>]" >&2
  exit 1
fi

HOST="workflows.$DOMAIN"
APP_DIR="$HOME/apps/ai-workflow-builder"
PROXY_DIR="$HOME/proxy"
DOCKER="sudo docker" # the docker group only applies after logging in again
log() { printf '\n==> %s\n' "$*"; }

log "System packages"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git curl openssl unattended-upgrades fail2ban iptables-persistent

log "Docker"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

log "Swap (8 GB, so image builds don't run out of memory)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 8G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null

log "Firewall: allow 80 and 443 (Oracle's Ubuntu image blocks them)"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
    sudo iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
done
sudo netfilter-persistent save

if [ -n "$DUCKDNS_TOKEN" ]; then
  log "DuckDNS: point $DOMAIN at this server, and keep it updated every 5 minutes"
  sub="${DOMAIN%.duckdns.org}"
  update="https://www.duckdns.org/update?domains=${sub}&token=${DUCKDNS_TOKEN}&ip="
  answer="$(curl -fsS "$update")"
  [ "$answer" = "OK" ] || { echo "DuckDNS update failed (got '$answer'): check the token and domain" >&2; exit 1; }
  (crontab -l 2>/dev/null | grep -v 'duckdns.org/update' || true
   echo "*/5 * * * * curl -fsS '$update' >/dev/null 2>&1") | crontab -
fi

log "Shared reverse proxy (Caddy, automatic HTTPS)"
$DOCKER network inspect demo-proxy >/dev/null 2>&1 || $DOCKER network create demo-proxy
mkdir -p "$PROXY_DIR"
if [ ! -f "$PROXY_DIR/docker-compose.yml" ]; then
  cat >"$PROXY_DIR/docker-compose.yml" <<'EOF'
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    networks: [demo-proxy]
volumes: { caddy_data: {} }
networks: { demo-proxy: { external: true } }
EOF
fi
touch "$PROXY_DIR/Caddyfile"
if ! grep -q "^$HOST " "$PROXY_DIR/Caddyfile"; then
  printf '%s {\n  reverse_proxy awb-web:80\n}\n' "$HOST" >>"$PROXY_DIR/Caddyfile"
fi
$DOCKER compose -f "$PROXY_DIR/docker-compose.yml" up -d
$DOCKER compose -f "$PROXY_DIR/docker-compose.yml" exec -T caddy caddy reload --config /etc/caddy/Caddyfile

log "App source"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

if [ ! -f .env.prod ]; then
  log "Generating .env.prod (random secrets; stays on this server)"
  cp .env.prod.example .env.prod
  for key in POSTGRES_PASSWORD SECRET_KEY INTERNAL_TOKEN LOCAL_RUNNER_TOKEN; do
    sed -i "s|^${key}=\$|${key}=$(openssl rand -hex 32)|" .env.prod
  done
  sed -i "s|https://workflows.example.com|https://${HOST}|g" .env.prod
  chmod 600 .env.prod
fi

log "Building and starting the app (the first build takes several minutes)"
$DOCKER compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

log "Weekly Docker build-cache cleanup"
(sudo crontab -l 2>/dev/null | grep -v 'docker builder prune' || true
 echo "0 4 * * 0 docker builder prune -f --filter until=168h >/dev/null 2>&1") | sudo crontab -

log "Waiting for the app to report healthy"
for _ in $(seq 1 60); do
  if $DOCKER exec awb-web wget -qO- http://api:8787/api/health 2>/dev/null | grep -q '"ok":true,"postgres"'; then
    echo "app healthy"
    break
  fi
  sleep 5
done

log "Checking https://$HOST (the first certificate can take a minute)"
for _ in $(seq 1 24); do
  if curl -fsS "https://$HOST/api/health" >/dev/null 2>&1; then
    echo "live: https://$HOST"
    exit 0
  fi
  sleep 5
done
echo "Not reachable over HTTPS yet. Check that ports 80 and 443 are open in the Oracle"
echo "security list and that $DOMAIN points at this server, then re-run this script."
exit 1
