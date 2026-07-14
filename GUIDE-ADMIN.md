<!-- guide-version: 1.1 -->
<!-- guide-updated-at: 2026-07-13 -->

# Guide administrateur — plateforme de commande GOA

Ce guide explique comment fonctionne la plateforme côté administration.

---

## 1. Le principe : Easybeer est la source de vérité

La plateforme **ne remplace pas Easybeer** : elle s'appuie dessus. Les produits,
les prix, les clients, les remises, les commandes vivent dans **Easybeer**. La
plateforme en est un **miroir** pour vos clients (catalogue, prix, historique) et
**pousse les commandes** vers Easybeer.

Conséquence simple à retenir : **pour changer un prix, un produit, une remise ou
une info client → faites-le dans Easybeer.** La plateforme se met à jour toute
seule à la synchronisation suivante.

## 2. Qui gère quoi

| Vous gérez **dans Easybeer**         | Vous gérez **dans la plateforme (admin)**                         |
| ------------------------------------ | ----------------------------------------------------------------- |
| Prix, grilles tarifaires, remises    | Visibilité des produits (ce que le client voit)                   |
| Fiches produits, conditionnements    | Nom d'affichage et photo d'un produit                             |
| Fiches clients, adresses, catégories | Rupture (afficher « en rupture »)                                 |
| Tarifs personnalisés par client      | Invitations des clients (création de compte)                      |
|                                      | Paramètres clients en masse (tournée, mode de livraison, minimum) |

## 3. Synchronisation (fraîcheur des données)

Pour ne pas saturer Easybeer, la plateforme **ne lit jamais Easybeer en direct**
à chaque visite d'un client : elle lit un **cache** rempli périodiquement par une
**synchronisation**.

- La synchro tourne **automatiquement** (planifiée, ex. la nuit / toutes les
  quelques heures).
- Vous pouvez la **déclencher à la main** avec le bouton **« Actualiser depuis Easybeer »**
  (utile juste après un changement important dans Easybeer).
- Entre un changement dans Easybeer et la synchro suivante, les clients voient
  **la dernière version synchronisée**.

**Garde-fou prix** : un prix qui n'a pas été rafraîchi depuis trop longtemps
(36 h par défaut) **bloque la commande** de cet article (message « tarif en cours
de vérification, contactez GOA ») plutôt que de risquer un prix erroné. De plus,
Easybeer **recalcule le prix réel** au moment de la commande : le prix affiché est
indicatif, la facture est toujours au prix Easybeer courant.

## 4. Le catalogue

La page **Catalogue** liste **toutes les unités tarifées** d'Easybeer — chaque
conditionnement (Unité, Carton de 6, 12, 18, Fût…) apparaît **individuellement**,
avec son ou ses tarifs par type de client.

Pour chaque unité vous pouvez :

- **Visible** : afficher ou non l'unité côté client. **Masqué par défaut** — un
  produit n'apparaît au client que si vous l'avez rendu visible.
- **Rupture** : afficher « en rupture » (le client voit le produit mais ne peut
  pas le commander).
- **Nom d'affichage** : un libellé plus commercial que celui d'Easybeer.
- **Photo** : glissez une image sur la vignette.

La **visibilité s'applique à l'unité** (un conditionnement) : tous ses tarifs
suivent. Le client ne voit que **le prix de son type** (voir §5).

> **La rupture est gérée ICI, pas par le stock Easybeer.** Un produit en stock
> chez Easybeer peut être masqué/en rupture dans l'app, et inversement : c'est
> **vous** qui pilotez la disponibilité affichée au client via ces interrupteurs.

## 5. Comment le prix du client est déterminé

Les types de client Easybeer sont **hiérarchiques**. GOA n'a défini des prix que
pour **deux grilles** : `client PRO` et `Distributeur`. Les autres types héritent
de `client PRO` :

| Type du client                               | Grille appliquée |
| -------------------------------------------- | ---------------- |
| client PRO, GMS, CHR, Festival, Particulier… | **client PRO**   |
| Distributeur                                 | **Distributeur** |

Donc un client GMS ou CHR voit le prix `client PRO` ; seul un Distributeur voit le
prix Distributeur. Si un client a un **tarif négocié personnalisé** dans Easybeer,
c'est ce prix-là qui prime.

> **Les prix affichés dans le catalogue et le panier sont des tarifs de base HT**,
> **hors remises et hors consigne**. Easybeer applique la remise du client et la
> consigne à la **facturation** : au moment de la commande, l'écran de confirmation
> et l'historique affichent donc le **montant réel calculé par Easybeer** (remise
> et consigne incluses), qui peut différer du total « indicatif » du panier. Le
> **minimum de commande** est lui comparé au total **avant remise** (ce que le
> client voit dans son panier).

## 6. Clients et invitations

- La liste **Clients** vient du cache Easybeer. Cliquez sur un client pour sa
  fiche (conditions commerciales, historique, comptes plateforme).
- **Inviter un client** : depuis la liste (bouton « Inviter » / « Inviter la
  sélection ») ou depuis sa fiche. Un **email** « créez votre mot de passe » lui
  est envoyé automatiquement ; un **lien** est copiable si besoin.
- Les liens d'invitation sont **valables 14 jours**, **à usage unique**. Si un
  client a déjà un compte actif, on ne régénère pas de lien — il utilise « Mot de
  passe oublié ». Vous pouvez **renvoyer** une invitation à tout moment.
- **Paramètres en masse** : sélectionnez des clients (cases à cocher) pour leur
  appliquer d'un coup une **tournée**, un **mode de livraison** ou un **minimum de
  commande** (écrit directement dans Easybeer).

## 7. Transport et livraison

Deux modes de livraison :

- **Palette / frigo (par défaut)** : le mode normal, aucune contrainte de
  colisage. La plateforme ne facture pas de frais de livraison.
- **La Poste J+1** (petits clients type CHR) : colisage contraint → la commande
  doit être un **multiple de 3 cartons de 35 cl** ou **2 cartons de 1 L**. La
  plateforme impose automatiquement ce multiple au panier.

Le mode se gère avec un **tag `laposte`** sur la fiche client Easybeer : un client
tagué `laposte` subit la règle des multiples ; **sans ce tag, il est en mode
palette** (par défaut). Rien à choisir par commande.

## 8. Commandes

- La page **Commandes** liste les commandes récentes (30 derniers jours), depuis
  le cache. Cliquez une commande pour son détail (lignes, totaux, documents).
- Les boutons **« Ouvrir dans Easybeer »** renvoient directement vers la fiche
  correspondante dans Easybeer (commande, client, grille tarifaire).
- Une commande passée sur la plateforme est **poussée dans Easybeer** ; c'est là
  que vous la validez, préparez, facturez.

## 9. Questions fréquentes

**J'ai changé un prix dans Easybeer, le client voit encore l'ancien.**
→ Normal jusqu'à la prochaine synchro. Cliquez **« Actualiser depuis Easybeer »** pour forcer
la mise à jour immédiatement.

**Je rends un produit visible : son prix apparaît-il tout de suite ?**
→ Oui. Le prix vient de la **grille tarifaire** (déjà synchronisée), pas besoin de
resynchroniser. Un éventuel **tarif négocié** propre à un client s'appliquera, lui,
à la synchro suivante.

**Un bandeau « API Easybeer saturée » apparaît.**
→ Easybeer limite le nombre d'appels. La plateforme attend automatiquement ;
réessayez après le compte à rebours. Les données en cache restent affichées.

**Un client ne reçoit pas son email d'invitation.**
→ Vérifiez ses spams, et que son email est correct dans Easybeer. Sinon, copiez
le **lien** et envoyez-le lui manuellement.

## 10. Support

Pour toute question, contactez le support :

- **Email** : [hello@isaure-lohest.com](mailto:hello@isaure-lohest.com)
- **WhatsApp** : [+34 600 049 801](https://wa.me/34600049801)

Pour aider à résoudre plus vite, ajoutez si possible :

- la **page concernée** (Clients, Commandes, Catalogue, fiche client…) ;
- le **client**, la **commande** ou le **produit** concerné ;
- le **message affiché** ou une capture d'écran ;
- l'heure approximative du problème.
