#!/usr/bin/env bash
set -euo pipefail
umask 077

# Exporte les comptes Firebase Authentication et chiffre immédiatement le fichier.
# Les comptes Auth ne sont couverts par AUCUNE sauvegarde Firestore : cet export
# est le seul filet de sécurité en cas de suppression accidentelle d'utilisateurs.
#
# Chiffrement asymétrique avec age : seule la clé PUBLIQUE est nécessaire ici,
# la clé privée reste hors de cette machine. L'export peut donc tourner
# automatiquement sans qu'aucun secret déchiffrant ne soit stocké sur le poste.
#
# Préparation, une seule fois, sur un poste sûr :
#   age-keygen -o cle-sauvegarde-goa.txt   # à conserver hors ligne, en double
#   export AUTH_EXPORT_AGE_RECIPIENT="age1..."   # la ligne « public key »

PROJECT_ID="${FIREBASE_PROJECT_ID:-goa-b2b-production}"
DEST_DIR="${AUTH_EXPORT_DIR:-$HOME/goa-sauvegardes/auth}"
RECIPIENT="${AUTH_EXPORT_AGE_RECIPIENT:-}"
CONSERVER="${AUTH_EXPORT_CONSERVER:-8}"

if [[ "$PROJECT_ID" == demo-* ]]; then
  echo "Refus : ${PROJECT_ID} est un projet d'émulateur, pas la production." >&2
  exit 1
fi
if [[ -z "$RECIPIENT" ]]; then
  echo "AUTH_EXPORT_AGE_RECIPIENT est requis (clé publique age1...)." >&2
  echo "Sans chiffrement, l'export contient des données personnelles en clair." >&2
  exit 1
fi
for outil in firebase age; do
  if ! command -v "$outil" >/dev/null 2>&1; then
    echo "Commande requise introuvable : ${outil}" >&2
    exit 1
  fi
done

mkdir -p "$DEST_DIR"
HORODATAGE="$(date +%Y-%m-%d-%H%M)"
# Répertoire temporaire dédié : mktemp -d donne des permissions 700, et le
# fichier doit porter l'extension .json pour que firebase et node le lisent.
TEMP_DIR="$(mktemp -d -t goa-auth)"
TEMPORAIRE="${TEMP_DIR}/export.json"
CIBLE="${DEST_DIR}/auth-${PROJECT_ID}-${HORODATAGE}.json.age"

nettoyer() {
  if [[ -f "$TEMPORAIRE" ]]; then
    rm -P "$TEMPORAIRE" 2>/dev/null || rm -f "$TEMPORAIRE"
  fi
  [[ -d "$TEMP_DIR" ]] && rmdir "$TEMP_DIR" 2>/dev/null || true
}
trap nettoyer EXIT

echo "Export des comptes de ${PROJECT_ID}"
firebase auth:export "$TEMPORAIRE" --format=json --project "$PROJECT_ID"

COMPTES="$(node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log((d.users||[]).length)' "$TEMPORAIRE")"
if [[ "$COMPTES" -eq 0 ]]; then
  # Aucun compte : on n'écrit rien et on ne purge rien. Un export vide qui
  # remplacerait des sauvegardes valides serait pire que pas de sauvegarde.
  # Ce n'est pas une erreur : avant l'ouverture aux clients, c'est l'état normal.
  echo "Aucun compte dans ${PROJECT_ID}. Rien n'est écrit, les exports existants sont conservés."
  exit 0
fi

age -r "$RECIPIENT" -o "$CIBLE" "$TEMPORAIRE"
nettoyer
chmod 600 "$CIBLE"

echo "${COMPTES} compte(s) exporté(s) et chiffré(s)."
echo "Fichier : ${CIBLE}"

# Ne garder que les N derniers exports.
ls -1t "${DEST_DIR}"/auth-*.json.age 2>/dev/null | tail -n "+$((CONSERVER + 1))" | while IFS= read -r fichier; do
  [[ -n "$fichier" ]] || continue
  rm -f "$fichier"
  echo "Purgé : $(basename "$fichier")"
done

echo
echo "À faire ensuite : copier ${CIBLE} hors de cette machine"
echo "(disque chiffré ou stockage distant), la clé privée age restant séparée."
