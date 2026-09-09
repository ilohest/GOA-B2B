# Mise en production GOA B2B — Firebase et Cloud Run

Ce guide prépare `commandes.goa-kombucha.fr` sans VPS. Le projet Firebase et le
compte de facturation doivent appartenir au client.

## Architecture

- Firebase Hosting : frontend Vue, HTTPS et domaine personnalisé.
- Cloud Run `goa-b2b-api` : API Hono/Node.
- Firebase Auth, Firestore et Storage : comptes et données.
- Cloud Tasks `easybeer-sync` : synchronisations longues et retries.
- Cloud Scheduler : contrôle conditionnel des caches toutes les 10 minutes.
- Secret Manager : identifiants Easybeer, SMTP et secrets techniques.

Région applicative : `europe-west1` (Belgique). Pour la base Firestore, choisir
`eur3` si la priorité est la résilience multirégion européenne. Ce choix de
localisation doit être validé avant de créer la base.

## 1. Préparer Firebase

1. Passer le projet du client sur Blaze et configurer une alerte de budget.
2. Créer Firestore, Auth et Storage dans les régions européennes retenues.
3. Dans Auth > Modes de connexion, activer **Adresse e-mail/Mot de passe**,
   l'option **Lien envoyé par e-mail (connexion sans mot de passe)** et **Google**.
   Pour Google, choisir l'adresse d'assistance publique de la brasserie.
4. Créer une application Web et relever : API key, App ID et Auth domain.
5. Relever le nom exact du bucket Storage. Un nouveau projet utilise normalement
   `PROJECT_ID.firebasestorage.app`, tandis qu'un ancien peut utiliser `appspot.com`.
6. Ajouter `commandes.goa-kombucha.fr` aux domaines autorisés d'Authentication.
7. Donner au développeur les droits nécessaires sans partager le mot de passe
   Google ni les coordonnées bancaires.

## 2. Installer les outils locaux

Les commandes `gcloud` et `firebase` doivent être disponibles, puis connectées
au compte Google autorisé sur le projet du client. Sur macOS :

```bash
brew install --cask google-cloud-sdk
npm install -g firebase-tools
```

La connexion se fait avec le compte nominatif du développeur, ajouté au projet
par le client. Les identifiants Google du client ne sont jamais nécessaires.

```bash
gcloud auth login
firebase login
```

Toujours vérifier l'identifiant du projet avant une commande déployante.

## 3. Créer le socle cloud

```bash
export FIREBASE_PROJECT_ID="identifiant-du-projet-client"
export FIREBASE_STORAGE_BUCKET="identifiant-du-projet-client.firebasestorage.app"
npm run setup:cloud
```

Le script active les API, crée les comptes de service Cloud Run et Scheduler,
une file limitée à une synchronisation concurrente et quatre conteneurs Secret
Manager vides.

## 4. Ajouter les secrets

Ne jamais placer les valeurs dans Git, un fichier partagé ou une capture d'écran.
Pour chaque secret, saisir la valeur sans l'afficher :

```bash
read -r -s secret_value
printf '%s' "$secret_value" | gcloud secrets versions add easybeer-username --data-file=- --project "$FIREBASE_PROJECT_ID"
unset secret_value
```

Répéter pour :

- `easybeer-username` ;
- `easybeer-password` ;
- `smtp-password` ;
- `tasks-secret` : valeur aléatoire d'au moins 32 caractères.

## 5. Premier déploiement

Le premier déploiement reste volontairement en mode devis.

```bash
export FIREBASE_PROJECT_ID="identifiant-du-projet-client"
export PUBLIC_URL="https://commandes.goa-kombucha.fr"
export VITE_FIREBASE_API_KEY="valeur-application-web"
export VITE_FIREBASE_APP_ID="valeur-application-web"
export VITE_FIREBASE_AUTH_DOMAIN="identifiant-du-projet-client.firebaseapp.com"
export FIREBASE_STORAGE_BUCKET="identifiant-du-projet-client.firebasestorage.app"
export SMTP_HOST="serveur-smtp-indiqué-dans-ovh"
export SMTP_USER="adresse-email-ovh"
export COMMANDE_EST_DEVIS="true"
npm run deploy:cloud
```

Le script exécute les tests, construit les deux applications, déploie Cloud Run,
injecte les secrets, crée ou met à jour le job Cloud Scheduler avec son identité
OIDC, déploie Firebase Hosting et teste les endpoints publics.

## 6. Domaine OVH

Dans Firebase Hosting, ajouter le domaine personnalisé
`commandes.goa-kombucha.fr`. Reporter uniquement les enregistrements DNS demandés
par Firebase dans la zone DNS OVH. Ne pas modifier les enregistrements MX, SPF,
DKIM ou DMARC utilisés par les e-mails.

Attendre la validation DNS et la génération du certificat HTTPS avant les tests
de connexion et d'invitation.

## 7. Maintenance automatique des caches

Le déploiement configure automatiquement le job `goa-cache-maintenance` :

- fréquence : toutes les 10 minutes, fuseau `Europe/Brussels` ;
- méthode : `POST` sur `/api/scheduled/maintenance` ;
- authentification : jeton OIDC signé pour le compte `goa-scheduler` ;
- traitement : mise en file d'une Cloud Task durable ;
- concurrence : une seule tâche, avec trois tentatives et backoff.

La tâche lit d'abord les horodatages Firestore. Elle n'appelle Easybeer que pour
les familles expirées : commandes après 10 minutes, clients et catalogue après
30 minutes. Le nettoyage des comptes supprimés d'Easybeer reste exécuté lors du
rafraîchissement de la liste clients. Les prix propres à un client restent
rafraîchis à la consultation de sa boutique, afin de ne pas synchroniser à vide
des comptes inactifs.

Après le déploiement, vérifier le job avec :

```bash
gcloud scheduler jobs describe goa-cache-maintenance \
  --location europe-west1 \
  --project "$FIREBASE_PROJECT_ID"
```

## 8. Sauvegardes et protection des données

À exécuter dès que Firestore et Storage existent, avant d'ouvrir le portail aux
clients. Le script est idempotent et peut être relancé sans risque.

```bash
export FIREBASE_PROJECT_ID="goa-b2b-production"
export FIREBASE_STORAGE_BUCKET="goa-b2b-production.firebasestorage.app"
npm run setup:sauvegardes
```

Il active la récupération à un instant précis (PITR, fenêtre de sept jours), crée
une sauvegarde Firestore quotidienne conservée quatre semaines et une sauvegarde
hebdomadaire du dimanche conservée douze semaines, puis règle le soft delete du
bucket Storage sur trente jours.

### Comptes Authentication

Les comptes Firebase Authentication ne sont couverts par aucune de ces
sauvegardes, ni par le PITR. Ils sont protégés séparément par un job Cloud Run
hebdomadaire, indépendant de tout poste de travail.

Générer d'abord une paire de clés sur un poste sûr, et conserver la clé privée
hors ligne en double exemplaire :

```bash
age-keygen -o cle-privee-goa.txt
```

Puis déployer la sauvegarde, en ne fournissant que la clé **publique** :

```bash
export FIREBASE_PROJECT_ID="goa-b2b-production"
export AGE_RECIPIENT="age1..."
./scripts/setup-export-auth-cloud.sh
```

Le script crée un bucket dédié à accès public interdit, un compte de service
limité à la lecture d'Authentication et au dépôt d'objets, un job Cloud Run et un
déclencheur hebdomadaire le dimanche à 3 h. Le compte de service ne peut ni
relire ni supprimer les sauvegardes : compromettre le job ne permet pas
d'effacer l'historique.

Le JSON en clair ne touche jamais un disque : il est chiffré en flux vers Cloud
Storage. La sauvegarde inclut les paramètres de hachage des mots de passe, sans
lesquels une restauration obligerait tous les clients à réinitialiser le leur.
Le job refuse d'écrire s'il ne parvient pas à les lire.

Exécution immédiate pour vérifier :

```bash
gcloud run jobs execute goa-export-auth --region europe-west1 \
  --project goa-b2b-production --wait
```

Le script local `npm run export:auth` reste disponible pour un export manuel
ponctuel vers le poste de travail.

### Restaurer des comptes Authentication

À tester au moins une fois, dans un projet Firebase distinct, jamais directement
en production.

```bash
gcloud storage cp gs://goa-b2b-production-sauvegardes-auth/auth/FICHIER.json.age .
age -d -i cle-privee-goa.txt -o sauvegarde.json FICHIER.json.age
```

Le fichier obtenu contient `hashConfig` et `users`. Extraire les comptes et
relire les paramètres de hachage :

```bash
node -e 'const d=require("./sauvegarde.json");require("fs").writeFileSync("users.json",JSON.stringify({users:d.users}));console.log(d.hashConfig)'
```

Puis importer en reportant les valeurs affichées :

```bash
firebase auth:import users.json \
  --hash-algo=SCRYPT \
  --hash-key="SIGNER_KEY" \
  --salt-separator="SALT_SEPARATOR" \
  --rounds=8 \
  --mem-cost=14 \
  --project projet-de-test
```

Supprimer ensuite les fichiers déchiffrés : ils contiennent des données
personnelles et des empreintes de mots de passe.

La checklist complète, incluant les tests de restauration et la supervision, se
trouve dans [`TODO-SAUVEGARDES-PRODUCTION.md`](./TODO-SAUVEGARDES-PRODUCTION.md).

## 9. Recette avant commandes réelles

1. Tester connexion Google, lien sans mot de passe, mot de passe oublié et
   activation d'une invitation avec Google puis avec un mot de passe.
2. Tester catalogue, remises et tarifs personnalisés.
3. Créer, modifier et consulter un devis Easybeer.
4. Tester les boutons d'actualisation et la synchronisation globale.
5. Simuler une indisponibilité Easybeer et vérifier le repli sur le cache.
6. Effectuer un export Firestore puis tester sa restauration dans un projet de test.
7. Configurer alertes Cloud Run, erreurs et budget.

La checklist détaillée des exports et tests de restauration se trouve dans
[`TODO-SAUVEGARDES-PRODUCTION.md`](./TODO-SAUVEGARDES-PRODUCTION.md).

Après validation écrite du client, redéployer avec :

```bash
export COMMANDE_EST_DEVIS="false"
npm run deploy:cloud
```

## 10. Migration depuis le projet temporaire

La migration doit être faite juste avant la recette finale : export Firestore et
Storage, import dans le projet client, recréation contrôlée des comptes Auth puis
comparaison des volumes et documents. Ne pas copier les caches d'émulateur vers
la production. Conserver l'ancien projet en lecture seule jusqu'à validation.
