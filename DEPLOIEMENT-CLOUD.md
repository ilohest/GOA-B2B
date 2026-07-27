# Mise en production GOA B2B — Firebase et Cloud Run

Ce guide prépare `commande.goa-kombucha.fr` sans VPS. Le projet Firebase et le
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
6. Ajouter `commande.goa-kombucha.fr` aux domaines autorisés d'Authentication.
7. Donner au développeur les droits nécessaires sans partager le mot de passe
   Google ni les coordonnées bancaires.

## 2. Installer les outils locaux

Les commandes `gcloud` et `firebase` doivent être disponibles, puis connectées
au compte Google autorisé sur le projet du client.

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
export PUBLIC_URL="https://commande.goa-kombucha.fr"
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
`commande.goa-kombucha.fr`. Reporter uniquement les enregistrements DNS demandés
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

## 8. Recette avant commandes réelles

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

## 9. Migration depuis le projet temporaire

La migration doit être faite juste avant la recette finale : export Firestore et
Storage, import dans le projet client, recréation contrôlée des comptes Auth puis
comparaison des volumes et documents. Ne pas copier les caches d'émulateur vers
la production. Conserver l'ancien projet en lecture seule jusqu'à validation.
