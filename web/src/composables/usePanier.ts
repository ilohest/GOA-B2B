import { computed, ref } from 'vue'

/**
 * Panier (quantités par idStockBouteille). État module partagé — sera réutilisé
 * par la modification de commande (étape 6, pré-remplissage).
 */
const quantites = ref<Record<number, number>>({})

/** Renseigné quand le panier édite une commande Easybeer existante (upsert). */
const modification = ref<{ idCommande: number; numero: number | null; commentaire: string } | null>(null)

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
