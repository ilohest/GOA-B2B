#!/usr/bin/env bash
set -euo pipefail

# Sauvegarde hebdomadaire des comptes Firebase Authentication, côté cloud.
#
# Crée un bucket dédié, un compte de service en lecture seule sur Auth, un job
# Cloud Run qui exporte et chiffre les comptes, et un déclencheur hebdomadaire.
# Idempotent : relançable sans créer de doublon.
#
# AGE_RECIPIENT est une clé PUBLIQUE : rien dans le cloud ne permet de
# déchiffrer les sauvegardes. La clé privée doit rester hors ligne.

PROJECT_ID="${FIREBASE_PROJECT_ID:-}"
REGION="${CLOUD_REGION:-europe-west1}"
RECIPIENT="${AGE_RECIPIENT:-}"
BUCKET="${BACKUP_BUCKET:-${PROJECT_ID}-sauvegardes-auth}"
JOB_NAME="${EXPORT_JOB_NAME:-goa-export-auth}"
SERVICE_ACCOUNT_NAME="${EXPORT_SERVICE_ACCOUNT_NAME:-goa-sauvegarde-auth}"
SCHEDULER_JOB="${EXPORT_SCHEDULER_JOB:-goa-export-auth-hebdo}"
SCHEDULE="${EXPORT_SCHEDULE:-0 3 * * 0}"
ROLE_ID="${EXPORT_ROLE_ID:-goaSauvegardeAuthLecture}"
RETENTION_JOURS="${EXPORT_RETENTION_JOURS:-365}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "FIREBASE_PROJECT_ID est requis." >&2
  exit 1
fi
if [[ "$PROJECT_ID" == demo-* ]]; then
  echo "Refus : ${PROJECT_ID} est un projet d'émulateur, pas la production." >&2
  exit 1
fi
if [[ -z "$RECIPIENT" || "$RECIPIENT" != age1* ]]; then
  echo "AGE_RECIPIENT est requis et doit être une clé publique age (age1...)." >&2
  echo "La générer sur un poste sûr : age-keygen -o cle-privee-goa.txt" >&2
  exit 1
fi
for outil in gcloud; do
  command -v "$outil" >/dev/null 2>&1 || { echo "Commande requise introuvable : ${outil}" >&2; exit 1; }
done

cd "$(dirname "$0")/.."
SERVICE_ACCOUNT="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "1/6 — Bucket de sauvegarde gs://${BUCKET}"
if ! gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" \
    --location "$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --project "$PROJECT_ID"
fi
LIFECYCLE="$(mktemp)"
cat > "$LIFECYCLE" <<JSON
{"rule":[{"action":{"type":"Delete"},"condition":{"age":${RETENTION_JOURS}}}]}
JSON
gcloud storage buckets update "gs://${BUCKET}" \
  --lifecycle-file="$LIFECYCLE" \
  --soft-delete-duration=30d \
  --project "$PROJECT_ID" >/dev/null
rm -f "$LIFECYCLE"
echo "     Conservation ${RETENTION_JOURS} jours, soft delete 30 jours, accès public interdit."

echo "2/6 — Compte de service ${SERVICE_ACCOUNT_NAME}"
if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --display-name "GOA sauvegarde des comptes Auth" \
    --project "$PROJECT_ID"
fi

echo "3/6 — Droits (lecture seule sur Auth, écriture seule sur le bucket)"
# Aucun rôle prédéfini en lecture seule ne donne accès aux paramètres de hachage
# des mots de passe : ils ne figurent que dans les rôles administrateurs, qui
# autorisent aussi la suppression de comptes. D'où ce rôle sur mesure, limité à
# la lecture.
PERMISSIONS="firebaseauth.users.get,firebaseauth.configs.get,firebaseauth.configs.getHashConfig,resourcemanager.projects.get"
if gcloud iam roles describe "$ROLE_ID" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam roles update "$ROLE_ID" \
    --project "$PROJECT_ID" \
    --permissions "$PERMISSIONS" \
    --quiet >/dev/null
else
  gcloud iam roles create "$ROLE_ID" \
    --project "$PROJECT_ID" \
    --title "GOA sauvegarde Auth (lecture)" \
    --description "Lecture des comptes Authentication et des parametres de hachage, pour la sauvegarde hebdomadaire." \
    --permissions "$PERMISSIONS" \
    --stage GA \
    --quiet >/dev/null
fi
for role in "projects/${PROJECT_ID}/roles/${ROLE_ID}" roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${SERVICE_ACCOUNT}" \
    --role "$role" \
    --condition=None \
    --quiet >/dev/null
done
# Le rôle prédéfini a pu être attribué par une version antérieure : on le retire
# pour que le compte de service ne conserve que le strict nécessaire.
gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role roles/firebaseauth.viewer \
  --condition=None \
  --quiet >/dev/null 2>&1 || true
# objectCreator seulement : le job peut déposer une sauvegarde, jamais en lire
# ni en supprimer une. Une compromission du job ne permet pas d'effacer
# l'historique ni de relire les sauvegardes.
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role roles/storage.objectCreator \
  --project "$PROJECT_ID" \
  --quiet >/dev/null

echo "4/6 — Job Cloud Run ${JOB_NAME}"
DEPLOY_ARGS=(
  --source jobs/export-auth
  --region "$REGION"
  --project "$PROJECT_ID"
  --service-account "$SERVICE_ACCOUNT"
  --set-env-vars "FIREBASE_PROJECT_ID=${PROJECT_ID},BACKUP_BUCKET=${BUCKET},AGE_RECIPIENT=${RECIPIENT}"
  --max-retries 2
  --task-timeout 900s
  --memory 512Mi
)
gcloud run jobs deploy "$JOB_NAME" "${DEPLOY_ARGS[@]}" --quiet

echo "5/6 — Droit d'exécution du job pour le déclencheur"
gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role roles/run.invoker \
  --quiet >/dev/null

echo "6/6 — Déclencheur hebdomadaire (${SCHEDULE}, Europe/Brussels)"
SCHEDULER_ARGS=(
  --location "$REGION"
  --project "$PROJECT_ID"
  --schedule "$SCHEDULE"
  --time-zone "Europe/Brussels"
  --uri "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}:run"
  --http-method POST
  --oauth-service-account-email "$SERVICE_ACCOUNT"
  --attempt-deadline 60s
  --max-retry-attempts 3
)
if gcloud scheduler jobs describe "$SCHEDULER_JOB" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$SCHEDULER_JOB" "${SCHEDULER_ARGS[@]}" --quiet
else
  gcloud scheduler jobs create http "$SCHEDULER_JOB" "${SCHEDULER_ARGS[@]}" --quiet
fi

echo
echo "Sauvegarde Auth hebdomadaire en place."
echo "Bucket : gs://${BUCKET}"
echo "Exécution immédiate pour tester :"
echo "  gcloud run jobs execute ${JOB_NAME} --region ${REGION} --project ${PROJECT_ID} --wait"
