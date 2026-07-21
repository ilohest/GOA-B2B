# Plateforme de commande B2B GOA

Plateforme web de commande pour les clients pros de La Brasserie de GOA, adossée à
Easybeer (source de vérité unique — voir `BRIEF-DEV-V1.md` §2 et `EASYBEER.md`).

## Structure

- `web/` — front Vue 3 + Vite + TS, shadcn-vue (Reka UI + Tailwind v4), TanStack Query, Zod.
- `server/` — backend Hono : proxy Easybeer (Basic Auth côté serveur), auth Firebase, Firestore.
- `firebase.json` / `firestore.rules` — émulateurs locaux (Auth 9099, Firestore 8080, UI 4000).

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

⚠️ Le backend écoute sur **8788** (8787 déjà pris sur le poste de dev par un autre projet).

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
- La boutique auto-répare le catalogue/grille après **30 min** et les prix du
  client après **6 h**, avec stale-while-revalidate, verrou distribué et délai
  anti-rafale. Les seuils sont configurables dans `server/.env.example`.
- Un Cloud Scheduler quotidien vers `POST /api/scheduled/sync` reste utile comme
  filet de sécurité pour les listes admin, mais il est optionnel pour le catalogue.
- Garder `PRIX_CACHE_MAX_AGE_MINUTES` supérieur aux deux seuils proactifs. La
  valeur par défaut est **2160 minutes** (36 h) : à la limite dure, une réparation
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
