#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${FIREBASE_PROJECT_ID:-}"
REGION="${CLOUD_REGION:-europe-west1}"
QUEUE="${CLOUD_TASKS_QUEUE:-easybeer-sync}"
SERVICE_ACCOUNT_NAME="${CLOUD_SERVICE_ACCOUNT_NAME:-goa-api}"
STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-${PROJECT_ID}.firebasestorage.app}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "FIREBASE_PROJECT_ID est requis." >&2
  exit 1
fi
if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud est requis : https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

SERVICE_ACCOUNT="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Activation des API Google Cloud"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudtasks.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  --project "$PROJECT_ID"

if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --display-name "GOA B2B API" \
    --project "$PROJECT_ID"
fi

echo "Attribution des droits applicatifs au backend"
for role in \
  roles/datastore.user \
  roles/firebaseauth.admin \
  roles/cloudtasks.enqueuer \
  roles/logging.logWriter
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${SERVICE_ACCOUNT}" \
    --role "$role" \
    --condition=None \
    --quiet >/dev/null
done

if ! gcloud storage buckets describe "gs://${STORAGE_BUCKET}" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Bucket Firebase introuvable : gs://${STORAGE_BUCKET}" >&2
  echo "Crée Storage dans Firebase ou fournis FIREBASE_STORAGE_BUCKET." >&2
  exit 1
fi
gcloud storage buckets add-iam-policy-binding "gs://${STORAGE_BUCKET}" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role roles/storage.objectAdmin \
  --project "$PROJECT_ID" \
  --quiet >/dev/null

if ! gcloud tasks queues describe "$QUEUE" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud tasks queues create "$QUEUE" --location "$REGION" --project "$PROJECT_ID"
fi
gcloud tasks queues update "$QUEUE" \
  --location "$REGION" \
  --project "$PROJECT_ID" \
  --max-concurrent-dispatches 1 \
  --max-attempts 3 \
  --min-backoff 300s \
  --max-backoff 1800s

echo "Création des conteneurs de secrets (sans valeur)"
for secret in easybeer-username easybeer-password smtp-password tasks-secret scheduler-secret; do
  if ! gcloud secrets describe "$secret" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$secret" --replication-policy automatic --project "$PROJECT_ID"
  fi
  gcloud secrets add-iam-policy-binding "$secret" \
    --member "serviceAccount:${SERVICE_ACCOUNT}" \
    --role roles/secretmanager.secretAccessor \
    --project "$PROJECT_ID" \
    --quiet >/dev/null
done

echo
echo "Socle Google Cloud prêt pour ${PROJECT_ID}."
echo "Ajoute maintenant une version à chacun des cinq secrets avant le premier déploiement."
echo "Compte de service Cloud Run : ${SERVICE_ACCOUNT}"
