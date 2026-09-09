# Restauration des données — plateforme GOA

Marche à suivre pour récupérer des données perdues en production. Écrit pour être
utilisable par quelqu'un qui reprend le projet sans l'avoir construit.

Projet de production : **`goa-b2b-production`** · région **`europe-west1`**.

> Toutes les commandes ci-dessous ciblent la production. Vérifier le projet avant
> chaque commande : `gcloud config get project` et `firebase use`.

---

## 1. Où vivent les sauvegardes

| Donnée | Emplacement | Fréquence | Conservation |
| --- | --- | --- | --- |
| Firestore — retour à un instant précis (PITR) | Interne à la base `(default)`, rien à stocker | Continu | **7 jours** |
| Firestore — sauvegardes planifiées | Service de sauvegarde Firestore, `europe-west1`. Pas dans un bucket : `gcloud firestore backups list` | Quotidienne | 4 semaines |
| Firestore — sauvegarde hebdomadaire | Idem | Dimanche | 12 semaines |
| Photos produits | Dans le bucket lui-même, en « soft delete » invisible : `gs://goa-b2b-production.firebasestorage.app` | À la suppression | 30 jours |
| Comptes de connexion (Auth) | `gs://goa-b2b-production-sauvegardes-auth/auth/*.json.age`, **chiffrés** | Dimanche 3 h | 1 an |

La **clé privée `age`** qui déchiffre les sauvegardes de comptes n'est ni dans le
cloud ni dans ce dépôt : elle est détenue hors ligne par la personne qui a créé
la paire de clés. Sans elle, ces sauvegardes sont définitivement illisibles.

État des protections :

```bash
gcloud firestore databases describe --database='(default)' --project goa-b2b-production \
  --format='value(locationId,pointInTimeRecoveryEnablement,deleteProtectionState,earliestVersionTime)'
gcloud firestore backups list --location=europe-west1 --project goa-b2b-production
gcloud storage ls gs://goa-b2b-production-sauvegardes-auth/auth/
```

---

## 2. Règles d'or

1. **Arrêter d'écrire** dans la partie concernée avant toute chose. Chaque minute
   d'activité supplémentaire complique la réconciliation.
2. **Noter l'heure** à laquelle la perte a eu lieu, ou à défaut l'heure du dernier
   état correct connu. C'est l'information la plus déterminante.
3. **Ne jamais restaurer directement par-dessus la production** sans avoir
   d'abord regardé ce que contient la sauvegarde.
4. **Ne pas ressaisir à la main** les données perdues avant la restauration :
   elles seraient écrasées.
5. Le **délai compte** : au-delà de 7 jours, le retour à la minute près n'est plus
   possible, on retombe sur la sauvegarde de la nuit ou du dimanche.

---

## 3. Choisir la méthode

| Situation | Aller à |
| --- | --- |
| Documents Firestore supprimés ou corrompus, **il y a moins de 7 jours** | §4 |
| Idem, **plus de 7 jours** | §5 |
| Photo produit supprimée, moins de 30 jours | §6 |
| Comptes de connexion supprimés | §7 |
| Produit, tarif, remise ou fiche client erronés | §9 — ce n'est pas ici |

---

## 4. Firestore, moins de 7 jours — retour à un instant précis

C'est la méthode à privilégier : elle permet de cibler la minute précédant
l'incident, et de ne réimporter que les collections touchées.

**a. Exporter l'état passé** vers un bucket (l'export ne touche pas la production) :

```bash
gcloud firestore export gs://goa-b2b-production-sauvegardes-auth/exports/pitr-$(date +%Y%m%d-%H%M) \
  --snapshot-time='2026-09-09T14:30:00.00Z' \
  --collection-ids=users,orders,catalogueOverrides,invitations \
  --project goa-b2b-production
```

L'horodatage est en **UTC** et doit tomber dans la fenêtre de 7 jours
(`earliestVersionTime` ci-dessus donne la borne la plus ancienne).

**b. Vérifier l'export** — l'opération est asynchrone :

```bash
gcloud firestore operations list --project goa-b2b-production --limit 3
```

**c. Réimporter** uniquement ce qui doit l'être :

```bash
gcloud firestore import gs://goa-b2b-production-sauvegardes-auth/exports/pitr-XXXX \
  --collection-ids=orders \
  --project goa-b2b-production
```

> L'import **écrase** les documents portant le même identifiant et **laisse
> intacts** les autres. Il ne supprime rien : un document créé après l'incident
> survivra à l'import. C'est voulu, mais cela veut dire qu'un import ne « remet
> pas la base comme avant » — il restaure les documents nommés.

---

## 5. Firestore, plus de 7 jours — sauvegarde planifiée

**Une restauration gérée crée une base NEUVE ; elle n'écrase pas `(default)`.**
L'application, elle, lit uniquement `(default)`. Le retour vers la production
demande donc une étape de plus.

**a. Choisir la sauvegarde :**

```bash
gcloud firestore backups list --location=europe-west1 --project goa-b2b-production \
  --format='table(name,snapshotTime,expireTime,stats.sizeBytes)'
```

**b. Restaurer dans une base de travail** (nom libre, jamais `(default)`) :

```bash
gcloud firestore databases restore \
  --source-backup=projects/goa-b2b-production/locations/europe-west1/backups/BACKUP_ID \
  --destination-database=restauration-20260909 \
  --project goa-b2b-production
```

**c. Inspecter** cette base dans la console Firestore (sélecteur de base en haut)
et vérifier que les données attendues s'y trouvent.

**d. Rapatrier** vers `(default)` en passant par un export/import ciblé :

```bash
gcloud firestore export gs://goa-b2b-production-sauvegardes-auth/exports/restau-20260909 \
  --database=restauration-20260909 --collection-ids=users,orders \
  --project goa-b2b-production

gcloud firestore import gs://goa-b2b-production-sauvegardes-auth/exports/restau-20260909 \
  --collection-ids=users,orders --project goa-b2b-production
```

**e. Supprimer la base de travail** une fois la vérification faite, pour ne pas
la payer indéfiniment :

```bash
gcloud firestore databases delete --database=restauration-20260909 --project goa-b2b-production
```

Les collections `cache*` n'ont pas à être restaurées : elles se reconstruisent
seules depuis Easybeer à la synchronisation suivante.

---

## 6. Photo produit supprimée

```bash
# Lister ce qui est récupérable
gcloud storage ls --soft-deleted --long gs://goa-b2b-production.firebasestorage.app/produits/

# Restaurer un objet précis, avec le numéro de génération relevé ci-dessus
gcloud storage restore gs://goa-b2b-production.firebasestorage.app/produits/FICHIER.webp#GENERATION
```

Au-delà de 30 jours, l'objet est définitivement perdu ; il faut réimporter la
photo depuis la source d'origine.

---

## 7. Comptes de connexion supprimés

À faire **d'abord dans un projet Firebase de test**, jamais directement en
production.

```bash
# a. Récupérer la sauvegarde chiffrée
gcloud storage ls gs://goa-b2b-production-sauvegardes-auth/auth/
gcloud storage cp gs://goa-b2b-production-sauvegardes-auth/auth/FICHIER.json.age .

# b. Déchiffrer avec la clé privée hors ligne
age -d -i cle-privee-goa.txt -o sauvegarde.json FICHIER.json.age

# c. Séparer les comptes des paramètres de hachage
node -e 'const d=require("./sauvegarde.json");require("fs").writeFileSync("users.json",JSON.stringify({users:d.users}));console.log(d.hashConfig)'
```

La commande affiche `signerKey`, `saltSeparator`, `rounds` et `memoryCost`. Les
reporter tels quels — **sans eux, les mots de passe ne sont pas restaurables** et
tous les clients devraient réinitialiser le leur :

```bash
firebase auth:import users.json \
  --hash-algo=SCRYPT \
  --hash-key="SIGNER_KEY" \
  --salt-separator="SALT_SEPARATOR" \
  --rounds=8 --mem-cost=14 \
  --project projet-de-test
```

Supprimer ensuite `sauvegarde.json` et `users.json` : ils contiennent des données
personnelles et des empreintes de mots de passe.

**Attention** : restaurer un compte Auth ne suffit pas à le rendre fonctionnel.
Son profil vit dans Firestore (`users/{uid}`, avec `role` et `status`) — si la
perte concerne aussi Firestore, restaurer les deux, et vérifier que les `uid`
correspondent.

---

## 8. Après une restauration

- Vérifier `users`, `orders`, `catalogueOverrides` et `invitations`.
- Ouvrir une commande et contrôler que ses lignes et totaux sont cohérents.
- Se connecter avec un compte client et vérifier l'accès à la boutique.
- Lancer une synchronisation depuis le tableau de bord pour reconstruire les caches.
- Consigner par écrit : ce qui a été perdu, la méthode employée, la durée totale.

---

## 9. Ce qui n'est pas couvert ici

**Easybeer n'est pas sauvegardé par la plateforme.** Les produits, clients,
tarifs, remises et commandes vivent dans Easybeer, qui en est responsable. Une
suppression de ce côté se traite avec Easybeer (`easybeer.fr@gmail.com`), pas
ici. La plateforme n'en conserve qu'un cache, reconstruit à chaque
synchronisation — il ne constitue pas une sauvegarde exploitable.

**Les secrets** (identifiants Easybeer et SMTP) vivent dans Secret Manager et
sont versionnés par lui :

```bash
gcloud secrets versions list easybeer-password --project goa-b2b-production
```

---

## 10. Répéter l'exercice

Une procédure de restauration jamais testée ne vaut rien. Refaire ce test tous
les trois à six mois, dans un projet Firebase distinct : restaurer une
sauvegarde, vérifier les collections, mesurer le temps total, et corriger ce
document là où il s'est révélé faux ou incomplet.

Voir aussi [`TODO-SAUVEGARDES-PRODUCTION.md`](./TODO-SAUVEGARDES-PRODUCTION.md)
pour la checklist de mise en place, et [`DEPLOIEMENT-CLOUD.md`](./DEPLOIEMENT-CLOUD.md) §8.
