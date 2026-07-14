/**
 * Remises client (affichage indicatif côté panier).
 *
 * Les remises vivent sur la fiche client Easybeer (`remise`, `remise2`,
 * `typeRemise2`) et sont appliquées par Easybeer À LA FACTURATION. Ce module
 * ne sert qu'à RENDRE VISIBLES ces conditions et à en donner une ESTIMATION
 * sur le sous-total ; le montant définitif figure toujours sur la facture GOA.
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

function estCascade(client: RemisesClient): boolean {
  return (client.typeRemise2 ?? '').toUpperCase().includes('CASCADE')
}

/** Applique une remise à une base et renvoie le MONTANT retiré. */
function montantRemise(base: number, r: Remise | null): number {
  if (!r) return 0
  return r.type === 'pct' ? (base * r.valeur) / 100 : r.valeur
}

/** true si le client a au moins une remise globale exploitable. */
export function aRemises(client: RemisesClient | null | undefined): boolean {
  if (!client) return false
  return parseRemise(client.remise) != null || parseRemise(client.remise2) != null
}

/**
 * Libellé des conditions de remise, ex. « 12 % + 5 % additionnelle ».
 * null si aucune remise globale.
 */
export function libelleRemises(client: RemisesClient | null | undefined): string | null {
  if (!client) return null
  const r1 = parseRemise(client.remise)
  const r2 = parseRemise(client.remise2)
  const parts: string[] = []
  if (r1) parts.push(libelleRemise(r1))
  if (r2) parts.push(`${libelleRemise(r2)} ${estCascade(client) ? 'en cascade' : 'additionnelle'}`)
  return parts.length ? parts.join(' + ') : null
}

/**
 * Montant de remise ESTIMÉ sur un sous-total HT (remises globales seulement).
 * ADDITIONNELLE : les deux remises portent sur la base ; CASCADE : la seconde
 * porte sur le reste après la première. 0 si aucune remise.
 */
export function estimerRemise(sousTotalHT: number, client: RemisesClient | null | undefined): number {
  if (!client || !(sousTotalHT > 0)) return 0
  const r1 = parseRemise(client.remise)
  const r2 = parseRemise(client.remise2)
  if (!r1 && !r2) return 0
  const d1 = montantRemise(sousTotalHT, r1)
  if (!r2) return Math.min(d1, sousTotalHT)
  const d2 = estCascade(client)
    ? montantRemise(sousTotalHT - d1, r2)
    : montantRemise(sousTotalHT, r2)
  return Math.min(d1 + d2, sousTotalHT)
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
    const meilleureRemise = remises.reduce<{ montant: number; label: string } | null>((max, remise) => {
      const r = parseRemise(remise.remise)
      if (!r || !cibleProduit(ligne, remise)) return max
      const minimum = remise.quantite ?? 0
      if (minimum > 0 && ligne.quantite < minimum) return max
      const montant = montantRemise(ligne.sousTotal, r)
      if (!max || montant > max.montant) return { montant, label: libelleRemise(r) }
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
