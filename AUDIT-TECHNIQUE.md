# Audit technique — GOA Kombucha

Date : 2026-07-21

## Synthèse

Le projet a une base saine : TypeScript côté serveur et client, validation Zod
aux frontières, authentification serveur, secrets Easybeer non exposés, caches
Firestore conservés lors des erreurs partielles, file d'attente Easybeer à
1 requête/seconde, disjoncteur de ban persisté et tests métier sur les prix,
remises et règles de commande.

Le risque principal était la fraîcheur opérationnelle : un cache client absent
était réparé, mais un catalogue/grille ancien ne déclenchait aucune réparation
depuis la boutique. Une panne du job planifié pouvait donc conduire à des prix
de plus de 36 h, puis à un catalogue visible mais non commandable. Les travaux de
cet audit ajoutent une revalidation proactive et une réparation synchrone au
seuil dur, sans supprimer le dernier snapshot valide.

## Flux de cache après audit

1. La boutique lit uniquement Firestore et sert le dernier snapshot valide.
2. Catalogue/grille âgés de 30 minutes : revalidation en arrière-plan.
3. Prix du client âgés de 6 heures : rafraîchissement ciblé (fiche + produits
   visibles seulement).
4. Catalogue/grille arrivés à la limite dure de 36 heures : une tentative de
   réparation est attendue avant la réponse.
5. Article qui resterait sans prix frais : une réparation client ciblée est
   attendue avant de renvoyer le catalogue.
6. Le navigateur re-sonde toutes les 30 secondes tant qu'une revalidation est
   signalée, et toutes les 4 secondes pendant la création initiale du cache.
7. Les erreurs et bans ne remplacent jamais un cache valide par du vide.

Ces seuils sont configurables : `CATALOGUE_AUTO_REFRESH_MINUTES`,
`PRIX_AUTO_REFRESH_MINUTES`, `PRIX_COMMANDE_MAX_AGE_MINUTES`,
`CLIENTS_AUTO_REFRESH_MINUTES`, `COMMANDES_AUTO_REFRESH_MINUTES`,
`CACHE_AUTO_REFRESH_COOLDOWN_MINUTES` et `PRIX_CACHE_MAX_AGE_MINUTES`.

## Appels Easybeer et protection contre les bans

- Tous les appels d'une instance passent par une file FIFO espacée d'une seconde.
- Un timeout de 20 secondes empêche une connexion suspendue de bloquer toute la
  file (`EASYBEER_TIMEOUT_MS`).
- Les réponses 400 de ban et 429 ouvrent un disjoncteur ; son échéance est
  persistée dans Firestore et restaurée après redémarrage.
- Les travaux de cache (synchro complète, catalogue/grille, prix ciblés) partagent
  désormais un verrou Firestore global entre instances.
- La synchro complète entretient son verrou par heartbeat : une exécution longue
  ne peut plus être doublée après 15 minutes.
- Les tentatives automatiques ont un cooldown persistant de 10 minutes.
- Une tentative partielle ne marque plus le tableau de bord « à jour » : la date
  affichée est celle du dernier succès complet, tandis que le rapport d'échec est
  conservé pour le diagnostic.

Coût théorique d'une revalidation globale : `2 + T` appels (`T` = nombre de
types Easybeer interrogés : catalogue, types, puis une matrice par type). Coût
d'un client ciblé : `1 + V` appels (`V` = unités visibles). Les prix des unités
masquées ne sont pas interrogés.

## Consommation Firestore

Avant cet audit, chaque lecture de boutique relisait toute la collection
`catalogueOverrides`, soit environ une lecture par unité catalogue. Elle lit
maintenant un agrégat `cache/catalogueOverrides` maintenu transactionnellement à
chaque modification admin.

Pour la couche catalogue (hors lecture d'authentification), une requête normale
passe donc d'environ `4 + N` lectures (`N` overrides) à environ 5 documents fixes :
catalogue, grille, référentiels, cache client et overrides agrégés. Les documents
restent bornés : un cache commun pour les produits/grilles, un document de prix
par client et des listes admin séparées.

## Exactitude de l'Aide admin

`AidePage.vue` rend directement `GUIDE-ADMIN.md?raw` : le fichier versionné et la
page sont bien une source unique, sans copie de contenu à synchroniser.

Les affirmations ont été comparées aux routes, règles métier et composants :

- visibilité/rupture par conditionnement, masque par défaut : conforme ;
- grille la plus proche dans la hiérarchie et prix client prioritaire : conforme ;
- prix HT avant remise, minimum contrôlé avant remise : conforme ;
- priorité remise produit sur remise commande et client sur segment : conforme
  aux fonctions testées ; `remise2` n'est pas transmise ;
- tag `laposte`, pas de 3 en 35 cl et 2 en 1 L : conforme front + serveur ;
- invitations 14 jours, usage unique, ancien lien révoqué, refus d'un compte
  actif : conforme ; le texte ambigu « renvoyer à tout moment » a été corrigé ;
- minimum en masse limité à 30 clients : conforme au serveur et à l'UI ;
- commandes récentes sur 30 jours par défaut : conforme ;
- modification refusée seulement pour `LIVREE` et `ANNULEE` côté serveur : le
  risque opérationnel est explicitement documenté ;
- la phrase laissant entendre qu'Easybeer recalculait nécessairement le tarif a
  été corrigée : la plateforme transmet le tarif et relit les totaux Easybeer.

## Risques résiduels et recommandations

### Priorité haute — exploitation

- Le catalogue client n'exige plus de job externe : son cache est entretenu à la
  demande. Un appel quotidien à `POST /api/scheduled/sync` avec
  `SCHEDULER_SECRET` reste recommandé uniquement comme filet de sécurité pour les
  listes admin et les périodes sans consultation.
- Ajouter une alerte externe si `cache/meta.dernierSync.syncedAt` dépasse 24 h ou
  si le rapport contient des erreurs. Le tableau de bord avertit, mais ce n'est
  pas une alerte proactive.
- Valider la règle de modification des vraies commandes avec GOA : une commande
  en préparation reste actuellement modifiable tant qu'Easybeer ne la marque pas
  `LIVREE` ou `ANNULEE`.

### Priorité moyenne — architecture

- La file à 1 requête/seconde est locale au processus. Les travaux de cache sont
  maintenant verrouillés globalement, mais des opérations directes (création de
  commande, fiche admin, invitation) sur plusieurs instances peuvent encore se
  chevaucher. Si Cloud Run monte fortement en charge, utiliser une file distribuée
  (Cloud Tasks) ou limiter le nombre maximal d'instances.
- La fiche client admin et certains détails de commande lisent Easybeer en direct.
  C'est acceptable pour une action admin ponctuelle, mais ces routes doivent rester
  hors rafraîchissement automatique.
- Easybeer ne fournit pas de clé d'idempotence documentée pour la création de
  commande. Le serveur ne retente plus automatiquement une création après un
  timeout/échec réseau ambigu (pour éviter les doublons), mais une vérification
  manuelle de l'historique reste nécessaire dans ce cas rare.
- Un repli d'un tarif personnalisé ancien vers une grille fraîche maintient la
  disponibilité, mais peut temporairement afficher le tarif de base au lieu du
  tarif négocié. La revalidation à 6 h réduit fortement cette fenêtre ; cette
  règle reste un arbitrage métier à confirmer.
- Les rafraîchissements catalogue écrivent catalogue, référentiels puis grille en
  plusieurs documents. Le dernier snapshot est conservé en cas d'échec, mais une
  génération atomique/versionnée serait encore plus robuste contre une lecture
  au milieu d'un refresh.

### Qualité et tests

- Les tests unitaires couvrent les règles sensibles, mais il manque des tests
  d'intégration Firestore pour les verrous, cooldowns, heartbeat et reconstruction
  d'un cache absent.
- Il manque un test de concurrence sur deux requêtes de revalidation simultanées
  et un test end-to-end du scénario « prix expiré → réparation → commande ».
- Les seuils de cache et le timeout Easybeer sont validés au démarrage (valeurs
  positives et seuils proactifs strictement inférieurs au seuil dur).
- Après correction automatique de `protobufjs`, `npm audit` ne trouve plus de
  vulnérabilité côté web. Le serveur conserve 8 alertes modérées transitives sur
  `uuid` via Firebase/Google Cloud ; npm ne propose qu'une migration majeure de
  `firebase-admin`. Ne pas utiliser `npm audit fix --force` sans chantier de
  migration et tests Firebase dédiés.

## Checklist de mise en production

- Si le filet de sécurité est souhaité, configurer et tester `SCHEDULER_SECRET`
  et un job quotidien ; ce n'est pas un prérequis du catalogue client.
- Conserver `PRIX_AUTO_REFRESH_MINUTES <= PRIX_COMMANDE_MAX_AGE_MINUTES < PRIX_CACHE_MAX_AGE_MINUTES`.
- Vérifier le diagnostic `/api/admin/sync/status` après déploiement.
- Déclencher une synchro complète, puis contrôler catalogue, grille et un client
  avec tarif personnalisé.
- Simuler un ban Easybeer et vérifier que le catalogue en cache reste affiché.
- Mettre en place l'alerte externe sur l'âge/les erreurs du dernier rapport.
