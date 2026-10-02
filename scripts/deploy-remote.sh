#!/usr/bin/env bash
# Runs ON THE HOST over SSH (piped by scripts/deploy.mjs). Never starts the Node process
# itself: the app is started/restarted only through the CloudLinux Node.js Selector (panel).
# Expects: APP_ROOT (relative to $HOME), NODE_BIN, ARCHIVE (relative to $HOME).
set -euo pipefail

APP="$HOME/$APP_ROOT"
ARCHIVE_PATH="$HOME/$ARCHIVE"
STAGE="$(mktemp -d "$HOME/tmp/rekordy-release.XXXXXX")"
trap 'rm -rf "$STAGE" "$ARCHIVE_PATH"' EXIT

echo "==> Unpacking release"
tar -xzf "$ARCHIVE_PATH" -C "$STAGE"

if [ ! -d "$APP" ]; then
  echo "ERROR: $APP does not exist. Create the Node.js app in the hosting panel first (docs/WDROZENIE.md)." >&2
  exit 2
fi
if [ ! -f "$APP/.env" ]; then
  echo "ERROR: $APP/.env is missing. Create it first (docs/WDROZENIE.md)." >&2
  exit 2
fi

echo "==> Copying files to $APP (keeping .env and storage/)"
rsync -a --delete "$STAGE/dist/" "$APP/dist/"
rsync -a --delete "$STAGE/drizzle/" "$APP/drizzle/"
for file in app.js package.json build-info.json .env.example; do
  cp "$STAGE/$file" "$APP/$file"
done
mkdir -p "$APP/storage"
chmod 600 "$APP/.env"

cd "$APP"
echo "==> Running migrations"
"$NODE_BIN" dist/tools.cjs migrate

echo "==> Restarting the app via the Node.js selector"
if ! cloudlinux-selector restart --json --interpreter nodejs --app-root "$APP_ROOT"; then
  echo "Selector restart failed, falling back to Passenger tmp/restart.txt"
  mkdir -p tmp && touch tmp/restart.txt
fi
echo
echo "==> Deployed: $(cat build-info.json | tr -d '\n ')"
