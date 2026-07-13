#!/usr/bin/env bash
#
# Septona Signage — pull latest code and restart.
# Run from the install directory:  ./update.sh
#
set -euo pipefail
APP_NAME="septona-signage"
cd "$(dirname "$0")"

echo "==> git pull"
git pull --ff-only

echo "==> npm install (production)"
npm install --omit=dev

echo "==> pm2 restart"
pm2 restart "$APP_NAME" --update-env
pm2 save

echo "==> Готово. Логове: pm2 logs $APP_NAME"
