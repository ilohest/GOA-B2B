import { ref, watch, type Ref } from 'vue'

type DirectionTri = 'asc' | 'desc'

export function useTriPersistant<Cle extends string>(
  cleStockage: string,
  defaut: { cle: Cle; direction: DirectionTri },
  clesValides: readonly Cle[],
): Ref<{ cle: Cle; direction: DirectionTri }> {
  const tri = ref(defaut) as Ref<{ cle: Cle; direction: DirectionTri }>

  if (typeof window !== 'undefined') {
    try {
      const brut = window.localStorage.getItem(cleStockage)
      const parse = brut ? (JSON.parse(brut) as Partial<{ cle: Cle; direction: DirectionTri }>) : null
      if (
        parse?.cle &&
        clesValides.includes(parse.cle) &&
        (parse.direction === 'asc' || parse.direction === 'desc')
      ) {
        tri.value = { cle: parse.cle, direction: parse.direction }
      }
    } catch {
      // Tri invalide ou stockage indisponible : on garde le défaut.
    }
  }

  watch(
    tri,
    (prochainTri) => {
      if (typeof window === 'undefined') return
      window.localStorage.setItem(cleStockage, JSON.stringify(prochainTri))
    },
    { deep: true },
  )

  return tri
}
