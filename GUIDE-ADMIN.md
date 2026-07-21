<!-- guide-version: 1.27 -->
<!-- guide-updated-at: 2026-07-21 -->

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

## 3. Mise à jour des informations Easybeer

Pour éviter de trop solliciter Easybeer, la plateforme conserve temporairement
la dernière version connue des produits, des prix et des clients.

- Quand un client ouvre la boutique, la plateforme vérifie automatiquement si
  les informations ont moins de **30 minutes**.
- Si elles sont plus anciennes, elle demande une mise à jour à Easybeer. Une
  seule mise à jour suffit alors pour tous les clients.
- Pendant cette mise à jour, la boutique reste disponible avec la dernière
  version connue. Le client n'a rien à faire.
- Les tarifs négociés propres à un client sont également vérifiés lorsqu'il
  consulte la boutique, au plus tard après **6 heures**.
- Une mise à jour automatique quotidienne peut être ajoutée par sécurité, mais
  elle n'est pas nécessaire pour que le catalogue client fonctionne.
- Le bouton **« Actualiser depuis Easybeer »** permet de demander immédiatement
  une mise à jour complète si vous venez de faire un changement important.

### Quand cliquer sur « Actualiser depuis Easybeer » ?

Utilisez-le seulement dans ces cas :

- vous avez changé un **prix**, une **grille tarifaire**, une **remise**, une
  fiche client ou un produit dans Easybeer et le changement doit être visible
  immédiatement ;
- vous préparez une ouverture de commande et le tableau de bord signale une
  synchronisation trop ancienne.

Évitez de cliquer plusieurs fois : Easybeer limite le nombre de demandes. La
plateforme empêche les mises à jour en double et affiche un compte à rebours si
Easybeer est momentanément saturé.

### Ce qui se met à jour autrement

- **Ouverture de la boutique** : lance automatiquement une mise à jour seulement
  si les informations sont devenues trop anciennes.
- **Mise à jour automatique de sécurité (optionnelle)** : actualise toutes les
  informations, même si personne n'a ouvert la boutique.
- **Bouton du tableau de bord** : met immédiatement à jour toutes les
  informations.
- **Boutons d'actualisation des pages** : Clients et Commandes relancent une
  mise à jour ciblée de leur liste ; Catalogue relance uniquement produits,
  types et grille tarifaire. Les prix personnalisés par client nécessitent la
  mise à jour complète du tableau de bord.
- **Validation d'une commande client** : quand un client confirme sa commande, elle est immédiatement créée dans Easybeer. Easybeer calcule ensuite le total final de référence.
- **Premier accès d'un client** : si ses tarifs ne sont pas encore prêts, la
  boutique les récupère automatiquement et lui affiche un message d'attente.
- **Boutons « Ouvrir dans Easybeer »** : ils n'actualisent rien, ils ouvrent
  seulement la page correspondante dans Easybeer.

Les pages Clients, Commandes et Catalogue affichent leur date de dernière mise à
jour. Leurs boutons servent à actualiser uniquement la page concernée.

**Sécurité sur les prix** : la plateforme utilise d'abord le tarif négocié du
client, puis le tarif de sa catégorie si nécessaire. Si elle ne peut confirmer
aucun tarif suffisamment récent, elle tente automatiquement une mise à jour et
empêche temporairement la commande de cet article. Easybeer calcule ensuite les
remises et les taxes : le total du panier avant validation reste donc indicatif.

## 4. Le catalogue

La page **Catalogue** liste **toutes les unités tarifées** d'Easybeer — chaque
conditionnement (Unité, Carton de 6, 12, 18, Fût…) apparaît **individuellement**,
avec son ou ses tarifs par type de client.

Pour chaque unité vous pouvez :

- **Visible** : afficher ou non l'unité côté client. **Masqué par défaut** — un
  produit n'apparaît au client que si vous l'avez rendu visible.
- **Rupture** : afficher « en rupture » (le client voit le produit mais ne peut
  pas le commander).
- **Nom d'affichage** : un libellé plus commercial que celui d'Easybeer. Le
  contenant et le conditionnement restent toujours affichés dans le catalogue,
  le panier et le récapitulatif de la commande. Sans nom personnalisé, seul le
  nom du produit apparaît en titre : son format est indiqué juste en dessous.
- **Photo** : glissez une image sur la vignette.

La **visibilité s'applique à l'unité** (un conditionnement) : tous ses tarifs
suivent. Le client ne voit que **le prix de son type** (voir §5).

> **La rupture est gérée ICI, pas par le stock Easybeer.** Un produit en stock
> chez Easybeer peut être masqué/en rupture dans l'app, et inversement : c'est
> **vous** qui pilotez la disponibilité affichée au client via ces interrupteurs.

## 5. Comment le prix du client est déterminé

Les types de client Easybeer sont **hiérarchiques**. La plateforme cherche la
grille tarifaire la plus proche du type du client. Aujourd'hui, GOA utilise
principalement deux grilles : `client PRO` et `Distributeur`. Les autres types
héritent généralement de `client PRO` :

| Type du client                               | Grille appliquée |
| -------------------------------------------- | ---------------- |
| client PRO, GMS, CHR, Festival, Particulier… | **client PRO**   |
| Distributeur                                 | **Distributeur** |

Donc un client GMS ou CHR voit généralement le prix `client PRO` ; un
Distributeur voit le prix Distributeur. Si un client a un **tarif négocié
personnalisé** dans Easybeer, c'est ce prix-là qui prime quand il est frais.

> Le panier affiche le **sous-total avant remise**, le détail des **remises
> appliquées**, puis les totaux HT et TTC après remise. Quand le client confirme
> sa commande, Easybeer vérifie ces calculs. L'écran de confirmation et
> l'historique affichent ensuite les montants enregistrés dans Easybeer. Le
> **minimum de commande** reste calculé sur le sous-total avant remise.

## 6. Remises

Les remises doivent être renseignées dans Easybeer, mais toutes les zones Easybeer
ne se comportent pas de la même manière dans une commande.

Les 4 cas utiles :

| Où dans Easybeer                                                  | Ce que ça fait                   | Portée                 |
| ----------------------------------------------------------------- | -------------------------------- | ---------------------- |
| **Fiche client → onglet Remises → produit sélectionné**           | Remise produit / conditionnement | **Client individuel**  |
| **Fiche client → onglet Commandes**                               | Remise globale sur la commande   | **Client individuel**  |
| **Fiche “type de client” → onglet Remises → produit sélectionné** | Remise produit / conditionnement | **Segment de clients** |
| **Fiche “type de client” → onglet Commandes**                     | Remise globale sur la commande   | **Segment de clients** |

Ces réglages sont automatiquement pris en compte dans le panier et dans la
commande envoyée à Easybeer.

### Quelle remise est appliquée ?

Pour chaque produit commandé, la plateforme choisit la remise dans cet ordre :

1. S'il existe une **remise propre à ce produit**, c'est elle qui est utilisée.
2. Si cette remise est renseignée à la fois sur la fiche du client et sur son
   type de client, le réglage de la **fiche du client** est utilisé.
3. Si aucune remise n'est prévue pour ce produit, la **remise générale du client**
   est utilisée. Si le client n'en a pas, la remise générale de son type de client
   est utilisée.

### Exemple complet

Le client **TEST \* Isaure Lohest \* TEST** appartient au type de client
**type test**. Quatre remises sont actives en même temps :

- sur le type de client : une remise générale de **11 %** dans l'onglet
  **Commandes** ;
- sur le type de client : **20 %** sur le Cola-Chaï 0,35 L en carton de 18, à
  partir de 10 cartons, dans l'onglet **Remises** ;
- sur la fiche du client : une remise générale de **10 %** dans l'onglet
  **Commandes** ;
- sur la fiche du client : **12 %** sur le même Cola-Chaï 0,35 L en carton de
  18, à partir de 3 cartons, dans l'onglet **Remises**.

Dans le panier de l'exemple :

- les 3 bouteilles de Cola-Chaï 1 L bénéficient de **10 %**. Aucune remise n'est
  prévue spécialement pour ce format : c'est donc la remise générale de la
  fiche du client qui s'applique, à la place des 11 % du type de client ;
- les 10 cartons de Cola-Chaï 0,35 L bénéficient de **12 %**. Les deux remises
  prévues pour ce produit peuvent s'appliquer, mais celle de la fiche du client
  est prioritaire sur les 20 % du type de client.

Les remises ne s'additionnent pas : chaque produit reçoit une seule remise.

<div class="exemple-remises-images">
  <figure>
    <img src="/aide/remises-exemple-reglages.png" alt="Résumé des quatre remises actives dans Easybeer">
    <figcaption>Les quatre remises actives dans Easybeer (vue d'une fiche client coté l'admin)</figcaption>
  </figure>
  <figure>
    <img src="/aide/remises-exemple-panier.png" alt="Détail des remises affichées dans le panier">
    <figcaption>Les remises retenues dans le panier (vue coté client)</figcaption>
  </figure>
</div>

À éviter :

- **Remise 2** : ne rien renseigner dans ce champ. Easybeer peut l'afficher, mais
  il ne l'applique pas correctement dans le total de commande. Pour éviter des
  écarts entre le panier, la commande et la facture, la plateforme ne l'utilise
  pas et ne la transmet pas.

En résumé : dans l'onglet **Commandes**, utilisez **Remise spéciale** pour appliquer
une remise à toute la commande. Dans l'onglet **Remises**, ajoutez une remise liée
à un produit ou à un conditionnement précis. Faites ce réglage sur la **fiche
client** pour un seul client, ou sur la fiche **type de client** pour tous les
clients de ce type.

## 7. Clients et invitations

- La liste **Clients** est mise à jour depuis Easybeer. La date de dernière mise
  à jour est affichée sur la page. Cliquez sur un client pour voir sa fiche
  (conditions commerciales, historique, comptes plateforme).
- **Inviter un client** : depuis la liste (bouton « Inviter » / « Inviter la
  sélection ») ou depuis sa fiche. Un **email** « créez votre mot de passe » lui
  est envoyé automatiquement ; un **lien** est copiable si besoin.
- Les liens d'invitation sont **valables 14 jours**, **à usage unique**. Si un
  client a déjà un compte actif, on ne régénère pas de lien — il utilise « Mot de
  passe oublié ». Tant que le compte n'est pas actif, vous pouvez **renvoyer** une
  invitation ; le lien précédent est alors révoqué.
- **Paramètres en masse** : sélectionnez plusieurs clients, puis appliquez-leur
  en une seule action une **tournée**, un **mode de livraison** ou un **minimum de
  commande**. Les modifications sont enregistrées directement dans Easybeer.
  Pour un minimum de commande, une grande sélection peut prendre plusieurs
  minutes ; la progression est affichée à l'écran.

## 8. Transport et livraison

Deux modes de livraison :

- **Palette / frigo (par défaut)** : le mode normal, aucune contrainte de
  colisage. La plateforme ne facture pas de frais de livraison.
- **La Poste J+1** (petits clients type CHR) : colisage contraint → la commande
  doit être un **multiple de 3 cartons de 35 cl** ou **2 cartons de 1 L**. La
  plateforme impose automatiquement ce multiple au panier.

La contrainte de colisage se gère avec un **tag `laposte`** sur la fiche client
Easybeer : un client tagué `laposte` subit la règle des multiples ; **sans ce
tag, il est en mode palette** (par défaut). Le champ “mode de livraison” Easybeer
peut être renseigné depuis l'admin, mais la règle de multiples de cartons côté
boutique dépend bien du tag `laposte`. Rien à choisir par commande.

## 9. Commandes

- La page **Commandes** affiche les commandes récentes des 30 derniers jours.
  Cliquez une commande pour voir son détail (lignes, totaux, documents).
- Les boutons **« Ouvrir dans Easybeer »** renvoient directement vers la fiche
  correspondante dans Easybeer (commande, client, grille tarifaire).
- Une commande passée sur la plateforme est **poussée dans Easybeer** ; c'est là
  que vous la validez, préparez, facturez.
- **Statut de la commande** : l'historique client affiche automatiquement le
  statut indiqué dans Easybeer dès qu'il est disponible.
- **Modification client** : une commande reste modifiable tant qu'elle n'est pas
  `LIVREE` ou `ANNULEE`. Un client peut donc encore modifier une commande **déjà
  en préparation**. Avant de préparer ou d'expédier une commande, vérifiez que
  vous consultez bien sa dernière version dans Easybeer.

## 10. Questions fréquentes

**J'ai changé un prix dans Easybeer, le client voit encore l'ancien.**
→ La mise à jour automatique peut prendre jusqu'à 30 minutes. Si le changement
doit être visible immédiatement, cliquez **« Actualiser depuis Easybeer »** sur
le tableau de bord.

**Je rends un produit visible : son prix apparaît-il tout de suite ?**
→ Oui. Le prix vient de la **grille tarifaire** (déjà synchronisée), pas besoin de
resynchroniser. Un éventuel **tarif négocié** propre à un client s'appliquera, lui,
à la synchro suivante.

**Où renseigner une remise client ?**
→ Dans Easybeer, ouvrez la fiche du client ou la fiche de son type de client :

- dans l'onglet **Commandes**, renseignez **Remise spéciale** pour appliquer une
  remise à l'ensemble de la commande ;
- dans l'onglet **Remises**, ajoutez une remise pour un produit, un contenant ou
  un lot précis.

Utilisez la **fiche client** si la remise concerne une seule entreprise, ou la
fiche **type de client** si elle concerne tous les clients de ce type. Ne
remplissez pas **Remise 2** : Easybeer peut l'afficher mais ne l'applique pas
correctement au total de commande.

**Faut-il cliquer tous les jours sur « Actualiser depuis Easybeer » ?**
→ Non. La boutique vérifie et met à jour ses informations automatiquement. Le
bouton manuel sert seulement en cas de changement urgent ou si le tableau de
bord signale des informations trop anciennes.

**Qu'est-ce qui déclenche une mise à jour sans clic admin ?**
→ L'ouverture de la boutique déclenche une vérification automatique. Si les
informations sont trop anciennes, la plateforme demande une mise à jour à
Easybeer. Une commande passée par un client est envoyée directement dans
Easybeer au moment de la validation.
Les boutons **« Ouvrir dans Easybeer »** ne synchronisent rien : ils ouvrent
seulement Easybeer dans un nouvel onglet.

**Un bandeau « API Easybeer saturée » apparaît.**
→ Easybeer limite le nombre de demandes. La plateforme attend automatiquement ;
réessayez après le compte à rebours. Les dernières informations connues restent
affichées.

**Un client ne reçoit pas son email d'invitation.**
→ Vérifiez ses spams, et que son email est correct dans Easybeer. Sinon, copiez
le **lien** et envoyez-le lui manuellement.

## 11. Support

Pour toute question, contactez le support :

- **Email** : [hello@isaure-lohest.com](mailto:hello@isaure-lohest.com)
- **WhatsApp** : [+34 600 049 801](https://wa.me/34600049801)

Pour aider à résoudre plus vite, ajoutez si possible :

- la **page concernée** (Clients, Commandes, Catalogue, fiche client…) ;
- le **client**, la **commande** ou le **produit** concerné ;
- le **message affiché** ou une capture d'écran ;
- l'heure approximative du problème.
