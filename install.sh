#!/usr/bin/env bash
#
# Septona Signage — one-command installer for a plain Ubuntu 24.04 VM.
#
#   curl -fsSL https://raw.githubusercontent.com/SKuytov/septona-signage/master/install.sh | sudo bash
#
# Installs Node.js 20 LTS + PM2, clones/updates the repo into /opt/septona-signage,
# installs dependencies, starts the app under PM2 on boot, and (optionally) exposes
# it publicly over HTTPS with Tailscale Funnel.
#
# Environment overrides (optional):
#   REPO_URL   git repo to clone         (default: https://github.com/SKuytov/septona-signage.git)
#   APP_DIR    install directory         (default: /opt/septona-signage)
#   PORT       app port                  (default: 3000)
#   ADMIN_KEY  admin key for uploads     (default: unset -> uploads open)
#   NO_TAILSCALE=1  skip Tailscale/Funnel setup
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/SKuytov/septona-signage.git}"
APP_DIR="${APP_DIR:-/opt/septona-signage}"
PORT="${PORT:-3000}"
APP_NAME="septona-signage"

log()  { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m!! %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31mXX %s\033[0m\n" "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Стартирай със sudo/root:  curl ... | sudo bash"

# --- 1. Base packages -------------------------------------------------------
log "Обновяване и базови пакети (curl, git)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates

# --- 2. Node.js 20 LTS ------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  log "Инсталиране на Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  log "Node.js вече е наличен: $(node -v)"
fi
node -v && npm -v

# --- 3. PM2 -----------------------------------------------------------------
if ! command -v pm2 >/dev/null 2>&1; then
  log "Инсталиране на PM2"
  npm install -g pm2
fi

# --- 4. Clone or update the app --------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  log "Обновяване на съществуваща инсталация в $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
else
  log "Клониране на $REPO_URL -> $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

log "Инсталиране на зависимости (production)"
npm install --omit=dev

# --- 5. Optional admin key --------------------------------------------------
if [ -n "${ADMIN_KEY:-}" ]; then
  log "Записване на ADMIN_KEY в .env"
  printf 'ADMIN_KEY=%s\n' "$ADMIN_KEY" > "$APP_DIR/.env"
fi

# --- 6. Start under PM2 (idempotent) ---------------------------------------
log "Стартиране/рестарт под PM2 (порт $PORT)"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  PORT="$PORT" pm2 restart "$APP_NAME" --update-env
else
  PORT="$PORT" pm2 start server/index.js --name "$APP_NAME"
fi
pm2 save
# Enable start-on-boot (systemd). Runs the generated command automatically.
pm2 startup systemd -u root --hp /root >/tmp/pm2startup.txt 2>&1 || true
bash -c "$(grep -E '^sudo ' /tmp/pm2startup.txt | tail -1 | sed 's/^sudo //')" 2>/dev/null || true

# --- 7. Health check --------------------------------------------------------
sleep 2
if curl -fsS "http://localhost:$PORT/healthz" >/dev/null 2>&1; then
  log "Приложението отговаря на http://localhost:$PORT"
else
  warn "Health check не мина още — провери с: pm2 logs $APP_NAME"
fi

# --- 8. Tailscale + Funnel (public HTTPS) -----------------------------------
if [ "${NO_TAILSCALE:-0}" = "1" ]; then
  log "Пропускане на Tailscale (NO_TAILSCALE=1)"
else
  if ! command -v tailscale >/dev/null 2>&1; then
    log "Инсталиране на Tailscale"
    curl -fsSL https://tailscale.com/install.sh | sh
  fi
  if ! tailscale status >/dev/null 2>&1; then
    warn "Tailscale не е свързан. Стартирай ръчно и оторизирай устройството:"
    echo "    sudo tailscale up"
  fi
  log "Публикуване на порт $PORT през HTTPS (Funnel)"
  if tailscale funnel --bg "$PORT" 2>/tmp/funnel.txt; then
    tailscale funnel status || true
  else
    warn "Funnel не тръгна автоматично. Виж по-долу и DEPLOY.md."
    cat /tmp/funnel.txt || true
    echo "    sudo tailscale up        # ако още не е свързан"
    echo "    sudo tailscale funnel --bg $PORT"
  fi
fi

cat <<EOF

\033[1;32m===============================================================\033[0m
 Готово. Полезни адреси и команди:

  Табло (kiosk):   http://<адрес>:$PORT/?kiosk=1&rotate=20
  Качване график:  http://<адрес>:$PORT/admin.html
  Съобщения:       http://<адрес>:$PORT/messages.html

  Публичен HTTPS:  sudo tailscale funnel status
  Логове:          pm2 logs $APP_NAME
  Обновяване:      cd $APP_DIR && ./update.sh
\033[1;32m===============================================================\033[0m
EOF
