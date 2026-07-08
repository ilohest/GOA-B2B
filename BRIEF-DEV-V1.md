# Brief de développement — Plateforme de commande B2B GOA (V1)

> À donner à un nouveau chat pour démarrer le développement.
> **Avant de coder, lire `EASYBEER.md` (racine du repo)** : toute la connaissance de l'API Easybeer y est consolidée (auth, proxy, endpoints, recettes validées, pièges). Ce brief la référence sans la dupliquer.

---

## 1. Contexte

**GOA** (La Brasserie de GOA) vend du kombucha en B2B à ~100-234 clients pros (bars/restos = CHR, GMS, distributeurs, festivals…), 100-150 commandes/mois. Aujourd'hui les commandes passent par un **Jotform** recopié à la main dans **Easybeer** (leur ERP/logiciel de gestion) — source d'erreurs, fait à 90 % sur mobile.

**Objectif V1** : une plateforme web où les clients pros passent commande simplement, qui **crée automatiquement les commandes dans Easybeer** (fini la recopie), et lit tout le reste (catalogue, prix, params clients) depuis Easybeer.

---

## 2. Principe d'architecture (LE plus important)

**Easybeer = source de vérité unique.** La plateforme :
- **LIT** depuis Easybeer : catalogue, prix, stock, paramètres clients, remises, documents.
- **ÉCRIT** dans Easybeer : **uniquement les commandes** (création + modification en place).
- Ne duplique aucune donnée métier. Le client (GOA) gère produits/prix/remises/params dans Easybeer comme aujourd'hui.

**⚠️ Rate-limiting Easybeer (contrainte structurante).** L'API throttle agressivement (réponses HTTP 200 corps vide en rafale). **INTERDIT d'appeler Easybeer en direct à chaque requête client.**
→ **Job de synchro serveur périodique** (Cloud Scheduler, ex. toutes les 10-15 min ou sur déclenchement) qui pull Easybeer → **cache Firestore**. Les clients lisent le cache. Seules les **écritures de commande** tapent l'API en temps réel.

**Sécurité.** Les identifiants API Easybeer (Basic Auth) restent **côté serveur** (Hono), jamais dans le bundle navigateur. Le front appelle toujours via le proxy `/api/*`.

---

## 3. Stack

- **Front** : Vue 3 + Vite + TypeScript. **shadcn-vue** (composants stylés basés sur **Reka UI** + **Tailwind CSS**, code copié dans le repo → propriété + contrôle total du design premium) pour l'UI. **TanStack Table** pour les grilles admin (listes clients, actions en masse). **TanStack Query (Vue Query)** pour le cache/lecture. **Zod** pour la validation. Rester sur **un seul système de design** (shadcn-vue) partout, front client ET admin, pour la cohérence.
- **Back** : **Hono** (Node) — proxy Easybeer (injection Basic Auth), endpoints admin, création/modif commandes, job de synchro.
- **Auth** : **Firebase Auth** (email + mot de passe, reset natif).
- **Data** : **Firestore** (mapping comptes, overrides catalogue, cache Easybeer). **Firebase Storage** (photos produits).
- **Sync** : Cloud Scheduler + Cloud Function/Cloud Run.
- **Hébergement** : Firebase Hosting (front) + Cloud Run (Hono), sous-domaine de `goa-kombucha.fr` (ex. `commandes.goa-kombucha.fr`).

Le repo contient déjà un scaffold : `web/` (Vue+Vite+TS, `firebase.ts` Auth, `services/easybeerService.ts`), `server/` (Hono, `firebase.ts` Admin, `auth.ts` middleware qui résout `users/{uid} → easybeerIdClient`, `easybeer.ts` proxy Basic Auth). **Réutiliser et étendre ce scaffold.**

---

## 4. Modèle de données (Firestore)

- **`users/{uid}`** = `{ email, easybeerIdClient, role: 'client'|'admin', status: 'invited'|'active' }` → lien compte ↔ client Easybeer (déjà lu par `auth.ts`).
- **`catalogueOverrides/{idStockBouteille}`** = `{ visible: bool, displayName: string, photoUrl: string, rupture: bool }` → couche de personnalisation catalogue app-side (voir §6.2). **Masqué par défaut** (un nouveau produit Easybeer n'apparaît pas tant que non coché).
- **`cache/...`** = snapshot synchronisé d'Easybeer (produits commandables, prix par client/grille, params clients, tournées). Structure à définir selon les besoins de lecture.
- (Optionnel) réglages plateforme (calendrier de tournées si emailing un jour, règles franco par département…).

---

## 5. Auth & invitation (flux validé)

1. **Admin (GOA)** liste les clients Easybeer (`POST /parametres/client/liste`) → choisit un client → clic « Inviter ».
2. **Serveur** (Firebase Admin) : `createUser({ email })` (email = `emailPrincipal` du client Easybeer) → écrit `users/{uid} = { easybeerIdClient, role:'client', status:'invited' }` → `generatePasswordResetLink(email)` envoyé par mail (« créez votre mot de passe »).
3. **Client** clique → définit **son** mot de passe → compte actif.
4. Login → le front envoie l'ID token → `requireAuth` (Hono) le vérifie et résout `easybeerIdClient`. Toutes les lectures/commandes partent avec **le bon idClient**.

- **Clé de liaison = `idClient`** (id interne Easybeer). Le `numero` (ex. CL000083) et l'`emailPrincipal` servent au lookup admin.
- Accès **réservé aux clients connus** (pas d'inscription libre, pas de prospects). Mot de passe oublié = natif Firebase.
- Plusieurs comptes peuvent pointer le même `easybeerIdClient` (plusieurs acheteurs d'un même commerce).

---

## 6. Périmètre fonctionnel V1

### 6.1 Espace client
- Connexion par compte (login obligatoire), invitation gérée par GOA (§5), mot de passe oublié.
- **Historique de ses commandes** (numéro, montant, date, produits) — lu via `POST /commande/liste/{etat}` avec `{ idClient, inclureArchive: true }` (⚠️ `inclureArchive` OBLIGATOIRE sinon corps vide ; l'état du path est ignoré → 1 appel = tout l'historique). Détail d'une commande via `GET /commande/edition/{id}`. **Pas de statut** (le client ne s'en sert pas).
- **Documents (factures / bons de livraison)** : consultation/téléchargement, **toujours la version à jour** lue en direct d'Easybeer (`GET /commande/document/telecharger|visualiser/{id}`) → pas de copie figée, donc pas de confusion si une facture est modifiée.

### 6.2 Catalogue & tarifs
- Produits lus depuis Easybeer (`GET /stock/produits/autocomplete?accesPro=true`) **+ couche d'override app** (`catalogueOverrides`) :
  - **`visible` on/off** : l'admin voit TOUS les produits Easybeer et coche ceux affichés au front. **Masqué par défaut.** (Résout « n'afficher que 12×35cl et 6×1L » sans rien coder en dur.)
  - **nom d'affichage** (les libellés Easybeer sont techniques), **photo**, **rupture** on/off.
- **Prix PAR CLIENT** : `GET /parametres/prix/{idStockBouteille}/{idClientType}/{idClient}` avec le **type+id du client connecté**. ⚠️ Les prix **NE sont PAS uniformes** : varient par type (ex. Distributeur 21,84 € vs PRO 27,30 €) + tarifs custom par client. Toujours lire par client.
- **Stock : ne PAS afficher** les quantités. La dispo = le flag `rupture` géré dans l'app.
- Même **catalogue de produits** pour tous (mais prix différents).

### 6.3 Commande
- Panier simple (quantités par produit/format), champ **commentaire** libre.
- **Contrôle du minimum de commande** (blocage en dessous) — `minimumCommande` lu sur la fiche client Easybeer.
- **Création dans Easybeer** : `POST /commande/enregistrer` (recette dans EASYBEER.md §4 : `client{idClient}`, `grilleTarifaire{idClientType}` = racine, `commentaire` non vide, `tauxTVAFraisLivraison`, `elementsBouteilles[]` avec `stockProduit` complet issu de l'autocomplete). Réponse succès dans `map.id`.
- **Modification de commande en place** (validé) : `POST /commande/enregistrer` est un **upsert** — renvoyer l'objet avec son `idCommande` met à jour la même commande (pas de doublon). Flux : `GET /commande/edition/{id}` → pré-remplir le panier → modifier → re-enregistrer. Bouton **« Modifier ma commande »** côté client. **Garde-fou (décidé)** : modifiable **tant que la commande n'a pas le statut `LIVREE`** dans Easybeer. Prévoir aussi un message façon Jotform « une nouvelle commande annule et remplace la précédente » en filet de sécurité.
- **Contrainte transporteur La Poste** (confirmée) : conditionnement = **3 colis de 35cl par gros carton** & **2 colis de 1L par gros carton**. Donc si le client est tagué `laposte` (voir §6.4), imposer au panier des quantités en **multiple de 3 pour le 35cl** et **multiple de 2 pour le 1L** (gros cartons homogènes).

### 6.4 Livraison
- **Mode lu** sur la fiche client : champ `typeLivraisonFav` (« Type de livraison préféré », **enum FIXE** Easybeer : nos soins / transporteur / enlèvement / service / point de retrait). GOA : direct = « livraison par nos soins » ; transporteur = « livraison par transporteur ».
- **Sous-mode transporteur (frigo vs La Poste)** : Easybeer ne le distingue PAS → **tag client** `frigo` / `laposte` (champ `tags` sur la fiche client, lu via l'API). Décidé par GOA **par client** (certains CHR = La Poste only). L'app lit le tag → applique la règle (multiple-de pour `laposte`).
- Pas de frais de livraison (toujours 0). Pas de date de livraison affichée. Franco par département (frigo) = règle app-side éventuelle, plus tard (grille à fournir).

### 6.5 Remises
- **Toutes lues depuis Easybeer**, jamais ressaisies. 4 niveaux (client/type × global-commande/par-produit) — cf. EASYBEER.md. L'app lit la remise applicable via `POST /parametres/remise` (`idClient`+`idProduit`+`quantite`), qui **résout tous les niveaux**.
- **C'est Easybeer qui calcule et facture** (la commande est envoyée `prixUnitaireHTHorsRemise`). L'app **affiche** le prix, Easybeer applique la remise à la facturation. (À vérifier en réel sur une commande validée que les remises s'appliquent bien.)

### 6.6 Administration (côté GOA)
- **Invitation des clients** (§5).
- **Gestion catalogue** : écran listant tous les produits Easybeer, avec visible/nom/photo/rupture par produit.
- **Remplissage en masse des params clients** (mode de livraison, tournées) pour éviter le client-par-client. Endpoints Easybeer natifs bulk (`idsClients[]`) : `tournee/attribuer` (**✅ validé en réel 2026-07-08** : create+attribuer+supprimer OK ; ⚠️ `supprimer` renvoie un message d'erreur trompeur mais réussit) ; `type-livraison/attribuer` (même structure → OK a priori, mais récupérer d'abord le **code exact du type de livraison** en réglant 1 client dans l'UI puis relecture — enum non exposé au référentiel).
- Cible **mobile en priorité** pour la saisie de commandes (90 % du temps sur mobile) ; PC pour docs/paiements.

### 6.7 Déploiement
- Front sur Firebase Hosting, Hono sur Cloud Run, sous-domaine de `goa-kombucha.fr` (nom à caler avec la cliente : `commandes.` / `pro.`…), HTTPS.

---

## 7. Hors périmètre V1
- Paiement en ligne · gestion des nouveaux clients/prospects · annulation de commande par le client · chat/messagerie · **emailing/rappels** (stand-by : GOA teste le publipostage Easybeer elle-même).
- Documents (BL, factures) : **générés dans Easybeer** (manuellement par GOA), l'app ne fait que les afficher.

## 8. Candidats V2 (données déjà dans Easybeer → surcouche UI/logique, pas from scratch)
- **Palettisation** : UI mobile ergonomique (gros boutons, validation step-by-step) par-dessus les endpoints `commande/palette/*` existants.
- **Rapprochement facture/paiement automatique** : la banque de GOA (Banque Populaire Occitanie) est **déjà connectée à Easybeer via Bridge** → lire les transactions (`comptabilite/banque/{id}/transaction/liste`) + factures impayées, matching maison meilleur que l'algo Easybeer, écrire le rapprochement, **relance auto** des retards.
- **Emailing** rappels de livraison (publipostage Easybeer ciblé par tournée, ou emailing dans l'app).

---

## 9. Questions — état
1. ✅ **Modification de commande** : modifiable tant que le statut ≠ `LIVREE` (décidé).
2. ✅ **Règle multiple La Poste** : confirmée — 3 colis 35cl / 2 colis 1L par gros carton → multiple de 3 (35cl) et 2 (1L).
3. ⏳ **Franco par département** (frigo) : grille département → seuil, à fournir par la cliente (plus tard, non bloquant).
4. ✅ **Écritures bulk params clients** : validées (tournées). Reste à récupérer le **code enum du « type de livraison préféré »** (régler 1 client dans l'UI → relire).

---

## 10. Design / UI-UX — rendu premium

**Exigence : rendu premium, inspiré des interfaces qui marchent.** Références : **Linear** (rigueur, densité maîtrisée), **Stripe / Vercel** (clarté, typographie, espaces), **Shopify admin** (patterns e-commerce/admin B2B), **Notion** (sobriété).

Principes :
- **Mobile-first** (surtout la prise/saisie de commande) ; responsive impeccable ; le corps de page ne scrolle jamais horizontalement.
- Système de design cohérent : échelle d'espacement régulière, typographie soignée (ex. Inter/Geist), hiérarchie claire, ombres subtiles, coins arrondis mesurés, couleur d'accent unique + neutres.
- **États soignés** : loading (skeletons), vide, erreur, succès. Feedback immédiat (le Jotform actuel est frustrant → viser fluide et rassurant).
- Composants **accessibles** via **shadcn-vue** (Reka UI + Tailwind, code possédé et personnalisable) ; grilles admin en **TanStack Table** ; light/dark si pertinent.
- Parcours client **ultra-simple** (cible « boomers ») : gros boutons, peu d'étapes, quantités faciles à ajuster, panier lisible, confirmation claire.
- Admin **efficace** (saisie mobile rapide, listes filtrables, actions en masse).

Cohérence de marque GOA (kombucha bio) : univers frais, naturel, mais **pro et net** (B2B), pas gadget.

---

## 11. Ordre de construction suggéré
1. Socle : proxy Hono + Basic Auth Easybeer (déjà là), env, Firestore, Firebase Auth.
2. Auth + invitation (admin crée un compte → set password → login → résolution idClient).
3. Job de synchro Easybeer → cache Firestore (produits, prix par client, params).
4. Catalogue front (lecture cache + overrides) + écran admin catalogue (visible/nom/photo/rupture).
5. Panier + minimum + création commande dans Easybeer.
6. Modification de commande (upsert) + garde-fou statut.
7. Règle transporteur La Poste (tag → multiple-de).
8. Historique + documents.
9. Déploiement (Hosting + Cloud Run + sous-domaine).

**Rappel final : lire `EASYBEER.md` avant tout appel à l'API Easybeer, et le mettre à jour à chaque nouvelle découverte.**
