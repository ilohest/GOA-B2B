<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import {
  listeClients,
  listeProduitsAutocomplete,
  listeTypesClient,
  enregistrerCommande,
  supprimerCommande,
  type ModeleClient,
  type ModeleClientType,
  type ProduitAutocomplete,
  type CommandePayload,
  type ResultatEnregistrement,
} from '../services/easybeerService'

// --- Données de référence (lecture seule, chargées au montage) ---
const clients = ref<ModeleClient[]>([])
const produits = ref<ProduitAutocomplete[]>([])
const typesClient = ref<ModeleClientType[]>([])
const chargementRef = ref(true)
const erreurRef = ref<string | null>(null)

// --- Sélection du formulaire ---
const idClient = ref<number | null>(null)
const idStockBouteille = ref<number | null>(null)
const idGrilleTarifaire = ref<number | null>(null)
const quantite = ref(1)
const prixUnitaireHT = ref(18.9)
const estDevis = ref(true) // par défaut : DEVIS (réversible facilement)
const commentaire = ref('Commande de test POC — à supprimer')

// --- État de l'envoi ---
const envoiEnCours = ref(false)
const resultat = ref<ResultatEnregistrement | null>(null)
const erreurEnvoi = ref<string | null>(null)

// --- État de la suppression ---
const suppressionEnCours = ref(false)
const messageSuppression = ref<string | null>(null)

const produitSelectionne = computed(() =>
  produits.value.find((p) => p.idStockBouteille === idStockBouteille.value),
)
const clientSelectionne = computed(() =>
  clients.value.find((c) => c.idClient === idClient.value),
)

/** Grilles tarifaires = types RACINES (sans parent). */
const grillesTarifaires = computed(() =>
  typesClient.value.filter((t) => !t.idParent),
)

/** Remonte le type d'un client jusqu'à sa racine = sa grille tarifaire. */
function resoudreGrille(idType?: number | null): number | null {
  if (idType == null) return null
  const parId = new Map(typesClient.value.map((t) => [t.idClientType, t]))
  let courant = parId.get(idType)
  const vus = new Set<number>()
  while (courant?.idParent && !vus.has(courant.idClientType!)) {
    vus.add(courant.idClientType!)
    courant = parId.get(courant.idParent)
  }
  return courant?.idClientType ?? idType
}

/** Met à jour la grille par défaut selon le client choisi (racine de son type). */
function majGrilleParDefaut() {
  const racine = resoudreGrille(clientSelectionne.value?.type?.idClientType)
  if (racine != null) idGrilleTarifaire.value = racine
}

const idCommandeCreee = computed(() => resultat.value?.id ?? null)

const peutEnvoyer = computed(
  () =>
    idClient.value != null &&
    idStockBouteille.value != null &&
    idGrilleTarifaire.value != null &&
    quantite.value > 0 &&
    prixUnitaireHT.value >= 0 &&
    !envoiEnCours.value,
)

async function chargerReferences() {
  chargementRef.value = true
  erreurRef.value = null
  try {
    const [resClients, resProduits, resTypes] = await Promise.all([
      listeClients({}, { colonneTri: 'nom', numeroPage: 1, nombreParPage: 50 }),
      listeProduitsAutocomplete(true),
      listeTypesClient(),
    ])
    clients.value = resClients.liste ?? []
    produits.value = resProduits ?? []
    typesClient.value = resTypes ?? []
    // Pré-sélection pratique pour le test.
    idClient.value = clients.value[0]?.idClient ?? null
    idStockBouteille.value = produits.value[0]?.idStockBouteille ?? null
    majGrilleParDefaut()
  } catch (e) {
    erreurRef.value = e instanceof Error ? e.message : String(e)
  } finally {
    chargementRef.value = false
  }
}

async function envoyerCommande() {
  if (
    !peutEnvoyer.value ||
    idClient.value == null ||
    idStockBouteille.value == null ||
    idGrilleTarifaire.value == null
  )
    return
  envoiEnCours.value = true
  resultat.value = null
  erreurEnvoi.value = null
  messageSuppression.value = null

  const produit = produitSelectionne.value
  if (!produit) {
    erreurEnvoi.value = 'Produit introuvable.'
    envoiEnCours.value = false
    return
  }
  const payload: CommandePayload = {
    client: { idClient: idClient.value },
    grilleTarifaire: { idClientType: idGrilleTarifaire.value },
    // TVA des frais de livraison : on réutilise celle du produit (5,5 % kombucha).
    tauxTVAFraisLivraison: produit.tauxTVA ?? {},
    estDevis: estDevis.value,
    commentaire: commentaire.value || 'Commande POC',
    elementsBouteilles: [
      {
        stockBouteille: { idStockBouteille: idStockBouteille.value },
        // Objet produit COMPLET de l'autocomplete (cf. structure d'une vraie ligne).
        stockProduit: produit,
        quantite: quantite.value,
        prixUnitaireHTHorsRemise: prixUnitaireHT.value,
        prixLotHT: prixUnitaireHT.value,
        designation: produit.libelle,
        tauxTVA: produit.tauxTVA,
        tarifHorsDroits: false,
      },
    ],
  }

  try {
    resultat.value = await enregistrerCommande(payload)
  } catch (e) {
    erreurEnvoi.value = e instanceof Error ? e.message : String(e)
  } finally {
    envoiEnCours.value = false
  }
}

async function supprimerTest() {
  if (idCommandeCreee.value == null) return
  suppressionEnCours.value = true
  messageSuppression.value = null
  try {
    await supprimerCommande(idCommandeCreee.value)
    messageSuppression.value = `Commande ${idCommandeCreee.value} supprimée d'Easybeer.`
    resultat.value = null
  } catch (e) {
    messageSuppression.value = e instanceof Error ? e.message : String(e)
  } finally {
    suppressionEnCours.value = false
  }
}

onMounted(chargerReferences)
</script>

<template>
  <section class="commande-test">
    <header>
      <h2>Commande de test (Phase 3)</h2>
    </header>

    <p class="warn">
      ⚠️ Le bouton ci-dessous écrit une <strong>vraie {{ estDevis ? 'commande (devis)' : 'commande ferme' }}</strong>
      dans Easybeer. Le mode <em>Devis</em> est conseillé pour un test : il se supprime proprement.
    </p>

    <p v-if="chargementRef" class="state">Chargement clients &amp; produits…</p>
    <p v-else-if="erreurRef" class="state error">❌ {{ erreurRef }}</p>

    <template v-else>
      <div class="form">
        <label>
          Client
          <select v-model.number="idClient" @change="majGrilleParDefaut">
            <option v-for="c in clients" :key="c.idClient" :value="c.idClient">
              {{ c.nom }} — {{ c.numero }}
            </option>
          </select>
        </label>

        <label>
          Grille tarifaire
          <select v-model.number="idGrilleTarifaire">
            <option v-for="g in grillesTarifaires" :key="g.idClientType" :value="g.idClientType">
              {{ g.libelle }} (idClientType {{ g.idClientType }})
            </option>
          </select>
        </label>

        <label>
          Produit (carton pro)
          <select v-model.number="idStockBouteille">
            <option v-for="p in produits" :key="p.idStockBouteille" :value="p.idStockBouteille">
              {{ p.libelle }} (dispo {{ p.quantiteDisponible }})
            </option>
          </select>
        </label>

        <label class="small">
          Quantité
          <input v-model.number="quantite" type="number" min="1" />
        </label>

        <label class="small">
          Prix unit. HT (€)
          <input v-model.number="prixUnitaireHT" type="number" min="0" step="0.01" />
        </label>

        <label class="check">
          <input v-model="estDevis" type="checkbox" />
          Créer en devis (réversible)
        </label>

        <label class="full">
          Commentaire
          <input v-model="commentaire" type="text" />
        </label>
      </div>

      <p class="hint">
        Catégorie CRM du client :
        <strong v-if="clientSelectionne?.type">{{ clientSelectionne.type.libelle }}</strong>
        <span v-else>—</span>
        · grille tarifaire envoyée : <strong>idClientType {{ idGrilleTarifaire }}</strong>
        (racine résolue automatiquement, modifiable ci-dessus)
      </p>

      <button class="send" :disabled="!peutEnvoyer" @click="envoyerCommande">
        {{ envoiEnCours ? 'Envoi en cours…' : '🚀 Passer la commande fictive' }}
      </button>

      <!-- Résultat -->
      <div v-if="erreurEnvoi" class="state error result">❌ {{ erreurEnvoi }}</div>

      <div v-if="resultat" class="state ok result">
        ✅ {{ estDevis ? 'Devis' : 'Commande' }} enregistré(e) dans Easybeer.
        <ul>
          <li v-if="resultat.id != null">idCommande : <strong>{{ resultat.id }}</strong></li>
          <li v-if="resultat.numero != null">Numéro : <strong>{{ resultat.numero }}</strong></li>
        </ul>

        <button
          v-if="idCommandeCreee != null"
          class="delete"
          :disabled="suppressionEnCours"
          @click="supprimerTest"
        >
          {{ suppressionEnCours ? 'Suppression…' : `🗑 Supprimer la commande ${idCommandeCreee}` }}
        </button>
      </div>

      <p v-if="messageSuppression" class="state">{{ messageSuppression }}</p>

      <!-- Réponse brute, utile au debug du POC -->
      <details v-if="resultat" class="raw">
        <summary>Réponse brute (ModeleResultat)</summary>
        <pre>{{ JSON.stringify(resultat, null, 2) }}</pre>
      </details>
    </template>
  </section>
</template>

<style scoped>
.commande-test {
  font-family: system-ui, sans-serif;
  max-width: 1000px;
  margin: 2rem auto;
  color: #1c1917;
}
header h2 {
  margin: 0 0 0.5rem;
}
.warn {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  padding: 0.6rem 0.9rem;
  border-radius: 8px;
  font-size: 0.85rem;
}
.form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1rem;
  margin: 1rem 0;
}
.form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: #57534e;
}
.form label.small {
  max-width: 12rem;
}
.form label.full {
  grid-column: 1 / -1;
}
.form label.check {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  align-self: end;
}
.form input,
.form select {
  border: 1px solid #d6d3d1;
  border-radius: 6px;
  padding: 0.4rem 0.5rem;
  font-size: 0.85rem;
  font-weight: 400;
}
.form label.check input {
  width: auto;
}
button.send {
  background: #b45309;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 0.6rem 1.1rem;
  font-weight: 600;
  cursor: pointer;
}
button.send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.delete {
  margin-top: 0.6rem;
  background: #fff;
  color: #b91c1c;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
}
.hint {
  font-size: 0.8rem;
  color: #57534e;
  margin: 0 0 0.6rem;
}
.hint .missing {
  color: #b91c1c;
}
.state {
  font-size: 0.85rem;
  color: #57534e;
}
.result {
  margin-top: 0.8rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
}
.error {
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
}
.ok {
  color: #065f46;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
}
.ok ul {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
}
.raw {
  margin-top: 0.8rem;
  font-size: 0.8rem;
}
.raw pre {
  background: #1c1917;
  color: #e7e5e4;
  padding: 0.75rem;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.72rem;
}
</style>
