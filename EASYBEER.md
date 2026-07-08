# Documentation API Easybeer — notes de terrain (POC B2B Kombucha)

> Connaissances accumulées sur l'API Easybeer pendant le développement du POC.
> Beaucoup de ces points **ne sont pas dans le Swagger** (`easybeer-api-docs.json`) :
> ils ont été découverts par tests sur l'API réelle. **À mettre à jour à chaque
> nouvelle découverte.**
>
> _Dernière mise à jour : 2026-06-19 — Phases 1 à 3 du POC validées de bout en bout._

---

## 1. Bases

- **Base URL** : `https://api.easybeer.fr` (host `api.easybeer.fr`, basePath `/`).
- **Auth** : **Basic Auth**. Identifiant + mot de passe **générés dans le compte Easybeer**
  (≠ email/mot de passe de connexion à `app.easybeer.fr`). Voir « Connexion » plus bas.
- **Format** : REST/JSON. La plupart des « listes » sont en `POST` (filtre dans le body).
- **Spec** : `easybeer-api-docs.json` (Swagger 2.0) à la racine — référence des modèles,
  mais **incomplète/trompeuse** sur les champs réellement requis et les réponses.

### Connexion / obtention des identifiants d'API
1. Se connecter à `app.easybeer.fr`.
2. Paramètres du compte/brasserie → section **API** (ou « Intégrations »/« Accès API »
   selon la version — chemin exact non documenté).
3. Générer **identifiant + mot de passe d'API**, les copier (mot de passe affiché 1 fois).
4. Support : `easybeer.fr@gmail.com`.

### Setup local du POC
- Identifiants dans `.env.local` (`EASYBEER_USERNAME`, `EASYBEER_PASSWORD`, `EASYBEER_API_TARGET`).
  Fichier **gitignoré** — ne jamais commiter.
- Proxy de dev dans `vite.config.ts` : `/api/*` → `https://api.easybeer.fr/*`, avec
  injection du header `Authorization: Basic <base64>` **côté serveur** (les identifiants
  ne partent jamais dans le bundle navigateur). Évite aussi les CORS.
- Côté front, toujours appeler via le préfixe `/api` (voir `src/services/easybeerService.ts`).

---

## 1bis. ⚠️ Rate-limiting & stratégie de cache (STRUCTURANT)

- L'API **throttle agressivement** : en enchaînant les appels (session 2026-06-20), nombreuses réponses
  **HTTP 200 mais corps vide** (0 octet), de façon intermittente, sur `client/liste`, `commande/liste`,
  `produit/edition`, etc. Ce n'est pas une erreur applicative — c'est de la limitation de débit.
- **Conséquence d'archi : NE JAMAIS appeler Easybeer en direct à chaque requête client.** Un trafic client
  normal ferait throttler la plateforme en continu.
- **Pattern obligatoire** : un **job de synchro serveur** récupère le catalogue (produits, prix, stock, images)
  périodiquement (ex. 5–15 min) ou sur déclenchement, et le **met en cache** (Firestore). Les clients lisent le cache.
  Seules les **écritures de commande** tapent l'API en temps réel.
- **Images produit** : `ModeleProduit.imageUri` / `imagesUrl` / `images`. **Vides** sur les produits du compte test
  (ex. Cola-Chaï 40720 → `null`) → GOA n'a pas encore uploadé de photos. Endpoints upload :
  `POST /parametres/produit/upload-image/{idProduit}`, `POST /stock/produit/upload-image/{idStockProduit}`.
  Reco : copier les images dans un stockage propre (Firebase Storage) lors de la synchro → 0 dépendance au throttling
  pour l'affichage. Format exact de `imagesUrl` (URL publique vs derrière auth) **à confirmer une fois une photo uploadée**.

## 1ter. Rapprochement bancaire / paiements (piste feature phase 2)

- **GOA a une banque connectée dans Easybeer** : Banque Populaire Occitanie (`idBanque` 2171), via **Bridge API**
  (agrégateur open-banking DSP2 ; `bridgeItemStatusCodeInfo: OK`). → **Les transactions bancaires sont déjà
  synchronisées dans Easybeer.** Pas besoin d'intégrer une API bancaire externe pour la feature paiements.
- Easybeer expose aussi : Budget Insight (Powens) et Tink comme agrégateurs alternatifs (`/referentiel/banque/...`).
- **Le point faible = l'algo de suggestion de rapprochement** d'Easybeer (`/comptabilite/banque/reconciliation/suggestion/{idBanque}`),
  jugé mauvais par le client → paiements en retard non détectés, relances manuelles chronophages.
- **Feature envisagée (phase 2)** = surcouche de matching au-dessus des données Easybeer :
  - lire transactions : `POST /comptabilite/banque/{idBanque}/transaction/liste`
  - lire factures impayées : commandes `paiementEtat = NON_PAYEE` + `dateEcheancePaiement`
  - matching maison (montant + libellé/nom client + date + historique) + UI validation rapide
  - écrire le rapprochement : `GET /commande/paiement/associer/{idTransaction}/{idCommande}`,
    `POST /comptabilite/banque/reconciliation(s)`, `POST /commande/paiement/enregistrer`
  - détecter retards + relance auto (`POST /commande/client/relancer(-multiple)`)
  - ⚠️ qualité du matching = dépend des **libellés de virement** (à auditer) ; endpoints non testés ; donnée comptable sensible.

## 1quater. Carte Transport / Livraison (où ça vit dans Easybeer)

- **Paramétrage** : Tournées (`parametres/client/tournee`, circuits de livraison directe) ; mode direct/transporteur
  (`type-livraison/attribuer` → `typeLivraisonFav`) ; adresses (`client/adresse-livraison`) ; frais (`frais-livraison`, =0 chez GOA) ;
  **Boxtal** (`parametres/boxtal/connexion`, agrégateur transporteurs).
- **Sur la commande** : `typeLivraison`, `dateLivraisonPrevue/Reelle`, `informationLivraison`, `immatriculationTransporteur`,
  `editer-date-livraison`, `valider-livraison`, `annuler-livraison`, `bordereau-livraison`, planning `livraison/calendrier` + `livraison/liste`.
- **Expédition transporteur (Boxtal)** : `commande/expedition/offre/liste` (comparer offres), `expedition/enregistrer`,
  `expedition/tracking`, `expedition/fichier/{id}/{type}` (étiquette).
- **⭐ Palettisation DÉJÀ native** (`commande/palette/*`) : `palette/enregistrer`, `palette/element/ajouter|editer|supprimer`,
  `elements-palettisation/{idCommande}`, `palette/elements/enregistrer-ordre`, `palette/etiquette`.
  → La feature V2 « outil de palettisation » = **UI mobile par-dessus ces endpoints existants**, pas un module à recréer (même logique que le rapprochement paiements).
- **Modèle GOA** : livraison **directe** = tournées (circuits récurrents, 1 jeudi/4) ; livraison **transporteur** = Boxtal (aléatoire).
- **2 sous-modes transporteur (retour Mathis 2026-06-30)** : (1) **frigo palette** avec **franco par département** ;
  (2) **La Poste J+1** (petits clients), colisage contraint → commande en **multiple de 3×35cl ou 2×1L**.
  - **⚠️ CORRECTION (fiche client réelle)** : `typeLivraisonFav` = champ **« Type de livraison préféré »** = **ENUM FIXE**
    (non personnalisable), 5 valeurs : *enlèvement par le client · livraison par transporteur · livraison par nos soins ·
    livraison avec service · point de retrait*. → **Easybeer ne distingue PAS frigo vs La Poste** : les deux = « livraison par transporteur ».
    Mapping GOA : direct/tournée = « **livraison par nos soins** » ; transporteur = « **livraison par transporteur** ».
  - **Sous-mode frigo/La Poste** → non natif. Solution : **tags client** (`ModeleClient.tags`, aussi utilisés par le publipostage) :
    taguer `frigo` / `laposte`, l'app lit le tag + `typeLivraisonFav`. (Alternative : champ côté app.) Le franco/dépt et le multiple-de
    restent des **règles côté app** ; le tag dit juste laquelle appliquer.
  - **Autre champ à ne pas confondre** : « **Type de distribution** » (Direct / Distributeur / Direct & Distributeur / Transporteur)
    = canal **commercial** (+ champs distributeur 1/2), ≠ mode de livraison physique. Piloter la livraison via « type de livraison préféré ».
  - **Franco par département** : **PAS** sur la fiche client/commande. Easybeer ne modélise des frais par zone de codes postaux
    que dans son **module boutique** (`ModeleBoutiqueEdition.codesPostauxZone1/2/3` + `montantFraisLivraisonZone1/2/3`).
    → franco par département = **règle côté plateforme** (table département → seuil). NB : contredit « frais toujours 0 ».
  - **Contrainte multiple (La Poste)** : **100 % côté app** (validation panier). Easybeer ne valide pas les multiples de quantité
    (il gère les colis d'expédition dimensions/poids via Boxtal : `ModeleExpeditionColis`).
  - **À clarifier** : mode transport = fixe **par client** ou choisi **par commande** ? + fournir la grille franco/département.

## 2. Pièges connus (⚠️ importants)

| Piège | Détail |
|---|---|
| **Pagination 1-indexée** | Les listes paginées (`POST /parametres/client/liste`, etc.) renvoient **HTTP 500 « erreur inconnue »** si `numeroPage=0`. La première page est **`1`**. |
| **`idClient` casse l'autocomplete produit** | `GET /stock/produits/autocomplete?idClient=...` → **500**. L'appeler **sans** `idClient`. |
| **Grille tarifaire ≠ type CRM** | Le client porte un `type` (ex. `GMS`, idClientType 20680) qui est une **sous-catégorie CRM**. La vraie **grille tarifaire** est la **racine** de cette hiérarchie (`idParent` vide), ex. `client PRO` (idClientType 17849). Résoudre en remontant `idParent`. |
| **500 opaques** | Beaucoup d'erreurs de validation renvoient `{ "succes": false, "message": "Une erreur inconnue s'est produite…", "map": {} }` (HTTP 500/400) sans indice. Approche : partir d'un objet complet connu-valide et réduire. |
| **Filtre `idsClients` IGNORÉ sur `client/liste`** | ✅ Vérifié en réel (2026-07-08) : `POST /parametres/client/liste` avec body `{ idsClients: [601666] }` renvoie **tous les clients** (239) comme si le filtre n'existait pas — aucun message d'erreur. Pour lire UN client, utiliser **`GET /parametres/client/edition/{idClient}`**. (Piège vicieux : le premier client de la liste triée par nom était justement le client de test 588074 → le POC semblait fonctionner par pure coïncidence.) |
| **Réponse de succès non standard** | Voir §4 — `/commande/enregistrer` répond `{ "map": { "id", "numero", "message" } }`, pas un `{idCommande}`. |

---

## 3. Endpoints utilisés (vérifiés)

### Clients
- **`GET /parametres/client/edition/{idClient}`** — fiche client complète. Champs utiles :
  `type { idClientType, libelle, libelleParent }` (ex. GMS → parent `client PRO`), `listeRemises`,
  `listeParticipations`, `typeDelaiPaiementFacture` (NET / A_LIVRAISON…), `adresseLivraisonDefaut` +
  `listeAdresseLivraison` (géocodées lat/long), `typeLivraisonFav`.
  - **Paramètres commerciaux par client (TOUS natifs sur `ModeleClient`, lecture + écriture)** :
    | Champ API | UI Easybeer | Note |
    |---|---|---|
    | `fraisLivraisonHT` (number) | Frais de livraison HT | Valeur fixe **par client** |
    | `minimumCommande` / `minimumCommandeAutorise` (number) | Montant minimum HT | Par client (test : 30,0) |
    | `remise` / `remise2` (string) | Remise spéciale (% ou €) | String car « 10% » ou « 5€ » ; s'applique sur toute la commande |
    | `typeRemise2` (string) | Type de remise | additionnelle / cascade |
    | `listeRemises[]` (`ModeleClientRemise`) | Remises ciblées | par produit/contenant/lot, `quantite`, `dateDebut/Fin`, `remise`, `type` |
    - ⚠️ L'endpoint `edition` **omet les champs nuls** : `fraisLivraisonHT`/`remise`/`typeRemise2` n'apparaissent
      que s'ils sont renseignés. Les champs **existent** toujours au modèle.
    - ✅ **Mapping vérifié en réel (2026-06-20, client CL000083)** — valeurs saisies dans l'UI relues via API :
      | UI Easybeer | API | Valeur | Type |
      |---|---|---|---|
      | Remise spéciale `12%` | `remise` | `"12%"` | string |
      | Type de remise 2 `Additionnelle` | `typeRemise2` | `"ADDITIONNELLE"` (`CASCADE` sinon) | string enum MAJ |
      | Remise 2 `5` | `remise2` | `"5"` | string |
      | Frais de livraison HT `73` | `fraisLivraisonHT` | `73.0` | float |
      | Montant minimum HT `54` | `minimumCommande` **=** `minimumCommandeAutorise` | `54.0` | float (redondants) |
      - **Règle % vs € (parsing) :** la remise est une **string** ; si elle finit par `%` → pourcentage (`"12%"`),
        sinon → montant en € (`"5"`). À appliquer côté plateforme.
      - **Deux remises empilables** : `remise` (de base) + `remise2`, et `typeRemise2` dicte la combinaison
        de remise2 (`ADDITIONNELLE` / `CASCADE`). Reproduire fidèlement dans le calcul de prix.
    - **Dimension par client uniquement** : Easybeer stocke une valeur **par client**, pas « par région ».
      Un minimum/frais « selon la région » se fait en **résolvant la valeur côté admin puis en la poussant sur chaque client**
      (ou via un moteur de règles dans la plateforme). Le **type de client** est natif (idClientType), pas la zone géo.
  - **Écriture** : `POST /parametres/client/enregistrer` (fiche complète), `POST /parametres/client/remise/editer` (remises ciblées).
  - Le compte test contient **234 clients** (~100+ actifs côté métier).
- **`POST /parametres/client/liste`** — liste paginée des clients.
  - Query (tous requis sauf `mode`) : `colonneTri` (ex. `nom`), `numeroPage` (**≥ 1**), `nombreParPage`, `mode?`.
  - Body : `ModeleClientFiltre` (peut être `{}`).
  - Réponse : `ListePagineeOfModeleClient` = `{ liste[], totalElements, totalPages }`.
  - Le `ModeleClient` renvoyé porte `type: { idClientType, libelle }` (catégorie CRM, cf. grille).
- **`GET /parametres/client/type`** — liste des types/grilles (`ModeleClientType[]`).
  Racines (`idParent` vide) = grilles tarifaires (`N/A`, `Particulier (livraison)`, `client PRO`).

### Produits / stock
- **`GET /stock/produits/autocomplete`** — produits commandables.
  - Query utiles : `accesPro=true` (cartons/colisage pro). **Pas d'`idClient`** (500).
  - ⚠️ `afficherTarif=true` **ne renvoie PAS de prix** ici (item = stock + TVA seulement). Le prix se récupère via `/parametres/prix/...` (voir Tarifs).
  - Item : `{ idStockBouteille, libelle, entrepot, quantiteDisponible, seuilHaut, seuilBas, tauxTVA{...}, estUnitaire, idProduit, idContenant, idLot, quantite }`.
  - Compte test : **12 références** (6 saveurs × 2 formats : carton 6×1L et carton 18×0,35L).

### Tarifs / prix
- **`GET /parametres/prix/{idStockBouteille}/{idClientType}/{idClient}`** — prix d'UN produit pour une grille + client.
  - Réponse : `{ idProduitPrix, modeleContenant, modeleLot, modeleClientType, prixHT, horsDroits }`.
  - ✅ **APPELER PAR CLIENT** (`idClient` réel) → l'endpoint renvoie **le bon prix du client**, y compris tarifs custom.
    ⚠️ **CORRECTION (2026-06-22)** : « tous les pros au même prix » était **FAUX** (test précédent biaisé : type varié mais même client).
    Vérifié sur de **vrais clients de types différents** (produit Cola 6×1L 150176) :
    | Type client | prixHT | Grille résolue |
    |---|---|---|
    | GMS, CHR, Festival, Camping, Particulier, client PRO | 27,30 € | client PRO |
    | **Distributeur** (ex. Halle Bio d'Aquitaine) | **21,84 €** | **Distributeur** (grille distincte) |
    | N/A | aucun prix | — |
    → **Le prix dépend bien du type/grille du client** (Distributeur ≠ PRO) **et** de tarifs **personnalisés par client** (ex. Biocoop Sarlat, via `idClient`). Toujours interroger l'endpoint **avec le couple type+idClient réel du client connecté** — ne jamais supposer un prix unique.
  - Grilles sans tarif défini pour le produit (`Particulier livraison` 16966, `N/A` 16938) → objet quasi vide (pas de `prixHT`).
  - `listeRemises` au niveau du prix = `[]` dans le compte test (remises gérées via `/parametres/remise*` / `/parametres/client/remise/editer`).
- **Écriture (admin)** — endpoints présents (Swagger), non encore testés :
  `POST /parametres/produit/enregistrer`, `POST /stock/bouteilles/enregistrer`,
  `POST /parametres/grille-tarifaire/enregistrer`, `POST /parametres/remise`,
  `POST /parametres/frais-livraison/enregistrer`, `POST /parametres/client/remise/editer`.
  → Easybeer peut servir de **source de vérité en lecture ET écriture** pour produits/tarifs/remises/stock/frais.

### Livraison
- **`GET /parametres/frais-livraison/liste`** — franco / frais de livraison. Renvoie `[]` dans le compte test (non configuré côté Easybeer pour l'instant).
- **Mode de livraison par client** : `ModeleClient.typeLivraisonFav` (string) + `typeLivraisonFavFormulaire` (array).
  ⚠️ **Vide sur les 234 clients du compte test** → la fonctionnalité existe mais n'est pas utilisée par GOA aujourd'hui.
  Attribution : `POST /parametres/client/type-livraison/attribuer` (`ModeleClientAttribuerTypeLivraison` :
  `idsClients[]`, `typeLivraisonFavFormulaire[]`). Pas d'endpoint public de **liste** des types (référentiel 404).
- **Sur la commande** : `ModeleCommande.typeLivraison` (`ModeleLivraisonType` = `{code, libelle}`) +
  `immatriculationTransporteur` (string) → le concept transporteur est nativement modélisé sur la commande.
  Cf. QR.txt : GOA veut classer ses clients par « type de logistique (transporteur / direct) » → c'est le rôle de `typeLivraisonFav`.
- **Tournées = zones géographiques** (`GET /parametres/client/tournee`). GOA a **3 tournées** : AGEN, LIBOURNE, LIMOGES.
  `ModeleClientTournee` = `{ idClientTournee, libelle, minimumCommande }` → **le minimum de commande peut être défini PAR tournée (= par zone)** (non rempli aujourd'hui).
  Le client porte `tournee` (`ModeleClientTournee`) — **null/non assigné** sur le client test.
  Endpoints : `tournee/attribuer`, `tournee/enregistrer`, `tournee/supprimer`, `tournee/edition/{id}`.
  - ✅ **Écritures VALIDÉES en réel (2026-07-08)** : `tournee/enregistrer` (`{libelle, minimumCommande}` → `{id}`),
    **`tournee/attribuer` BULK** (`{idClientTournee, idsClients:[…]}` → assigne plusieurs clients d'un coup),
    `tournee/supprimer` (`{idClientTournee, detacherClients:true}` → supprime la tournée + détache les clients).
    ⚠️ `tournee/supprimer` renvoie un **message d'erreur « 500 opaque » trompeur mais RÉUSSIT** (vérifier l'état après, pas le message).
  - **Bulk params clients** : `type-livraison/attribuer` a la même structure (`{idsClients:[…], typeLivraisonFavFormulaire:[string]}`)
    → marchera pareil, mais **code exact du type de livraison inconnu** (référentiel 404) — à récupérer en réglant 1 client dans l'UI puis relecture.
  → La **« région »** de la question minimums/frais **existe déjà = tournée**. Minimum par zone natif ; **frais par zone NON natif**
  (la tournée n'a pas de champ frais ; frais reste par client `fraisLivraisonHT`).
- **Délais de livraison** : pas de règle « livré sous N jours » native. Leviers : tournée (zone récurrente, mais **pas de
  calendrier/fréquence** dans le modèle), `ModeleClient.informationLivraison` (texte libre), `ModeleCommande.dateLivraisonPrevue`
  (date par commande). Champs `delaiMoyen`/`delaiDerniereCommande` sur le client = **stats calculées**, pas de la config.

### ⚠️ Modèle produit : produits FINIS vs matières premières
- L'app B2B ne concerne **QUE les produits finis** = kombuchas conditionnés (bouteille/carton).
  Les **matières premières** vivent ailleurs (`/stock/matieres-premieres/*`) — **ne jamais les exposer au client**.
- Bon endpoint produits finis commandables : **`GET /stock/produits/autocomplete?accesPro=true`**.
- Le **produit** (saveur) se décline en **contenant** (Bouteille 1L / 0,35L) et en **lot/colisage**
  (`modeleLot { idLot, libelle, quantite }`, ex. « Carton de 6 », quantité 6). L'unité commandable réelle =
  le couple **contenant × colisage** = un `idStockBouteille` distinct.
- **6 saveurs** (compte test) : Cola-Chaï, Framboise-Hibiscus, Gingembre-Citron, Mangue-Vanille,
  Orange Sanguine, Pomme-Sureau. Toutes en 0,0°, TVA 5,5 %.
- Colisages présents dans Easybeer : **1L → Carton de 6** (idLot 3) ; **0,35L → Carton de 18** (idLot 13).

### ⚠️ Désynchro colisage 0,35L à confirmer avec le client
- Le **Jotform actuel** (système de commande en prod du client) vend le 0,35L en
  **« NOUVEAU COLISAGE : 12×35cL »**, alors qu'Easybeer n'expose qu'un **Carton de 18** (idLot 13).
  Le 1L est cohérent des deux côtés (colisage ×6).
  → **Question ouverte** : le colisage 12×35cL doit-il être créé/mis à jour dans Easybeer, ou le 18 est-il
  obsolète ? Impact direct sur le mapping unité de vente ↔ `idStockBouteille`. À trancher avant le dev catalogue.

### Jotform actuel (référence du flux en prod)
- URL : `https://eu-submit.jotform.com/250616156317050`. C'est le système de commande **actuel** du client
  (envoyé par mail 1 semaine avant la tournée, recopié à la main dans Easybeer — source d'erreurs).
- Champs : **Commerce** (liste déroulante, obligatoire — identifie le client connu), **Email** (option, pour récap),
  **Commentaire**, anti-spam. Produits regroupés par **Carton 1L (colisage ×6)** et **Carton 35cL (12×35cL)**,
  une quantité par saveur. **Aucun prix, ni livraison, ni paiement affichés** (les clients connaissent les tarifs par ailleurs).
  → La plateforme V1 doit au minimum **reproduire ce flux** proprement (login obligatoire au lieu du champ Commerce).

### Commandes
- **`POST /commande/enregistrer`** — crée une commande/devis. Voir §4.
- **`GET /commande/supprimer/{idCommande}`** — supprime une commande/devis (nettoyage).
- **`GET /commande/derniere-commande/{idClient}`** — dernière commande d'un client (lecture seule,
  utile comme **gabarit** pour comprendre la structure attendue).
- **`POST /commande/liste/{etat}`** — liste paginée. Query : `colonneTri` (ex. `numero` ; `dateCreation` **invalide** → 200 vide),
  `numeroPage` (≥ 1), `nombreParPage` ; body `ModeleCommandeFiltre`.
  - **Historique complet d'un client (recette validée)** : body `{ "idClient": <id>, "inclureArchive": true }`.
    ⚠️⚠️ **Le filtre `idClient` ne fonctionne QUE si `inclureArchive: true` est présent** — sinon HTTP **200 corps vide**
    (même famille que l'`idClient` qui casse l'autocomplete). Sans `idClient`, body `{}` renvoie les commandes **de tous les clients**.
  - ⚠️ Avec `idClient` renseigné, **l'`{etat}` du path est ignoré** → un seul appel (n'importe quel `{etat}`) renvoie
    **tout l'historique** du client. Pas besoin d'itérer les états.
  - La **liste** est un résumé (`numero`, `etat`, `paiementEtat`, `totalTTC`, `dateCreation`) ; pas de `reference`
    ni de lignes produits → pour le détail, `GET /commande/edition/{idCommande}` (lignes dans `elementsBouteilles[]`).

### Documents (factures / bons de livraison) — « fichiers » de la demande initiale
- Exposés par l'API → un client pourrait consulter/télécharger ses documents depuis la plateforme :
  - `GET /commande/document/telecharger/{idCommandeDocument}` — télécharger un PDF
  - `GET /commande/document/visualiser/{idCommandeDocument}` — visualiser
  - `GET /commande/documents/telecharger/{idCommande}` — tous les documents d'une commande
  - `POST /commande/pdf` — générer le PDF ; `POST /document/liste` — lister
- Les documents (BL, factures, avoirs) sont **générés dans Easybeer** ; la plateforme ne fait que les récupérer.

### Historique / suivi de commande (côté client) — vérifié
- Données dispo par commande (`derniere-commande` / `edition`) : `numero`, `reference` (ex. FA0751),
  `etat` (+ icône/couleur), `paiementEtat` (+ `resteAPayer`), `totalHT`/`totalTTC`/`montantPaye`,
  dates (`dateCreation`, `dateValidation`, `dateDepartLivraison`, `dateLivraisonReelle`, `dateFacturation`,
  `dateEcheancePaiement`), `adresseLivraison`, `elementsBouteilles[]` (lignes), `remiseTotale`, `totalConsigne`.
- **États commande** (`GET /referentiel/commande/etat`) : DEVIS, EN_ATTENTE_STOCK, EN_COURS, DIFFEREE,
  VALIDEE, PREPARATION, PRETE, LIVRAISON, LIVREE, ANNULEE, REGROUPEMENT.
- **États paiement** (`GET /referentiel/commande/etat/paiement`) : GRATUITE, PAYEE, NON_PAYEE,
  PARTIELLEMENT_PAYEE, EN_ATTENTE, NON_SOLVABLE, ERREUR_PAIEMENT.
- → Suivi « temps réel » possible : la plateforme lit l'état en direct ; GOA fait avancer la commande dans Easybeer.
- ⚠️ **Parsing** : certaines réponses commande contiennent des **caractères de contrôle** (sauts de ligne dans
  un commentaire) qui cassent un JSON strict → parser en mode tolérant côté serveur.

---

## 4. `POST /commande/enregistrer` — recette validée

Body = `ModeleCommande` (163 champs dans le Swagger, mais **références légères par id suffisent**).

### Champs réellement requis
| Niveau | Champs |
|---|---|
| Commande | `client { idClient }`, `grilleTarifaire { idClientType }` (la **racine**), `commentaire` (non vide), `tauxTVAFraisLivraison { idTauxTVA }`, `elementsBouteilles[]` |
| Ligne (`elementsBouteilles[i]`) | `stockBouteille { idStockBouteille }`, `stockProduit` (objet **complet** de l'autocomplete), `quantite`, `prixUnitaireHTHorsRemise`, `tauxTVA { idTauxTVA }` |

- Sans `grilleTarifaire` → **400** « Vous devez choisir une grille tarifaire ».
- Sans `tauxTVAFraisLivraison` → **500** « erreur inconnue ».
- `estDevis: true` → crée un **devis** (réversible) au lieu d'une commande ferme.

### Exemple de payload minimal
```jsonc
{
  "client": { "idClient": 588074 },
  "grilleTarifaire": { "idClientType": 17849 },   // racine "client PRO"
  "commentaire": "Commande POC",
  "tauxTVAFraisLivraison": { "idTauxTVA": 13087 }, // 5,5 %
  "estDevis": true,
  "elementsBouteilles": [
    {
      "stockBouteille": { "idStockBouteille": 150176 },
      "stockProduit": { /* objet renvoyé par /stock/produits/autocomplete */ },
      "quantite": 2,
      "prixUnitaireHTHorsRemise": 18.90,
      "tauxTVA": { "idTauxTVA": 13087 }
    }
  ]
}
```

### Réponse
- **Succès** : HTTP **200** avec `{ "map": { "id": <idCommande>, "numero": <n>, "message": "" } }`.
  ⚠️ L'id est dans **`map.id`** (pas `idCommande`, pas `objet`).
- **Échec métier** : `{ "succes": false, "message": "...", "map": {} }` (HTTP 400/500).

### ✅ Modification de commande en place (upsert) — vérifié 2026-06-30
- `POST /commande/enregistrer` est un **upsert** : renvoyer l'objet **avec son `idCommande`** existant
  → **met à jour la commande en place** (même id, même numéro), **pas de doublon**.
- Recette validée : `GET /commande/edition/{id}` → modifier `elementsBouteilles` / `commentaire` → re-`enregistrer`.
  Test réel : devis id 2690754, quantité 2→5 + commentaire modifié, id inchangé. (Au 2ᵉ enregistrement, `map.numero` revient `null` mais l'update est bien appliqué.)
- → Permet un **vrai « Modifier ma commande »** côté client (bien mieux que supprimer+recréer). Garde-fou applicatif :
  n'autoriser l'édition que selon l'`etat` (ex. tant que ≠ VALIDEE/PREPARATION/LIVREE — à trancher avec le client).

---

## 5. Compte de test (POC)

- Brasserie : **LA BRASSERIE DE GOA** (`idBrasserie` 1951), entrepôt « Brasserie de GOA » (`idEntrepot` 2287).
- TVA kombucha : **5,5 %** → `idTauxTVA` **13087**.
- Grilles tarifaires (racines) : `client PRO` = 17849, `Particulier (livraison)` = 16966, `N/A` = 16938.
- Sous-types CRM (enfants de 17849) : GMS 20680, CHR 20776, Distributeur 20735, Camping 21503, Festival 21504, Particulier 21505.

---

## 6. Bonnes pratiques de test

- Tester les écritures en **`estDevis: true`**, puis nettoyer via `GET /commande/supprimer/{id}`.
- Pour un test **create + suppression atomique** : créer, lire `map.id`, supprimer dans la foulée — ne pas laisser d'orphelin.
- Pour comprendre un payload qui plante en 500 : récupérer une vraie entité via un `GET …/derniere-commande` ou `…/edition` et s'en servir de gabarit, puis réduire champ par champ.

---

## 7. Journal des découvertes

- **2026-06-19** : Phases 1-2 (proxy Basic Auth + liste clients) ; pagination 1-indexée.
  Phase 3 (injection commande) : grille = racine du type, `tauxTVAFraisLivraison` requis,
  réponse succès `{map:{id}}`, références légères suffisantes. Recette `/commande/enregistrer` validée.

- **2026-06-20** : Question « source de vérité ». Prix via `GET /parametres/prix/{idStockBouteille}/{idClientType}/{idClient}`
  (`prixHT`). Confirmé : **prix par grille RACINE**, les sous-types CRM se résolvent vers `client PRO` (même prix)
  → cohérent avec le besoin client (même tarif pour tous les pros, le type ne sert qu'au franco/logistique).
  `afficherTarif=true` sur l'autocomplete ne renvoie pas de prix. `frais-livraison/liste` vide (non configuré).
  Endpoints d'écriture admin (produit/grille/remise/frais) présents → Easybeer viable comme source de vérité R/W.

- **2026-06-20 (suite)** : Remises — `listeRemises`/`listeParticipations` portées par le client
  (`/parametres/client/edition/{id}`), **vides** dans le test (pas de remise individuelle utilisée).
  Endpoints export remises en 500 (params à trouver). Fiche client expose adresses de livraison géocodées +
  délai de paiement. Modèle produit = produit fini (saveur) × contenant × colisage (idLot) = idStockBouteille.
  Désynchro colisage 0,35L : Jotform 12×35cL vs Easybeer Carton de 18 → à confirmer. Jotform = flux prod à reproduire.

- **2026-07-08 (dev V1, étape 2)** : le filtre `idsClients` de `POST /parametres/client/liste` est
  **silencieusement ignoré** (renvoie la liste complète, même famille que `idClient` sur l'autocomplete
  et `commande/liste` sans `inclureArchive`). Lecture d'un client individuel → `GET /parametres/client/edition/{id}`
  (déjà documenté §3, confirmé OK sur 601666). `generatePasswordResetLink` (Firebase Admin) + extraction
  `oobCode` → page `/activer` de l'app : flux d'invitation validé de bout en bout sur émulateurs.

<!-- Ajouter ici toute nouvelle découverte, avec la date. -->
