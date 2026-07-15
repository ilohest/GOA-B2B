/**
 * Remises client (affichage indicatif côté panier).
 *
 * Les remises vivent sur la fiche client Easybeer. Côté commande, on exploite
 * uniquement la remise globale principale et les remises ciblées produit.
 *
 * Convention Easybeer (cf. EASYBEER.md) : une remise est une string terminée
 * par « % » → pourcentage, sinon un montant en euros.
 */
import { prixFr } from './format'

export interface RemisesClient {
  remise?: string | null
  remise2?: string | null
  typeRemise2?: string | null
  remisesCiblees?: RemiseCiblee[] | null
}

export interface RemiseCiblee {
  idProduit?: number | null
  idContenant?: number | null
  idLot?: number | null
  idStockBouteille?: number | null
  quantite?: number | null
  remise?: string | null
  /** Portée : 'client' (fiche client) ou 'segment' (type de client). */
  scope?: 'client' | 'segment' | string | null
}

export interface LigneRemiseCiblee {
  idStockBouteille: number
  idProduit?: number | null
  idContenant?: number | null
  idLot?: number | null
  libelle?: string
  quantite: number
  sousTotal: number
}

export interface DetailRemiseCiblee {
  idStockBouteille: number
  libelle: string
  remiseLabel: string
  montant: number
}

interface Remise {
  type: 'pct' | 'eur'
  valeur: number
}

/** Parse « 12% », « 5 », « 5€ » → { type, valeur } ; null si vide/invalide. */
function parseRemise(brut: string | null | undefined): Remise | null {
  if (!brut) return null
  const t = brut.trim()
  if (!t) return null
  const pct = t.endsWith('%')
  const valeur = parseFloat(t.replace('%', '').replace('€', '').replace(',', '.').trim())
  if (!Number.isFinite(valeur) || valeur <= 0) return null
  return { type: pct ? 'pct' : 'eur', valeur }
}

function libelleRemise(r: Remise): string {
  return r.type === 'pct' ? `${r.valeur} %` : prixFr(r.valeur)
}

/** Applique une remise à une base et renvoie le MONTANT retiré. */
function montantRemise(base: number, r: Remise | null): number {
  if (!r) return 0
  return r.type === 'pct' ? (base * r.valeur) / 100 : r.valeur
}

/** true si le client a au moins une remise globale exploitable. */
export function aRemises(client: RemisesClient | null | undefined): boolean {
  if (!client) return false
  return parseRemise(client.remise) != null
}

/**
 * Libellé des conditions de remise, ex. « 12 % ».
 * null si aucune remise globale.
 */
export function libelleRemises(client: RemisesClient | null | undefined): string | null {
  if (!client) return null
  const r1 = parseRemise(client.remise)
  const parts: string[] = []
  if (r1) parts.push(libelleRemise(r1))
  return parts.length ? parts.join(' + ') : null
}

/**
 * Montant de remise sur un sous-total HT (remise globale principale seulement).
 */
export function estimerRemise(sousTotalHT: number, client: RemisesClient | null | undefined): number {
  if (!client || !(sousTotalHT > 0)) return 0
  const r1 = parseRemise(client.remise)
  if (!r1) return 0
  const d1 = montantRemise(sousTotalHT, r1)
  return Math.min(d1, sousTotalHT)
}

/**
 * Estimation FIDÈLE au comportement d'Easybeer (vérifié sur devis #2012, cf.
 * EASYBEER.md) : par ligne, UNE seule remise = la remise CIBLÉE produit si elle
 * s'applique (elle REMPLACE la globale sur cette ligne), SINON la remise globale
 * principale de la fiche. Renvoie le détail par ligne.
 */
export function estimerRemisesCommande(
  lignes: LigneRemiseCiblee[],
  client: RemisesClient | null | undefined,
): DetailRemiseCiblee[] {
  const globale = parseRemise(client?.remise)
  const ciblees = client?.remisesCiblees ?? []
  return lignes.flatMap((ligne) => {
    if (!(ligne.sousTotal > 0)) return []
    // Remises produit applicables à la ligne (produit/contenant/lot + qté min).
    const applicablesCiblees = ciblees.filter((rc) => {
      const r = parseRemise(rc.remise)
      if (!r || !cibleProduit(ligne, rc)) return false
      return !((rc.quantite ?? 0) > 0 && ligne.quantite < (rc.quantite ?? 0))
    })
    // ⚠️ Priorité Easybeer : remise produit CLIENT prime sur SEGMENT (pas le max) ;
    // le max ne joue qu'au sein d'une même portée. La ciblée remplace la globale.
    const portClient = applicablesCiblees.filter((rc) => rc.scope !== 'segment')
    const pool = portClient.length ? portClient : applicablesCiblees
    const ciblee = pool.reduce<Remise | null>((meilleure, rc) => {
      const r = parseRemise(rc.remise)!
      if (!meilleure || montantRemise(ligne.sousTotal, r) > montantRemise(ligne.sousTotal, meilleure)) return r
      return meilleure
    }, null)
    const applicable = ciblee ?? globale
    if (!applicable) return []
    return [{
      idStockBouteille: ligne.idStockBouteille,
      libelle: ligne.libelle ?? 'Produit',
      remiseLabel: libelleRemise(applicable),
      montant: Math.min(montantRemise(ligne.sousTotal, applicable), ligne.sousTotal),
    }]
  })
}

function cibleProduit(ligne: LigneRemiseCiblee, remise: RemiseCiblee) {
  if (remise.idStockBouteille != null) return remise.idStockBouteille === ligne.idStockBouteille
  if (remise.idProduit != null && remise.idProduit !== ligne.idProduit) return false
  if (remise.idContenant != null && remise.idContenant !== ligne.idContenant) return false
  if (remise.idLot != null && remise.idLot !== ligne.idLot) return false
  return remise.idProduit != null || remise.idContenant != null || remise.idLot != null
}

/**
 * Estimation des remises ciblées Easybeer. Elles s'appliquent ligne par ligne
 * quand le produit/contenant/lot et la quantité minimale correspondent.
 */
export function estimerRemisesCiblees(
  lignes: LigneRemiseCiblee[],
  client: RemisesClient | null | undefined,
): number {
  return calculerRemisesCiblees(lignes, client).reduce((total, detail) => total + detail.montant, 0)
}

export function calculerRemisesCiblees(
  lignes: LigneRemiseCiblee[],
  client: RemisesClient | null | undefined,
): DetailRemiseCiblee[] {
  const remises = client?.remisesCiblees ?? []
  if (!remises.length) return []

  return lignes.flatMap((ligne) => {
    if (!(ligne.sousTotal > 0)) return []
    const applicables = remises
      .map((remise) => ({ remise, parsee: parseRemise(remise.remise) }))
      .filter(({ remise, parsee }) => {
        if (!parsee || !cibleProduit(ligne, remise)) return false
        const minimum = remise.quantite ?? 0
        return !(minimum > 0 && ligne.quantite < minimum)
      })
    if (!applicables.length) return []

    const portClient = applicables.filter(({ remise }) => remise.scope !== 'segment')
    const pool = portClient.length ? portClient : applicables
    const meilleureRemise = pool.reduce<{ montant: number; label: string } | null>((max, { parsee }) => {
      const montant = montantRemise(ligne.sousTotal, parsee)
      if (!max || montant > max.montant) return { montant, label: libelleRemise(parsee!) }
      return max
    }, null)
    if (!meilleureRemise) return []
    return [{
      idStockBouteille: ligne.idStockBouteille,
      libelle: ligne.libelle ?? 'Produit',
      remiseLabel: meilleureRemise.label,
      montant: Math.min(meilleureRemise.montant, ligne.sousTotal),
    }]
  })
}
