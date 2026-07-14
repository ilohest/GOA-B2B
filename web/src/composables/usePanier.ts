import { computed, ref, watch } from 'vue'

const CLE_STOCKAGE = 'goa-panier-v1'
type ModificationPanier = { idCommande: number; numero: number | null; commentaire: string }
type PanierStocke = {
  quantites?: Record<string, number>
  modification?: ModificationPanier | null
}

function lirePanierStocke(): PanierStocke {
  if (typeof window === 'undefined') return {}
  try {
    const brut = window.localStorage.getItem(CLE_STOCKAGE)
    if (!brut) return {}
    const parse = JSON.parse(brut) as PanierStocke
    return parse && typeof parse === 'object' ? parse : {}
  } catch {
    return {}
  }
}

function normaliserQuantites(quantitesStockees: PanierStocke['quantites']) {
  const resultat: Record<number, number> = {}
  for (const [id, quantite] of Object.entries(quantitesStockees ?? {})) {
    const idStockBouteille = Number(id)
    const quantiteEntiere = Math.floor(Number(quantite))
    if (Number.isFinite(idStockBouteille) && idStockBouteille > 0 && quantiteEntiere > 0) {
      resultat[idStockBouteille] = quantiteEntiere
    }
  }
  return resultat
}

function sauvegarderPanier() {
  if (typeof window === 'undefined') return
  const payload: PanierStocke = {
    quantites: Object.fromEntries(Object.entries(quantites.value).map(([id, quantite]) => [id, quantite])),
    modification: modification.value,
  }
  if (!Object.keys(payload.quantites ?? {}).length && !payload.modification) {
    window.localStorage.removeItem(CLE_STOCKAGE)
    return
  }
  window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify(payload))
}

const panierInitial = lirePanierStocke()

/**
 * Panier (quantités par idStockBouteille). État module partagé — sera réutilisé
 * par la modification de commande (étape 6, pré-remplissage).
 */
const quantites = ref<Record<number, number>>(normaliserQuantites(panierInitial.quantites))

/** Renseigné quand le panier édite une commande Easybeer existante (upsert). */
const modification = ref<ModificationPanier | null>(panierInitial.modification ?? null)

watch([quantites, modification], sauvegarderPanier, { deep: true })

export function usePanier() {
  const changer = (idStockBouteille: number, delta: number) => {
    const actuel = quantites.value[idStockBouteille] ?? 0
    const suivant = Math.max(0, actuel + delta)
    if (suivant === 0) delete quantites.value[idStockBouteille]
    else quantites.value[idStockBouteille] = suivant
  }

  const fixer = (idStockBouteille: number, quantite: number) => {
    if (quantite <= 0) delete quantites.value[idStockBouteille]
    else quantites.value[idStockBouteille] = Math.floor(quantite)
  }

  const vider = () => {
    quantites.value = {}
    modification.value = null
  }

  /** Pré-remplit le panier depuis une commande existante (mode modification). */
  const chargerCommande = (commande: {
    idCommande: number
    numero: number | null
    commentaire: string
    lignes: { idStockBouteille: number | null; quantite: number }[]
  }) => {
    quantites.value = {}
    for (const l of commande.lignes) {
      if (l.idStockBouteille != null && l.quantite > 0) quantites.value[l.idStockBouteille] = l.quantite
    }
    modification.value = {
      idCommande: commande.idCommande,
      numero: commande.numero,
      commentaire: commande.commentaire,
    }
  }

  const nbCartons = computed(() =>
    Object.values(quantites.value).reduce((somme, q) => somme + q, 0),
  )

  const lignes = computed(() =>
    Object.entries(quantites.value).map(([id, quantite]) => ({
      idStockBouteille: Number(id),
      quantite,
    })),
  )

  return { quantites, changer, fixer, vider, chargerCommande, modification, nbCartons, lignes }
}
