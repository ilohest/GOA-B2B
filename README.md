# Plateforme de commande B2B GOA

Plateforme web de commande pour les clients pros de La Brasserie de GOA, adossée à
Easybeer (source de vérité unique — voir `BRIEF-DEV-V1.md` §2 et `EASYBEER.md`).

## Structure

- `web/` — front Vue 3 + Vite + TS, shadcn-vue (Reka UI + Tailwind v4), TanStack Query, Zod.
- `server/` — backend Hono : proxy Easybeer (Basic Auth côté serveur), auth Firebase, Firestore.
- `firebase.json` / `firestore.rules` — émulateurs locaux (Auth 9100, Firestore 8180, Storage 9200, UI 4100).

## Démarrage en dev

Prérequis : Node 22+, Java 11+ (émulateur Firestore), `firebase-tools`.

```bash
# 1. Dépendances (une fois)
npm --prefix server install && npm --prefix web install

# 2. Secrets : server/.env (copier server/.env.example, renseigner EASYBEER_*)
#    et web/.env.local (copier web/.env.example — VITE_FIREBASE_EMULATOR=true)

# 3. Dans 3 terminaux (ou en arrière-plan), depuis la racine :
npm run dev:emulators   # émulateurs Firebase Auth + Firestore
npm run seed            # comptes de test (émulateurs démarrés au préalable)
npm run dev:server      # backend Hono sur http://localhost:8788
npm run dev:web         # front Vite sur http://localhost:5173
```

Comptes de test (émulateur) : `admin@goa.local` / `client@goa.local`, mot de passe `goa-dev-123`.
Le compte client est lié au client Easybeer de test 588074 (CL000083).

Le seed charge aussi un instantané versionné du catalogue de développement :
produits, tarifs, visibilité, noms personnalisés, ruptures et photos. Un nouveau
clone retrouve ainsi le même catalogue sans lancer une synchronisation Easybeer.

Pour remplacer cet instantané par l'état actuellement affiché dans les
émulateurs, laissez-les démarrés puis lancez :

```bash
npm --prefix server run seed:export-catalogue
```

Les fichiers produits dans `server/fixtures/` doivent ensuite être commités.

⚠️ Le backend écoute sur **8788** (8787 déjà pris sur le poste de dev par un autre projet).

## Mise en ligne sur le VPS

La préproduction est publiée sur `https://82.112.255.95` dans
`/var/www/html/isaure/goa-kombucha`. Elle utilise les émulateurs Firebase du
VPS. Le script de mise en ligne configure `COMMANDE_EST_DEVIS=false` : les
validations créent de vraies commandes Easybeer fermes.

Prérequis locaux : accès SSH au VPS, `npm`, `rsync`, `curl` et un fichier
`server/.env` complet. Le VPS doit disposer de Node.js 22+, PM2, Apache,
Java 21 (`openjdk-21-jre-headless`) et du Certbot IP isolé dans
`/opt/certbot-ip`. Le certificat Let’s Encrypt de l'adresse IP est court ; le
timer `goa-ip-certbot.timer` le vérifie quatre fois par jour et recharge Apache
après un renouvellement.

Pour vérifier, construire et redéployer l'ensemble de l'application :

```bash
npm run deploy:vps
```

Le script conserve les données Firebase distantes entre deux déploiements,
redémarre les processus PM2, installe la configuration HTTPS et le timer de
renouvellement, vérifie Apache puis teste la page publique et l'API. Le backend
et les émulateurs écoutent uniquement sur la boucle locale ; Apache publie en
HTTPS les routes utiles. Les paramètres du script peuvent être remplacés sans
modifier le fichier :

```bash
VPS_HOST=root@82.112.255.95 \
APP_DIR=/var/www/html/isaure/goa-kombucha \
PUBLIC_URL=https://82.112.255.95 \
AUTH_EMULATOR_URL=https://82.112.255.95 \
npm run deploy:vps
```

L'aide intégrée récapitule ces options :

```bash
npm run deploy:vps -- --help
```

### Production serverless

La cible de production recommandée est Firebase Hosting + Cloud Run + Cloud
Tasks. Le guide complet se trouve dans [`DEPLOIEMENT-CLOUD.md`](./DEPLOIEMENT-CLOUD.md).

```bash
FIREBASE_PROJECT_ID="projet-client" npm run setup:cloud
FIREBASE_PROJECT_ID="projet-client" npm run deploy:cloud
```

Le script VPS reste uniquement disponible pour la préproduction temporaire.

## À faire en fin de développement

- **Skeletons** : repasser sur tous les états de chargement (catalogue, listes,
  détails) avec des skeletons calqués sur le HTML final — à faire quand le
  markup sera stabilisé, pour éviter de les maintenir en double pendant le dev.
- Photos produits : upload via Firebase Storage dans l'admin (le champ
  `photoUrl` des overrides est déjà branché côté client).

## Règles d'or

1. **Lire `EASYBEER.md` avant tout appel à l'API Easybeer** et le mettre à jour à chaque découverte.
2. Une réponse client est toujours construite depuis Firestore ; une revalidation
   Easybeer éventuelle passe par les verrous et cooldowns du cache.
3. Les identifiants Easybeer ne quittent jamais le serveur.

## Exploitation du cache Easybeer

- Le catalogue client fonctionne d'abord **à la demande** : aucun job nocturne
  n'est requis. À la première visite après expiration du TTL, une revalidation
  partagée est lancée et tous les autres clients continuent à utiliser le même
  snapshot valide.
- La boutique auto-répare le catalogue/grille et les prix du client après
  **30 min**, avec stale-while-revalidate, verrou distribué et délai
  anti-rafale. Les seuils sont configurables dans `server/.env.example`.
- En production, un Cloud Scheduler quotidien vers `POST /api/scheduled/sync`
  assure une mise à jour générale de sécurité, en complément des actualisations
  déclenchées à la consultation.
- Garder `PRIX_CACHE_MAX_AGE_MINUTES` supérieur aux seuils proactifs et
  `PRIX_COMMANDE_MAX_AGE_MINUTES` compris entre le seuil de refresh prix et le
  garde-fou dur. Les listes clients et commandes se renouvellent selon leurs
  TTL respectifs. La valeur du garde-fou dur est **2160 minutes** (36 h) : à
  cette limite, une réparation
  est tentée avant de bloquer une commande qui n'a toujours aucun prix frais.
- Après une modification de prix dans Easybeer en journée, lancer
  **Synchroniser Easybeer** depuis l'admin si le nouveau prix doit être visible
  immédiatement. Sinon, il sera pris en compte à la prochaine revalidation à la
  demande.
- Le cache admin des commandes globales charge par défaut les **30 derniers
  jours** (`ADMIN_COMMANDES_CACHE_DAYS=30`) pour limiter le volume utile pendant
  les tests Easybeer.
- Le tableau de bord admin signale une synchronisation trop ancienne afin de
  vérifier le cache avant l'ouverture des commandes.
