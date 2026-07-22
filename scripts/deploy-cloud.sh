#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${FIREBASE_PROJECT_ID:-}"
PUBLIC_URL="${PUBLIC_URL:-https://commande.goa-kombucha.fr}"
REGION="${CLOUD_REGION:-europe-west1}"
SERVICE_NAME="${CLOUD_RUN_SERVICE_NAME:-goa-b2b-api}"
SERVICE_ACCOUNT_NAME="${CLOUD_SERVICE_ACCOUNT_NAME:-goa-api}"
QUEUE="${CLOUD_TASKS_QUEUE:-easybeer-sync}"
FIREBASE_API_KEY="${VITE_FIREBASE_API_KEY:-}"
FIREBASE_APP_ID="${VITE_FIREBASE_APP_ID:-}"
FIREBASE_AUTH_DOMAIN="${VITE_FIREBASE_AUTH_DOMAIN:-${PROJECT_ID}.firebaseapp.com}"
FIREBASE_STORAGE_BUCKET_VALUE="${FIREBASE_STORAGE_BUCKET:-${PROJECT_ID}.firebasestorage.app}"
SMTP_HOST_VALUE="${SMTP_HOST:-}"
SMTP_PORT_VALUE="${SMTP_PORT:-587}"
SMTP_USER_VALUE="${SMTP_USER:-}"
SMTP_FROM_VALUE="${SMTP_FROM:-GOA Kombucha <contact@goa-kombucha.fr>}"
COMMANDE_EST_DEVIS_VALUE="${COMMANDE_EST_DEVIS:-true}"

for command in npm gcloud firebase; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Commande requise introuvable : $command" >&2
    exit 1
  fi
done
exiger() {
  if [[ -z "$2" ]]; then
    echo "Variable requise absente : $1" >&2
    exit 1
  fi
}
exiger FIREBASE_PROJECT_ID "$PROJECT_ID"
exiger VITE_FIREBASE_API_KEY "$FIREBASE_API_KEY"
exiger VITE_FIREBASE_APP_ID "$FIREBASE_APP_ID"
exiger SMTP_HOST "$SMTP_HOST_VALUE"
exiger SMTP_USER "$SMTP_USER_VALUE"
if [[ "$PUBLIC_URL" != https://* ]]; then
  echo "PUBLIC_URL doit commencer par https://" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

echo "Vérifications et builds"
npm run typecheck
npm test
npm --prefix server run build
VITE_FIREBASE_EMULATOR=false \
VITE_FIREBASE_API_KEY="$FIREBASE_API_KEY" \
VITE_FIREBASE_AUTH_DOMAIN="$FIREBASE_AUTH_DOMAIN" \
VITE_FIREBASE_PROJECT_ID="$PROJECT_ID" \
VITE_FIREBASE_APP_ID="$FIREBASE_APP_ID" \
  npm --prefix web run build

SERVICE_ACCOUNT="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
ENV_VARS="FIREBASE_PROJECT_ID=${PROJECT_ID},FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET_VALUE},FIREBASE_EMULATORS=false,AUTH_DISABLED=false,WEB_ORIGIN=${PUBLIC_URL},INVITE_BASE_URL=${PUBLIC_URL}/activer,COMMANDE_EST_DEVIS=${COMMANDE_EST_DEVIS_VALUE},SYNC_INTERVAL_MINUTES=0,CLOUD_TASKS_PROJECT_ID=${PROJECT_ID},CLOUD_TASKS_LOCATION=${REGION},CLOUD_TASKS_QUEUE=${QUEUE},CLOUD_RUN_SERVICE_URL=https://initial.invalid,SMTP_HOST=${SMTP_HOST_VALUE},SMTP_PORT=${SMTP_PORT_VALUE},SMTP_USER=${SMTP_USER_VALUE},SMTP_FROM=${SMTP_FROM_VALUE},CATALOGUE_AUTO_REFRESH_MINUTES=30,PRIX_AUTO_REFRESH_MINUTES=30,PRIX_COMMANDE_MAX_AGE_MINUTES=60,CLIENTS_AUTO_REFRESH_MINUTES=30,COMMANDES_AUTO_REFRESH_MINUTES=10"
SECRET_VARS="EASYBEER_USERNAME=easybeer-username:latest,EASYBEER_PASSWORD=easybeer-password:latest,SMTP_PASS=smtp-password:latest,TASKS_SECRET=tasks-secret:latest,SCHEDULER_SECRET=scheduler-secret:latest"

echo "Déploiement de l'API Cloud Run"
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --service-account "$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 20 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 1800s \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "$SECRET_VARS" \
  --quiet

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"
if [[ -z "$SERVICE_URL" ]]; then
  echo "URL Cloud Run introuvable après déploiement." >&2
  exit 1
fi
gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --update-env-vars "CLOUD_RUN_SERVICE_URL=${SERVICE_URL}" \
  --quiet

echo "Déploiement Firebase Hosting et règles"
firebase deploy --project "$PROJECT_ID" --only hosting,firestore:rules,storage

echo "Vérifications HTTP"
curl --fail --silent --show-error "${SERVICE_URL}/api/health" >/dev/null
curl --fail --silent --show-error "https://${PROJECT_ID}.web.app" >/dev/null
if ! curl --fail --silent --show-error "$PUBLIC_URL" >/dev/null 2>&1; then
  echo "Le domaine personnalisé n'est pas encore actif ; termine sa validation dans Firebase Hosting et OVH."
fi

echo "Déploiement terminé : ${PUBLIC_URL}"
echo "API Cloud Run : ${SERVICE_URL}"
