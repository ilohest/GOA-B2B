# TODO — Sauvegardes de production GOA

À utiliser après la création du projet Firebase de production au nom du client.

> Ne jamais exécuter une commande de production sans vérifier le projet ciblé.
> Le projet local `demo-goa-kombucha` est réservé aux émulateurs et au développement.

## 1. Propriété, accès et facturation

- [ ] Faire créer le projet Firebase par le client avec son compte professionnel.
- [ ] Noter l'identifiant du projet de production : `____________________________`.
- [ ] Vérifier que le client possède le rôle **Owner / Propriétaire**.
- [ ] Ajouter au moins un deuxième propriétaire de confiance côté client afin d'éviter la dépendance à un seul compte.
- [ ] Ajouter le développeur avec uniquement les droits nécessaires à l'exploitation.
- [ ] Relier le projet au compte de facturation du client et activer le forfait Firebase **Blaze**.
- [ ] Configurer des alertes de budget Google Cloud, par exemple à 10 €, 25 € et 50 €.
- [ ] Activer l'authentification multifacteur sur tous les comptes propriétaires.
- [ ] Vérifier que les coordonnées de récupération des propriétaires sont à jour.

## 2. Séparer développement et production

- [ ] Conserver le projet Firebase personnel uniquement pour le développement et les tests.
- [ ] Ne pas importer les utilisateurs, commandes ou invitations de test dans la production.
- [ ] Ajouter le projet de production à Firebase CLI avec un alias explicite :

  ```bash
  firebase login
  firebase use --add
  ```

- [ ] Nommer l'alias `prod`.
- [ ] Vérifier le projet avant toute commande sensible :

  ```bash
  firebase use
  firebase projects:list
  ```

- [ ] Toujours utiliser `--project prod` dans les commandes de sauvegarde et de restauration.

## 3. Sauvegardes Firestore

Les données prioritaires à protéger sont notamment :

- `users` ;
- `orders` ;
- `catalogueOverrides` ;
- `invitations`.

Les collections et documents `cache*` sont moins critiques, car ils peuvent être reconstruits depuis Easybeer.

- [ ] Dans Google Cloud Console, ouvrir **Firestore → Bases de données → `(default)` → Reprise après sinistre**.
- [ ] Activer une sauvegarde **quotidienne** avec une conservation de **4 semaines**.
- [ ] Activer une sauvegarde **hebdomadaire**, le dimanche, avec une conservation de **12 semaines**.
- [ ] Vérifier les planifications depuis Firebase CLI :

  ```bash
  firebase firestore:backups:schedules:list \
    --database "(default)" \
    --project prod
  ```

- [ ] Après la première exécution, vérifier qu'au moins une sauvegarde est réellement présente :

  ```bash
  firebase firestore:backups:list --project prod
  ```

- [ ] Noter ici la date de la première sauvegarde réussie : `____ / ____ / ______`.

Documentation : [Sauvegardes Firestore](https://firebase.google.com/docs/firestore/backups?hl=fr)

## 4. Restauration à un instant précis — PITR

- [ ] Activer la récupération à un instant précis (**Point-in-time recovery / PITR**) sur la base Firestore de production.
- [ ] Vérifier que la fenêtre de récupération de sept jours est active.
- [ ] Documenter qui est autorisé à lancer une restauration.
- [ ] Ne jamais restaurer directement pendant un incident sans identifier précisément l'heure précédant la corruption.

Attention : une restauration gérée Firestore crée une nouvelle base. L'application GOA utilise actuellement la base `(default)` ; le retour vers la production devra donc être préparé et testé.

Documentation : [Export, import et PITR Firestore](https://firebase.google.com/docs/firestore/manage-data/export-import)

## 5. Protection des photos Firebase Storage

- [ ] Créer le bucket Firebase Storage de production dans une région cohérente avec Firestore.
- [ ] Relever son nom exact : `____________________________________________`.
- [ ] Vérifier si son suffixe est `.firebasestorage.app` ou `.appspot.com`.
- [ ] Rendre le nom du bucket configurable dans le backend avant le déploiement ; ne pas supposer qu'il se termine par `.appspot.com`.
- [ ] Dans Google Cloud Console, ouvrir **Cloud Storage → Buckets → bucket GOA → Protection**.
- [ ] Activer ou vérifier le **soft delete**.
- [ ] Régler sa durée de conservation sur **30 jours**.
- [ ] Vérifier que les dossiers suivants sont protégés :
  - `produits/` ;
  - `produits-drafts/`.
- [ ] Tester la suppression puis la récupération d'une photo de test.
- [ ] Vérifier les règles de cycle de vie afin qu'elles ne suppriment pas trop tôt les objets récupérables.

Documentation : [Cloud Storage for Firebase](https://firebase.google.com/docs/storage/web/start)

## 6. Sauvegarde de Firebase Authentication

Les utilisateurs Firebase Authentication ne sont pas inclus dans une sauvegarde Firestore.

- [ ] Créer un emplacement local temporaire non versionné pour les exports.
- [ ] Ajouter le dossier d'exports à `.gitignore`.
- [ ] Tester un premier export manuel :

  ```bash
  firebase auth:export users-production.json \
    --format=json \
    --project prod
  ```

- [ ] Chiffrer le fichier immédiatement après l'export.
- [ ] Supprimer ensuite la copie non chiffrée.
- [ ] Stocker la copie chiffrée hors du VPS et hors du dépôt Git.
- [ ] Automatiser un export **hebdomadaire**.
- [ ] Conserver au minimum les quatre derniers exports hebdomadaires.
- [ ] Restreindre l'accès aux exports, car ils contiennent des données personnelles et des informations d'authentification sensibles.
- [ ] Tester l'import uniquement dans un projet Firebase de test distinct.

Documentation : [Import et export Firebase Authentication](https://firebase.google.com/docs/cli/auth)

## 7. Sauvegarde de la configuration du VPS

- [ ] Activer les sauvegardes automatiques proposées par Hostinger.
- [ ] Créer un snapshot manuel avant chaque déploiement important ou mise à jour système.
- [ ] Sauvegarder quotidiennement, sous forme chiffrée :
  - la configuration Docker Compose ;
  - la configuration Caddy ou Nginx ;
  - les scripts de déploiement et de sauvegarde ;
  - les variables d'environnement ;
  - les références nécessaires aux secrets.
- [ ] Envoyer ces sauvegardes vers un stockage externe au VPS.
- [ ] Conserver sept sauvegardes quotidiennes et quatre sauvegardes hebdomadaires.
- [ ] Vérifier qu'une compromission du VPS ne permet pas aussi d'effacer les sauvegardes externes.

Ne pas considérer le snapshot Hostinger comme une sauvegarde de Firestore, Authentication ou Firebase Storage.

## 8. Secrets et comptes de service

- [ ] Créer un compte de service dédié au backend de production.
- [ ] Lui accorder uniquement les rôles nécessaires.
- [ ] Ne jamais committer sa clé JSON.
- [ ] Ne jamais inclure une clé JSON non chiffrée dans une sauvegarde ordinaire.
- [ ] Conserver une copie protégée des variables et secrets suivants :
  - identifiants Easybeer ;
  - identifiants SMTP ;
  - secret du scheduler ;
  - configuration Firebase du serveur ;
  - configuration Firebase publique du frontend.
- [ ] Documenter la procédure permettant de révoquer et recréer une clé compromise.
- [ ] Programmer une revue annuelle des comptes de service et de leurs clés.

## 9. Supervision des sauvegardes

- [ ] Désigner la personne qui vérifie les sauvegardes : `____________________________`.
- [ ] Créer une alerte si une sauvegarde Firestore planifiée échoue.
- [ ] Vérifier mensuellement la date des dernières sauvegardes Firestore et Auth.
- [ ] Vérifier mensuellement l'espace occupé et le coût des sauvegardes.
- [ ] Ajouter la vérification des sauvegardes à la checklist de maintenance du projet.
- [ ] Conserver une trace des tests et incidents de restauration.

## 10. Test de restauration avant mise en production

- [ ] Restaurer une sauvegarde Firestore dans une base de test.
- [ ] Vérifier les collections `users`, `orders`, `catalogueOverrides` et `invitations`.
- [ ] Vérifier qu'une commande et ses lignes sont cohérentes après restauration.
- [ ] Récupérer une photo supprimée grâce au soft delete Storage.
- [ ] Tester un export Auth dans un projet isolé, sans toucher à la production.
- [ ] Restaurer la configuration GOA dans un VPS ou conteneur temporaire.
- [ ] Mesurer le temps total nécessaire à la remise en service.
- [ ] Corriger et documenter les étapes qui ont échoué.
- [ ] Refaire ce test tous les trois à six mois.

## Critères minimum avant ouverture aux clients

- [ ] Le client possède le projet et sa facturation.
- [ ] Deux propriétaires de confiance ont accès au projet.
- [ ] Une sauvegarde Firestore quotidienne a déjà réussi.
- [ ] Le PITR Firestore est actif.
- [ ] Le soft delete Storage est actif et testé.
- [ ] Un export Auth chiffré a été réalisé et copié hors du VPS.
- [ ] Les secrets ne sont présents ni dans Git ni dans une sauvegarde non chiffrée.
- [ ] Une restauration Firestore de test a été validée.
- [ ] La personne responsable des sauvegardes et des restaurations est identifiée.
