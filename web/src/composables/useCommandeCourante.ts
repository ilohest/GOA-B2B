import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { api } from '@/lib/api'
import type { CatalogueClientResponse, ProduitCatalogueClient } from '@/lib/types'
import { estimerRemisesCommande } from '@/lib/remises'
import { groupesConditionnementPostalInvalides } from '@/lib/livraisonPostale'
import { useMe } from '@/composables/useMe'
import { usePanier } from '@/composables/usePanier'

/** État et règles partagés entre la boutique et la page de confirmation. */
export function useCommandeCourante(modeApercu: MaybeRefOrGetter<boolean>) {
  const profil = useMe()
  const panier = usePanier(toValue(modeApercu) ? 'apercu-admin' : 'client')

  const catalogue = useQuery({
    queryKey: computed(() => [
      toValue(modeApercu) ? 'catalogue-apercu-admin' : 'catalogue',
      panier.modification.value?.idCommande ?? null,
    ]),
    queryFn: () =>
      api.get<CatalogueClientResponse>(
        toValue(modeApercu)
          ? '/admin/boutique-apercu'
          : panier.modification.value
            ? `/catalogue?commande=${panier.modification.value.idCommande}`
            : '/catalogue',
      ),
    enabled: computed(() => profil.data.value != null),
    refetchInterval: (query) =>
      query.state.data?.cacheEnPreparation
        ? 4000
        : query.state.data?.revalidationEnCours
          ? 30000
          : false,
  })

  const compteSansTarifs = computed(
    () => profil.data.value?.client != null && profil.data.value.idGrilleTarifaire == null,
  )
  const comptePreparation = computed(
    () =>
      !toValue(modeApercu) &&
      (compteSansTarifs.value ||
        Boolean(profil.data.value?.cacheEnPreparation) ||
        Boolean(catalogue.data.value?.cacheEnPreparation)),
  )
  const produitsParId = computed(() => {
    const produits = new Map<number, ProduitCatalogueClient>()
    for (const produit of catalogue.data.value?.produits ?? []) {
      produits.set(produit.idStockBouteille, produit)
    }
    return produits
  })
  const lignesDetail = computed(() =>
    panier.lignes.value
      .map((ligne) => {
        const produit = produitsParId.value.get(ligne.idStockBouteille)
        return produit
          ? {
              ...ligne,
              libelle: produit.libelle,
              contenant: produit.contenant,
              packaging: produit.packaging,
              photoUrl: produit.photoUrl,
              prixUnitaireHT: produit.prixHT ?? 0,
              pas: produit.pas,
              idProduit: produit.idProduit,
              idContenant: produit.idContenant,
              idLot: produit.idLot,
              produit,
              historique: produit.historique,
              sousTotal: (produit.prixHT ?? 0) * ligne.quantite,
              quantiteMaximum: produit.historique
                ? panier.modification.value?.quantitesInitiales?.[ligne.idStockBouteille] ?? ligne.quantite
                : undefined,
            }
          : null
      })
      .filter((ligne): ligne is NonNullable<typeof ligne> => ligne !== null),
  )
  const totalHT = computed(() =>
    lignesDetail.value.reduce((total, ligne) => total + ligne.sousTotal, 0),
  )
  const minimum = computed(() => profil.data.value?.client?.minimumCommande ?? null)
  // Sous le minimum uniquement quand le panier contient déjà au moins un
  // article : inutile d'alerter sur un panier vide (le bouton commander est de
  // toute façon désactivé tant que nbCartons === 0).
  const sousMinimum = computed(
    () =>
      minimum.value != null &&
      lignesDetail.value.length > 0 &&
      totalHT.value < minimum.value,
  )
  const remisesDetail = computed(() =>
    estimerRemisesCommande(lignesDetail.value, profil.data.value?.client),
  )
  const remiseMontant = computed(() =>
    remisesDetail.value.reduce((total, remise) => total + remise.montant, 0),
  )
  const commandeBloqueeParPrix = computed(() =>
    lignesDetail.value.some((ligne) => !ligne.produit.prixEstFrais),
  )
  const tagsClient = computed(() => {
    const tags = profil.data.value?.client?.tags
    if (!tags) return []
    return (Array.isArray(tags) ? tags : String(tags).split(','))
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  })
  const groupesPostauxInvalides = computed(() =>
    tagsClient.value.includes('laposte')
      ? groupesConditionnementPostalInvalides(lignesDetail.value)
      : [],
  )
  const erreursConditionnementPostal = computed(() =>
    groupesPostauxInvalides.value.map((groupe) => {
      const cartons = groupe.manque > 1 ? 'cartons' : 'carton'
      return `Livraison La Poste : ajoutez ${groupe.manque} ${cartons} en ${groupe.contenant} · ${groupe.packaging}, avec le ou les goûts de votre choix.`
    }),
  )
  const commandeBloqueeParConditionnement = computed(
    () => groupesPostauxInvalides.value.length > 0,
  )

  return {
    ...profil,
    ...panier,
    catalogue,
    comptePreparation,
    produitsParId,
    lignesDetail,
    totalHT,
    minimum,
    sousMinimum,
    remisesDetail,
    remiseMontant,
    commandeBloqueeParPrix,
    erreursConditionnementPostal,
    commandeBloqueeParConditionnement,
  }
}
