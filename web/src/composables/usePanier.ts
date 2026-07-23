import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useAuth } from '@/composables/useAuth'

const CLE_STOCKAGE_CLIENT_HISTORIQUE = 'goa-panier-v1'
const CLE_STOCKAGE_APERCU_ADMIN = 'goa-panier-apercu-admin-v1'
type ModificationPanier = {
  idCommande: number
  numero: number | null
  commentaire: string
  quantitesInitiales: Record<number, number>
}
type PanierStocke = {
  quantites?: Record<string, number>
  modification?: ModificationPanier | null
  commentaire?: string
}

function lirePanierStocke(cleStockage: string): PanierStocke {
  if (typeof window === 'undefined') return {}
  try {
    const brut = window.localStorage.getItem(cleStockage)
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

function sauvegarderPanier(
  cleStockage: string,
  quantites: Record<number, number>,
  modification: ModificationPanier | null,
  commentaire: string,
) {
  if (typeof window === 'undefined') return
  const payload: PanierStocke = {
    quantites: Object.fromEntries(Object.entries(quantites).map(([id, quantite]) => [id, quantite])),
    modification,
    commentaire,
  }
  if (!Object.keys(payload.quantites ?? {}).length && !payload.modification && !payload.commentaire) {
    window.localStorage.removeItem(cleStockage)
    return
  }
  window.localStorage.setItem(cleStockage, JSON.stringify(payload))
}

type EtatPanier = {
  quantites: Ref<Record<number, number>>
  modification: Ref<ModificationPanier | null>
  commentaire: Ref<string>
}

const etatsPaniers = new Map<string, EtatPanier>()
let ancienPanierGlobalNettoye = false

function nettoyerAncienPanierGlobal() {
  if (ancienPanierGlobalNettoye || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(CLE_STOCKAGE_CLIENT_HISTORIQUE)
  } catch {
    // Stockage indisponible : le panier courant reste utilisable en mémoire.
  }
  ancienPanierGlobalNettoye = true
}

function obtenirEtatPanier(cleStockage: string) {
  const existant = etatsPaniers.get(cleStockage)
  if (existant) return existant
  const panierInitial = lirePanierStocke(cleStockage)
  const etat: EtatPanier = {
    quantites: ref<Record<number, number>>(normaliserQuantites(panierInitial.quantites)),
    modification: ref<ModificationPanier | null>(panierInitial.modification ?? null),
    commentaire: ref(panierInitial.commentaire ?? panierInitial.modification?.commentaire ?? ''),
  }
  watch(
    [etat.quantites, etat.modification, etat.commentaire],
    () => sauvegarderPanier(
      cleStockage,
      etat.quantites.value,
      etat.modification.value,
      etat.commentaire.value,
    ),
    { deep: true },
  )
  etatsPaniers.set(cleStockage, etat)
  return etat
}

/** Panier client par défaut, ou panier isolé pour l'aperçu administrateur. */
export function usePanier(portee: 'client' | 'apercu-admin' = 'client') {
  let cleStockage = CLE_STOCKAGE_APERCU_ADMIN
  if (portee === 'client') {
    const { user } = useAuth()
    const uid = user.value?.uid
    if (!uid) {
      throw new Error('Le panier client ne peut pas être initialisé sans compte connecté.')
    }
    nettoyerAncienPanierGlobal()
    cleStockage = `goa-panier-client-${uid}-v1`
  }
  const { quantites, modification, commentaire } = obtenirEtatPanier(cleStockage)
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
    commentaire.value = ''
  }

  /** Pré-remplit le panier depuis une commande existante (mode modification). */
  const chargerCommande = (commande: {
    idCommande: number
    numero: number | null
    commentaire: string
    lignes: { idStockBouteille: number; quantite: number }[]
  }) => {
    quantites.value = {}
    for (const l of commande.lignes) {
      if (l.quantite > 0) quantites.value[l.idStockBouteille] = l.quantite
    }
    modification.value = {
      idCommande: commande.idCommande,
      numero: commande.numero,
      commentaire: commande.commentaire,
      quantitesInitiales: Object.fromEntries(
        commande.lignes.map((ligne) => [ligne.idStockBouteille, ligne.quantite]),
      ),
    }
    commentaire.value = commande.commentaire
  }

  /**
   * Reprend une commande passée dans une NOUVELLE commande (« recommander ») :
   * contrairement à `chargerCommande`, aucun mode modification n'est armé.
   * Les quantités reçues sont déjà alignées sur l'éventuel pas de commande
   * propre à l'article (cf. `reconcilierCommande`).
   */
  const appliquerCommande = (
    lignesCommande: { idStockBouteille: number; quantite: number }[],
    mode: 'remplacer' | 'ajouter' = 'remplacer',
  ) => {
    modification.value = null
    commentaire.value = ''
    if (mode === 'remplacer') quantites.value = {}
    for (const l of lignesCommande) {
      if (l.quantite <= 0) continue
      quantites.value[l.idStockBouteille] = (quantites.value[l.idStockBouteille] ?? 0) + l.quantite
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

  return {
    quantites,
    changer,
    fixer,
    vider,
    chargerCommande,
    appliquerCommande,
    modification,
    commentaire,
    nbCartons,
    lignes,
  }
}
