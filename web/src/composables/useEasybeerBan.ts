/**
 * État partagé du rate-limiting Easybeer côté front. Alimenté par les réponses
 * 503 du backend (via api.ts) et par une lecture initiale de statut. Permet de
 * désactiver les boutons d'actualisation avec un compte à rebours plutôt que de
 * laisser l'utilisateur retaper l'API et prolonger le ban.
 */
import { computed, ref } from 'vue'

const banniJusqua = ref(0)
const maintenant = ref(Date.now())

// Une seule horloge partagée tant qu'un ban est actif.
let horloge: ReturnType<typeof setInterval> | null = null
function assurerHorloge() {
  if (horloge) return
  horloge = setInterval(() => {
    maintenant.value = Date.now()
    if (maintenant.value >= banniJusqua.value && horloge) {
      clearInterval(horloge)
      horloge = null
    }
  }, 1000)
}

/** Signale un ban de `secondes` (appelé par api.ts sur 503, ou au chargement du statut). */
export function signalerBanEasybeer(secondes: number) {
  const echeance = Date.now() + Math.max(0, secondes) * 1000
  if (echeance > banniJusqua.value) {
    banniJusqua.value = echeance
    maintenant.value = Date.now()
    assurerHorloge()
  }
}

const secondesRestantes = computed(() =>
  Math.max(0, Math.ceil((banniJusqua.value - maintenant.value) / 1000)),
)
const banni = computed(() => secondesRestantes.value > 0)

export function useEasybeerBan() {
  return { banni, secondesRestantes }
}
