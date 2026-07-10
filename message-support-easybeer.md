# Message à envoyer à Easybeer (support / Dev-Team)

**À :** easybeer.fr@gmail.com
**Objet :** Limites de requêtes API (rate-limiting) — intégration La Brasserie de GOA

---

Bonjour,

Nous développons pour **La Brasserie de GOA** (brasserie n° 1951) une plateforme
de commande B2B qui s'appuie sur votre API (Basic Auth) : lecture du catalogue,
des clients et des commandes, et création de commandes.

Nous sommes régulièrement bloqués par une limitation de débit. Concrètement,
l'API renvoie :

- un **HTTP 400** avec le corps
  `Limit of 10 requests per second reached. You are currently banned. Try again in N seconds`,
- et parfois un **HTTP 429**.

Nous avons déjà mis en place côté serveur une file d'attente qui espace tous les
appels et un cache pour ne lire l'API qu'au strict nécessaire. Malgré cela, nous
observons deux comportements que la documentation Swagger (v2.3.0) ne mentionne
pas :

1. le délai annoncé (« Try again in N seconds ») semble **sous-estimer** la durée
   réelle du blocage ;
2. les bans paraissent **s'allonger** lorsqu'un appel arrive pendant un blocage
   déjà en cours.

Pour calibrer proprement notre intégration (et éviter de solliciter l'API
inutilement), pourriez-vous nous préciser :

1. **Les limites exactes** de l'API : combien de requêtes par seconde, mais aussi
   par minute / heure / jour le cas échéant ?
2. **Le fonctionnement des bans** : durée réelle, sont-ils progressifs, et est-ce
   qu'un appel émis pendant un ban le prolonge ?
3. **Un en-tête de réponse fiable** (`Retry-After`, `X-RateLimit-*`…) sur lequel
   nous pourrions nous appuyer, plutôt que de deviner ?
4. **Vos recommandations** pour un job de synchronisation périodique (fréquence
   et espacement conseillés) qui reste sous vos limites ?
5. S'il existe une **offre / un quota supérieur** adapté à un usage applicatif
   continu, si nos volumes le justifient.

Nos volumes cibles restent modestes (≈ 100–150 commandes/mois, ~230 clients,
une douzaine de références produits).

Merci d'avance pour votre aide,

Bien cordialement,
[Votre nom]
La Brasserie de GOA
