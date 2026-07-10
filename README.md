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
2. Jamais d'appel Easybeer en direct depuis une requête client (rate-limiting) — cache Firestore.
3. Les identifiants Easybeer ne quittent jamais le serveur.

## Exploitation du cache Easybeer

- Planifier une synchronisation complète quotidienne hors heures d'usage, par
  exemple vers **04:00 Europe/Paris** : `POST /api/scheduled/sync` avec
  `Authorization: Bearer <SCHEDULER_SECRET>` via Cloud Scheduler ou équivalent.
- Garder `PRIX_CACHE_MAX_AGE_MINUTES` supérieur à 24 h. La valeur par défaut
  est **2160 minutes** (36 h) : si le job nocturne réussit, les clients ne voient
  pas de blocage ; si le job échoue plus d'une journée, l'envoi de commande est
  bloqué plutôt que d'utiliser un prix trop ancien.
- Après une modification de prix dans Easybeer en journée, lancer
  **Synchroniser Easybeer** depuis l'admin si le nouveau prix doit être visible
  immédiatement. Sinon, il sera pris en compte à la prochaine synchronisation
  nocturne.
- Le tableau de bord admin signale une synchronisation trop ancienne afin de
  vérifier le cache avant l'ouverture des commandes.
