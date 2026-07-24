#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@82.112.255.95}"
APP_DIR="${APP_DIR:-/var/www/html/isaure/goa-kombucha}"
PUBLIC_URL="${PUBLIC_URL:-https://82.112.255.95}"
AUTH_EMULATOR_URL="${AUTH_EMULATOR_URL:-https://82.112.255.95}"

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Déploie la préproduction GOA Kombucha sur le VPS.

Usage :
  npm run deploy:vps

Variables optionnelles :
  VPS_HOST            Cible SSH (défaut : root@82.112.255.95)
  APP_DIR             Dossier distant (défaut : /var/www/html/isaure/goa-kombucha)
  PUBLIC_URL          URL publique (défaut : https://82.112.255.95)
  AUTH_EMULATOR_URL   URL publique de Firebase Auth (défaut : https://82.112.255.95)

Le script vérifie et construit le projet, synchronise les fichiers, redémarre
PM2, recharge Apache puis teste la page et /api/health. Il configure
COMMANDE_EST_DEVIS=false : les validations créent de vraies commandes Easybeer.
EOF
  exit 0
fi

for command in npm ssh rsync curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Commande locale requise introuvable : $command" >&2
    exit 1
  fi
done

if [[ ! -f server/.env ]]; then
  echo "Fichier requis introuvable : server/.env" >&2
  exit 1
fi

# Un VirtualHost lié à l'adresse exacte prend la priorité sur les sites
# génériques *:443 du VPS et peut leur faire servir le certificat de l'IP.
if grep -Eq '<VirtualHost[[:space:]]+[0-9a-fA-F:.]+:(80|443)>' deploy/goa-kombucha-ip.conf; then
  echo "Configuration Apache dangereuse : les VirtualHosts GOA doivent utiliser *:80 et *:443." >&2
  exit 1
fi

echo "Build et vérifications locales"
npm run typecheck
npm test
npm --prefix server run build
VITE_FIREBASE_EMULATOR=true \
VITE_FIREBASE_AUTH_EMULATOR_URL="$AUTH_EMULATOR_URL" \
  npm --prefix web run build

echo "Préparation des dossiers distants"
ssh "$VPS_HOST" "mkdir -p '$APP_DIR/server' '$APP_DIR/web' '$APP_DIR/deploy' '$APP_DIR/shared' '$APP_DIR/firebase-runtime'"

echo "Envoi de l'application"
rsync -az --delete web/dist/ "$VPS_HOST:$APP_DIR/web/"
rsync -az --delete server/dist/ "$VPS_HOST:$APP_DIR/server/dist/"
rsync -az server/package.json server/package-lock.json server/.env "$VPS_HOST:$APP_DIR/server/"
rsync -az firebase.json firestore.rules storage.rules "$VPS_HOST:$APP_DIR/"
rsync -az deploy/firebase.vps.json "$VPS_HOST:$APP_DIR/"
rsync -az deploy/goa-kombucha-ip.conf "$VPS_HOST:$APP_DIR/deploy/"
rsync -az deploy/goa-ip-certbot.service deploy/goa-ip-certbot.timer "$VPS_HOST:$APP_DIR/deploy/"

if ! ssh "$VPS_HOST" "test -f '$APP_DIR/shared/emulator-data/firebase-export-metadata.json'"; then
  echo "Initialisation des données des émulateurs"
  rsync -az emulator-data/ "$VPS_HOST:$APP_DIR/shared/emulator-data/"
fi

if ssh "$VPS_HOST" "pm2 describe goa-kombucha-emulators >/dev/null 2>&1"; then
  echo "Snapshot à chaud des émulateurs avant redémarrage"
  ssh "$VPS_HOST" "set -e
    cd '$APP_DIR'
    snapshot_dir=\$(mktemp -d '$APP_DIR/shared/emulator-data-next.XXXXXX')
    ./firebase-runtime/node_modules/.bin/firebase emulators:export \"\$snapshot_dir\" \
      --project demo-goa-kombucha --force
    backup_dir='$APP_DIR/shared/emulator-data-before-deploy-'\$(date -u +%Y%m%dT%H%M%SZ)
    mv '$APP_DIR/shared/emulator-data' \"\$backup_dir\"
    mv \"\$snapshot_dir\" '$APP_DIR/shared/emulator-data'"
fi

echo "Installation et configuration distante"
ssh "$VPS_HOST" "set -e
  if ! command -v java >/dev/null 2>&1; then
    echo 'Java 21 est requis sur le VPS (openjdk-21-jre-headless).' >&2
    exit 1
  fi

  cd '$APP_DIR/server'
  npm ci --omit=dev
  sed -i \
    -e 's|^PORT=.*|PORT=8788|' \
    -e 's|^FIREBASE_EMULATORS=.*|FIREBASE_EMULATORS=true|' \
    -e 's|^FIREBASE_PROJECT_ID=.*|FIREBASE_PROJECT_ID=demo-goa-kombucha|' \
    -e 's|^FIREBASE_AUTH_EMULATOR_HOST=.*|FIREBASE_AUTH_EMULATOR_HOST=localhost:9099|' \
    -e 's|^FIRESTORE_EMULATOR_HOST=.*|FIRESTORE_EMULATOR_HOST=localhost:8080|' \
    -e 's|^FIREBASE_STORAGE_EMULATOR_HOST=.*|FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199|' \
    -e 's|^AUTH_DISABLED=.*|AUTH_DISABLED=false|' \
    -e 's|^WEB_ORIGIN=.*|WEB_ORIGIN=$PUBLIC_URL|' \
    -e 's|^INVITE_BASE_URL=.*|INVITE_BASE_URL=$PUBLIC_URL/activer|' \
    -e 's|^COMMANDE_EST_DEVIS=.*|COMMANDE_EST_DEVIS=false|' \
    .env

  if [ ! -x '$APP_DIR/firebase-runtime/node_modules/.bin/firebase' ]; then
    npm install --prefix '$APP_DIR/firebase-runtime' firebase-tools
  fi

  if pm2 describe goa-kombucha-emulators >/dev/null 2>&1; then
    pm2 restart goa-kombucha-emulators --update-env
  else
    cd '$APP_DIR'
    pm2 start '$APP_DIR/firebase-runtime/node_modules/.bin/firebase' \
      --name goa-kombucha-emulators -- \
      emulators:start --project demo-goa-kombucha --config firebase.vps.json \
      --only auth,firestore,storage \
      --import shared/emulator-data --export-on-exit shared/emulator-data
  fi

  export SERVER_HOST=127.0.0.1
  export SYNC_INTERVAL_MINUTES=1440
  if pm2 describe goa-kombucha-api >/dev/null 2>&1; then
    pm2 restart goa-kombucha-api --update-env
  else
    cd '$APP_DIR/server'
    pm2 start dist/index.js --name goa-kombucha-api
  fi
  pm2 save

  a2enmod proxy proxy_http rewrite ssl headers >/dev/null
  cp '$APP_DIR/deploy/goa-kombucha-ip.conf' /etc/apache2/sites-available/goa-kombucha-ip.conf
  cp '$APP_DIR/deploy/goa-ip-certbot.service' /etc/systemd/system/goa-ip-certbot.service
  cp '$APP_DIR/deploy/goa-ip-certbot.timer' /etc/systemd/system/goa-ip-certbot.timer
  systemctl daemon-reload
  systemctl enable --now goa-ip-certbot.timer >/dev/null
  a2ensite goa-kombucha-ip.conf >/dev/null
  apache2ctl configtest
  systemctl reload apache2"

echo "Vérification"
for _attempt in {1..20}; do
  if curl --fail --silent "$PUBLIC_URL" >/dev/null \
    && curl --fail --silent "$PUBLIC_URL/api/health" >/dev/null; then
    echo "Application disponible sur $PUBLIC_URL"
    exit 0
  fi
  sleep 2
done

echo "Le déploiement est terminé, mais l'application ne répond pas correctement." >&2
exit 1
