# Plan de Développement : POC Intégration B2B Kombucha & Easybeer API

## 1. Objectif du POC

Valider la faisabilité technique de l'interconnexion directe entre notre interface sur-mesure (Vue.js / Vite / TypeScript) et l'API d'Easybeer.
Le POC doit valider trois fonctionnalités critiques :

1. L'authentification Basic Auth sécurisée via un proxy local (évitement des blocs CORS).
2. La récupération de la liste des clients existants depuis Easybeer.
3. L'envoi automatique d'une commande de test dans Easybeer.

## 2. Architecture Technique Cible

- **Frontend :** Single Page Application avec Vue 3, Vite, TailwindCSS (ou minimaliste pour le POC).
- **Backend / Proxy :** Un micro-serveur Node.js (Hono ou serveur de dev Vite configuré en proxy) pour intercepter les requêtes du Front, injecter les en-têtes de sécurité (Basic Auth) et relayer vers `api.easybeer.fr`.
- **Référentiel API :** Basé sur les spécifications officielles du fichier `easybeer-api-docs.json` présent à la racine.

## 3. Phases d'Exécution

### Phase 1 : Configuration du Proxy de Dev & Authentification

- Configurer le fichier `.env` pour stocker les identifiants de test Easybeer (`EASYBEER_USERNAME` et `EASYBEER_PASSWORD`).
- Mettre en place le proxy pour rediriger les requêtes `/api/*` locales vers `https://api.easybeer.fr/*`.
- Injecter automatiquement l'en-tête `Authorization: Basic <credentials>` sur toutes les requêtes sortantes vers Easybeer.

### Phase 2 : Récupération du Fichier Clients

- Implémenter un service HTTP pour appeler l'endpoint `POST /parametres/client/liste`.
- Générer le payload minimum requis par `ModeleClientFiltre` (pagination, tri, etc.) défini dans la spécification JSON.
- Afficher le résultat dans une vue Vue.js simple (un tableau ou une liste déroulante) pour valider la bonne réception de la base de données.

### Phase 3 : Injection d'une Commande de Test

- Créer un formulaire ou un bouton de déclenchement rapide "Passer une commande fictive".
- Construire l'objet payload basé sur le schéma `ModeleCommande`.
- Mapper au minimum : l'ID du client sélectionné, un commentaire textuel, et un tableau d'éléments produits (`elementsBouteilles`) avec ID produit, quantité et prix de base.
- Appeler l'endpoint `POST /commande/enregistrer` et intercepter la réponse pour valider le succès de l'opération (réception d'un `ModeleResultat` valide).
