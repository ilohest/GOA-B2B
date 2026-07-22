/**
 * Réconciliation d'une commande passée avec le catalogue courant du client.
 *
 * Entre deux commandes un produit peut avoir été retiré du catalogue, passer en
 * rupture, perdre son tarif, ou voir son pas de commande changer (clients La
 * Poste). On ne réinjecte donc jamais une commande telle quelle : chaque ligne
 * est classée, et le récap montre au client ce qui sera réellement ajouté.
 */
import type { CommandeRecommande, ProduitCatalogueClient } from './types'

export type MotifEcart = 'introuvable' | 'retire' | 'rupture' | 'sans-prix'

export interface LigneRecommande {
  idStockBouteille: number | null
  designation: string
  /** Quantité de la commande d'origine. */
  quantiteInitiale: number
  /** Quantité réellement ajoutée (alignée sur le pas), 0 si écartée. */
  quantite: number
  /** Prix unitaire HT **actuel** du catalogue (null si écartée / sans tarif). */
  prixHT: number | null
  produit: ProduitCatalogueClient | null
  /** Renseigné quand la ligne ne peut pas être reprise. */
  motif: MotifEcart | null
  /** La quantité a été arrondie pour respecter le pas de commande imposé. */
  quantiteAjustee: boolean
}

export interface RecapRecommande {
  lignes: LigneRecommande[]
  reprises: LigneRecommande[]
  ecartees: LigneRecommande[]
  /** Total de cartons qui seront ajoutés au panier. */
  nbCartons: number
  /** Sous-total HT aux prix du jour (indicatif, hors remises). */
  totalHT: number
}

export const LIBELLES_MOTIF: Record<MotifEcart, string> = {
  introuvable: "ce produit n'est plus identifiable dans Easybeer",
  retire: "ce produit n'est plus au catalogue",
  rupture: 'en rupture',
  'sans-prix': 'tarif indisponible',
}

/** Arrondit au multiple supérieur du pas imposé (min. un pas). */
function alignerSurPas(quantite: number, pas: number): number {
  if (pas <= 1) return Math.max(1, Math.floor(quantite))
  return Math.max(pas, Math.ceil(quantite / pas) * pas)
}

export function reconcilierCommande(
  commande: CommandeRecommande,
  produits: ProduitCatalogueClient[],
): RecapRecommande {
  const parId = new Map(produits.map((p) => [p.idStockBouteille, p]))

  const lignes = commande.lignes.map((ligne): LigneRecommande => {
    const base = {
      idStockBouteille: ligne.idStockBouteille,
      designation: ligne.designation,
      quantiteInitiale: ligne.quantite,
    }
    const ecarter = (motif: MotifEcart, produit: ProduitCatalogueClient | null = null) => ({
      ...base,
      quantite: 0,
      prixHT: null,
      produit,
      motif,
      quantiteAjustee: false,
    })

    if (ligne.idStockBouteille == null) return ecarter('introuvable')
    const produit = parId.get(ligne.idStockBouteille)
    // Absent de la réponse catalogue ou marqué historique : masqué par l'admin.
    if (!produit || produit.historique) return ecarter('retire', produit ?? null)
    if (produit.rupture) return ecarter('rupture', produit)
    if (produit.prixHT == null) return ecarter('sans-prix', produit)

    const quantite = alignerSurPas(ligne.quantite, produit.pas)
    return {
      ...base,
      // Le libellé du catalogue prime : c'est celui que le client voit ailleurs.
      designation: produit.libelle,
      quantite,
      prixHT: produit.prixHT,
      produit,
      motif: null,
      quantiteAjustee: quantite !== ligne.quantite,
    }
  })

  const reprises = lignes.filter((l) => l.motif == null)
  return {
    lignes,
    reprises,
    ecartees: lignes.filter((l) => l.motif != null),
    nbCartons: reprises.reduce((somme, l) => somme + l.quantite, 0),
    totalHT: reprises.reduce((somme, l) => somme + (l.prixHT ?? 0) * l.quantite, 0),
  }
}
