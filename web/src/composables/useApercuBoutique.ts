import { ref, watch } from 'vue'

const CLE_STOCKAGE_TYPE = 'goa-apercu-type-tarifaire-v1'

function lireTypeStocke(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const brut = window.localStorage.getItem(CLE_STOCKAGE_TYPE)
    const valeur = brut == null ? Number.NaN : Number(brut)
    return Number.isFinite(valeur) ? valeur : null
  } catch {
    return null
  }
}

/**
 * Grille tarifaire regardée pendant l'aperçu admin de la boutique. L'état est
 * partagé (module-level) pour que le catalogue et la page de confirmation
 * montrent les mêmes prix, et persisté pour survivre à un rechargement.
 */
const typeTarifaireApercu = ref<number | null>(lireTypeStocke())

watch(typeTarifaireApercu, (valeur) => {
  if (typeof window === 'undefined') return
  try {
    if (valeur == null) window.localStorage.removeItem(CLE_STOCKAGE_TYPE)
    else window.localStorage.setItem(CLE_STOCKAGE_TYPE, String(valeur))
  } catch {
    // Stockage indisponible (navigation privée) : le choix vaut pour la session.
  }
})

export function useApercuBoutique() {
  return { typeTarifaireApercu }
}
