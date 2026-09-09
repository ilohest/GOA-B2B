#!/usr/bin/env bash
set -euo pipefail

# Met en place les protections de données de production :
#  - protection contre la suppression accidentelle de la base Firestore ;
#  - récupération à un instant précis (PITR) sur Firestore ;
#  - sauvegardes Firestore quotidiennes (4 semaines) et hebdomadaires (12 semaines) ;
#  - soft delete de 30 jours sur le bucket Firebase Storage.
#
# Le script est idempotent : il peut être relancé sans créer de doublon.
# Prérequis : forfait Blaze actif sur le projet.

PROJECT_ID="${FIREBASE_PROJECT_ID:-}"
DATABASE="${FIRESTORE_DATABASE:-(default)}"
STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-${PROJECT_ID}.firebasestorage.app}"
RETENTION_QUOTIDIENNE="${RETENTION_QUOTIDIENNE:-4w}"
RETENTION_HEBDOMADAIRE="${RETENTION_HEBDOMADAIRE:-12w}"
JOUR_HEBDOMADAIRE="${JOUR_HEBDOMADAIRE:-SUN}"
SOFT_DELETE="${STORAGE_SOFT_DELETE_DURATION:-30d}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "FIREBASE_PROJECT_ID est requis." >&2
  exit 1
fi
if [[ "$PROJECT_ID" == demo-* ]]; then
  echo "Refus : ${PROJECT_ID} est un projet d'émulateur, pas la production." >&2
  exit 1
fi
if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud est requis : https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

echo "Projet ciblé : ${PROJECT_ID}"
echo "Base Firestore : ${DATABASE}"
echo "Bucket Storage : gs://${STORAGE_BUCKET}"
echo

echo "1/5 — Protection contre la suppression de la base"
gcloud firestore databases update \
  --database="$DATABASE" \
  --delete-protection \
  --project "$PROJECT_ID" \
  --quiet >/dev/null
echo "     La base ne peut plus être supprimée sans lever explicitement la protection."

echo "2/5 — Activation de la récupération à un instant précis (PITR)"
gcloud firestore databases update \
  --database="$DATABASE" \
  --enable-pitr \
  --project "$PROJECT_ID" \
  --quiet >/dev/null
echo "     PITR actif (fenêtre de 7 jours)."

PLANIFICATIONS="$(gcloud firestore backups schedules list \
  --database="$DATABASE" \
  --project "$PROJECT_ID" \
  --format=json 2>/dev/null || echo '[]')"

echo "3/5 — Sauvegarde quotidienne (conservation ${RETENTION_QUOTIDIENNE})"
if grep -q '"dailyRecurrence"' <<<"$PLANIFICATIONS"; then
  echo "     Déjà planifiée, rien à créer."
else
  gcloud firestore backups schedules create \
    --database="$DATABASE" \
    --recurrence=daily \
    --retention="$RETENTION_QUOTIDIENNE" \
    --project "$PROJECT_ID"
fi

echo "4/5 — Sauvegarde hebdomadaire ${JOUR_HEBDOMADAIRE} (conservation ${RETENTION_HEBDOMADAIRE})"
if grep -q '"weeklyRecurrence"' <<<"$PLANIFICATIONS"; then
  echo "     Déjà planifiée, rien à créer."
else
  gcloud firestore backups schedules create \
    --database="$DATABASE" \
    --recurrence=weekly \
    --day-of-week="$JOUR_HEBDOMADAIRE" \
    --retention="$RETENTION_HEBDOMADAIRE" \
    --project "$PROJECT_ID"
fi

echo "5/5 — Soft delete Storage (${SOFT_DELETE})"
if ! gcloud storage buckets describe "gs://${STORAGE_BUCKET}" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "     Bucket introuvable : gs://${STORAGE_BUCKET}" >&2
  echo "     Crée Storage dans la console Firebase, puis relance ce script." >&2
  exit 1
fi
gcloud storage buckets update "gs://${STORAGE_BUCKET}" \
  --soft-delete-duration="$SOFT_DELETE" \
  --project "$PROJECT_ID" >/dev/null
echo "     Soft delete réglé sur ${SOFT_DELETE}."

echo
echo "=== Vérification ==="
gcloud firestore databases describe \
  --database="$DATABASE" \
  --project "$PROJECT_ID" \
  --format='value(locationId,pointInTimeRecoveryEnablement,deleteProtectionState)'
gcloud firestore backups schedules list \
  --database="$DATABASE" \
  --project "$PROJECT_ID" \
  --format='table(name.basename(),retention,dailyRecurrence,weeklyRecurrence.day)'
gcloud storage buckets describe "gs://${STORAGE_BUCKET}" \
  --project "$PROJECT_ID" \
  --format='value(soft_delete_policy.retentionDurationSeconds)'

echo
echo "Rappel : les comptes Firebase Authentication ne sont PAS inclus."
echo "Programme scripts/export-auth.sh chaque semaine."
