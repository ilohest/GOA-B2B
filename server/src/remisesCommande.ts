/**
 * Logique de REMISE d'une commande (pure, testable, sans effet de bord).
 *
 * Reproduit fidèlement la résolution d'Easybeer (vérifiée en live / commande
 * manuelle, cf. EASYBEER.md) :
 *  - UNE remise par ligne (Easybeer n'honore qu'un seul champ `remise`).
 *  - Une remise PRODUIT (ciblée) remplace la remise COMMANDE (globale) sur la ligne.
 *  - PRIORITÉ DE PORTÉE : le réglage du CLIENT individuel prime sur celui du
 *    SEGMENT (type de client) — à la fois pour les remises produit et commande.
 *    Le max ne joue qu'AU SEIN d'une même portée. (Ex. Cola : client 10 %
 *    l'emporte sur segment 20 %.)
 *  - `remise2` (€ additionnelle) n'est PAS transmise (Easybeer ne l'applique pas).
 */
import type { LigneCommandeInput, ProduitAutocomplete } from './easybeer.js'
import type { CacheClientDoc } from './sync.js'

type ClientCache = CacheClientDoc['client']

export interface RemiseCalculee {
  type: 'pct' | 'eur'
  valeur: number
}

export interface RemisesCommandeLocales {
  globaleLabel: string | null
  globaleMontant: number | null
  ciblees: {
    idStockBouteille: number
    libelle: string
    remiseLabel: string
    montant: number
  }[]
}

export interface RemiseApplicable {
  raw: string
  label: string
  montant: number
  typeRemise2?: string | null
}

export function arrondirPrix(valeur: number) {
  return Math.round(valeur * 100) / 100
}

export function parseRemiseCommande(brut: string | null | undefined): RemiseCalculee | null {
  if (!brut) return null
  const texte = brut.trim()
  if (!texte) return null
  const pct = texte.endsWith('%')
  const valeur = Number.parseFloat(texte.replace('%', '').replace('€', '').replace(',', '.').trim())
  if (!Number.isFinite(valeur) || valeur <= 0) return null
  return { type: pct ? 'pct' : 'eur', valeur }
}

export function libelleRemiseCommande(remise: RemiseCalculee) {
  return remise.type === 'pct' ? `${remise.valeur} %` : `${remise.valeur.toFixed(2).replace('.', ',')} €`
}

export function rawRemiseCommande(remise: RemiseCalculee) {
  return remise.type === 'pct' ? `${remise.valeur}%` : String(remise.valeur)
}

export function montantRemiseCommande(base: number, remise: RemiseCalculee | null) {
  if (!remise) return 0
  return remise.type === 'pct' ? (base * remise.valeur) / 100 : remise.valeur
}

export function libelleRemisesCommande(client: ClientCache) {
  const remise1 = parseRemiseCommande(client.remise)
  const parties: string[] = []
  if (remise1) parties.push(libelleRemiseCommande(remise1))
  return parties.length ? parties.join(' + ') : null
}

export function calculerRemiseGlobaleCommande(sousTotalHT: number, client: ClientCache) {
  const remise1 = parseRemiseCommande(client.remise)
  if (!remise1) return 0
  const montant1 = montantRemiseCommande(sousTotalHT, remise1)
  return Math.min(montant1, sousTotalHT)
}

export function cibleRemiseProduit(
  ligne: { produit: ProduitAutocomplete },
  remise: NonNullable<ClientCache['remisesCiblees']>[number],
) {
  if (remise.idStockBouteille != null) return remise.idStockBouteille === ligne.produit.idStockBouteille
  if (remise.idProduit != null && remise.idProduit !== ligne.produit.idProduit) return false
  if (remise.idContenant != null && remise.idContenant !== ligne.produit.idContenant) return false
  if (remise.idLot != null && remise.idLot !== ligne.produit.idLot) return false
  return remise.idProduit != null || remise.idContenant != null || remise.idLot != null
}

/**
 * Meilleure remise PRODUIT applicable à la ligne, en respectant la priorité de
 * portée : CLIENT prime sur SEGMENT (le max ne joue qu'au sein d'une portée).
 */
export function meilleureRemiseCibleeCommande(ligne: LigneCommandeInput, client: ClientCache): RemiseApplicable | null {
  const sousTotalLigne = ligne.quantite * ligne.prixUnitaireHT
  const applicables = (client.remisesCiblees ?? [])
    .map((remise) => ({ remise, parsee: parseRemiseCommande(remise.remise) }))
    .filter(({ remise, parsee }) => {
      if (!parsee || !cibleRemiseProduit(ligne, remise)) return false
      const minimum = remise.quantite ?? 0
      return !(minimum > 0 && ligne.quantite < minimum)
    })
  if (!applicables.length) return null
  // ⚠️ Priorité EASYBEER (vérifiée sur commande manuelle) : remise produit CLIENT
  // prime sur SEGMENT — PAS le max. Ex. Cola : client 10 % l'emporte sur segment 20 %.
  const portClient = applicables.filter(({ remise }) => (remise as { scope?: string }).scope !== 'segment')
  const pool = portClient.length ? portClient : applicables
  const meilleure = pool.reduce((max, courant) =>
    montantRemiseCommande(sousTotalLigne, courant.parsee!) > montantRemiseCommande(sousTotalLigne, max.parsee!)
      ? courant
      : max,
  )
  return {
    raw: rawRemiseCommande(meilleure.parsee!),
    label: libelleRemiseCommande(meilleure.parsee!),
    montant: montantRemiseCommande(sousTotalLigne, meilleure.parsee!),
  }
}

/** Estimation locale des remises (affichage) : globale + ciblées par ligne. */
export function calculerRemisesCommande(lignes: LigneCommandeInput[], client: ClientCache): RemisesCommandeLocales {
  const sousTotalHT = lignes.reduce((somme, l) => somme + l.quantite * l.prixUnitaireHT, 0)
  const ciblees = lignes.flatMap((ligne) => {
    const meilleure = meilleureRemiseCibleeCommande(ligne, client)
    if (!meilleure) return []
    const sousTotalLigne = ligne.quantite * ligne.prixUnitaireHT
    return [{
      idStockBouteille: ligne.produit.idStockBouteille,
      libelle: ligne.produit.libelle,
      remiseLabel: meilleure.label,
      montant: arrondirPrix(Math.min(meilleure.montant, sousTotalLigne)),
    }]
  })

  const globaleMontant = arrondirPrix(calculerRemiseGlobaleCommande(sousTotalHT, client))
  return {
    globaleLabel: libelleRemisesCommande(client),
    globaleMontant: globaleMontant > 0 ? globaleMontant : null,
    ciblees,
  }
}

/**
 * Pose sur la ligne la remise réellement exploitable par Easybeer :
 * remise ciblée produit si elle s'applique, sinon remise commande globale.
 * La remise2 n'est pas transmise dans les commandes de la plateforme.
 */
export function enrichirLigneAvecRemises(ligne: LigneCommandeInput, client: ClientCache): LigneCommandeInput {
  const ciblee = meilleureRemiseCibleeCommande(ligne, client)
  // parseRemiseCommande écarte les valeurs vides/nulles/« 0% » → pas de crash.
  const globale = parseRemiseCommande(client.remise)
  const remise1 = ciblee?.raw ?? (globale ? rawRemiseCommande(globale) : null)
  if (!remise1) return ligne
  return {
    ...ligne,
    remise: remise1,
    remiseLibelle: ciblee?.label ?? (globale ? libelleRemiseCommande(globale) : null),
    remise2: null,
    typeRemise2: null,
  }
}

export function lignesSansRemise2(lignes: LigneCommandeInput[]): LigneCommandeInput[] {
  return lignes.map((ligne) => ({
    ...ligne,
    remise2: null,
    typeRemise2: null,
    remise2Libelle: null,
  }))
}

export function lignesSansRemises(lignes: LigneCommandeInput[]): LigneCommandeInput[] {
  return lignes.map((ligne) => ({
    ...ligne,
    remise: null,
    remise2: null,
    typeRemise2: null,
    remiseLibelle: null,
    remise2Libelle: null,
    valeurRemise: null,
    prixUnitaireHTRemise: null,
    prixTotalHT: null,
  }))
}
