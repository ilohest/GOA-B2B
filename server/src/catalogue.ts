/**
 * Catalogue = produits Easybeer (cache) × overrides app (Firestore).
 *
 * `catalogueOverrides/{idStockBouteille}` = { visible, displayName, photoUrl,
 * rupture } — couche de personnalisation gérée par GOA dans l'admin.
 * **Masqué par défaut** : un produit Easybeer n'apparaît côté client que si
 * l'admin l'a explicitement rendu visible (brief §6.2).
 */
import type { Firestore } from 'firebase-admin/firestore'
import type { ModeleClientType, ProduitAutocomplete } from './easybeer.js'
import { lireCatalogue, lireGrilleTarifaire, type GrilleLigne } from './sync.js'

export interface CatalogueOverride {
  visible: boolean
  displayName: string
  photoUrl: string
  rupture: boolean
  updatedAt?: number
}

const OVERRIDE_DEFAUT: CatalogueOverride = { visible: false, displayName: '', photoUrl: '', rupture: false }

// --- Règle transporteur La Poste (brief §6.3/6.4) ---

export type FormatProduit = '35cl' | '1l' | null

/** Format déduit du libellé Easybeer (ex. « … - Carton de 6 Bouteilles - 1L »). */
export function detecterFormat(libelle: string): FormatProduit {
  if (/0[.,]?35\s*c?l/i.test(libelle)) return '35cl'
  if (/\b1\s*l\b/i.test(libelle)) return '1l'
  return null
}

/** Tags de la fiche client, normalisés (Easybeer : string, tableau, ou objets). */
export function normaliserTags(tags: unknown): string[] {
  if (tags == null) return []
  const brut = Array.isArray(tags) ? tags : String(tags).split(',')
  return brut
    .map((t) => (typeof t === 'string' ? t : ((t as { libelle?: string })?.libelle ?? '')))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Pas de commande (incrément de quantité) : les clients tagués `laposte`
 * commandent en gros cartons homogènes → multiples de 3 (35cl) / 2 (1L).
 */
export function pasDeCommande(libelle: string, tags: string[]): number {
  if (!tags.includes('laposte')) return 1
  const format = detecterFormat(libelle)
  return format === '35cl' ? 3 : format === '1l' ? 2 : 1
}

export async function lireOverrides(db: Firestore): Promise<Record<string, CatalogueOverride>> {
  const cacheRef = db.doc('cache/catalogueOverrides')
  const cache = await cacheRef.get()
  const agreges = cache.data()?.overrides as Record<string, CatalogueOverride> | undefined
  if (agreges) return agreges

  const snap = await db.collection('catalogueOverrides').get()
  const overrides: Record<string, CatalogueOverride> = {}
  for (const doc of snap.docs) overrides[doc.id] = { ...OVERRIDE_DEFAUT, ...(doc.data() as Partial<CatalogueOverride>) }
  await cacheRef.set({ overrides, syncedAt: Date.now() })
  return overrides
}

export interface CatalogueAdminTarif {
  idClientType: number
  typeClient: string
  prixHT: number
}

/** Une unité commandable (idStockBouteille) + ses tarifs par type de client. */
export interface CatalogueAdminUnite {
  idStockBouteille: number
  produit: string
  contenant: string
  packaging: string
  quantite: number | null
  libelleEasybeer: string | null
  override: CatalogueOverride
  tarifs: CatalogueAdminTarif[]
}

/**
 * Vue ADMIN : la grille tarifaire complète, une unité par idStockBouteille avec
 * TOUS ses tarifs (un par type de client), pour un tableau reproduisant Easybeer
 * (Produit / Type / Contenant / Packaging / Tarif HT) + la visibilité. Défaut :
 * masqué. Les prix viennent de la grille (pas des caches clients), donc pas de
 * dépendance aux comptes plateforme.
 */
export async function catalogueAdmin(
  db: Firestore,
): Promise<{ syncedAt: number | null; unites: CatalogueAdminUnite[] }> {
  const [{ produits }, overrides, grille] = await Promise.all([
    lireCatalogue(db).catch(() => ({ produits: [] as ProduitAutocomplete[] })),
    lireOverrides(db),
    lireGrilleTarifaire(db),
  ])
  const libelleParSB = new Map(produits.map((p) => [p.idStockBouteille, p.libelle]))

  const unites = new Map<number, CatalogueAdminUnite>()
  for (const l of grille.lignes) {
    if (l.idStockBouteille == null) continue // prix sans unité stockée → non commandable
    let u = unites.get(l.idStockBouteille)
    if (!u) {
      u = {
        idStockBouteille: l.idStockBouteille,
        produit: l.produit,
        contenant: l.contenant,
        packaging: l.packaging,
        quantite: l.quantite,
        libelleEasybeer: libelleParSB.get(l.idStockBouteille) ?? null,
        override: overrides[String(l.idStockBouteille)] ?? OVERRIDE_DEFAUT,
        tarifs: [],
      }
      unites.set(l.idStockBouteille, u)
    }
    if (!u.tarifs.some((t) => t.idClientType === l.idClientType)) {
      u.tarifs.push({ idClientType: l.idClientType, typeClient: l.typeClient, prixHT: l.prixHT })
    }
  }

  const liste = [...unites.values()].sort(
    (a, b) =>
      a.produit.localeCompare(b.produit, 'fr') ||
      a.contenant.localeCompare(b.contenant, 'fr') ||
      (a.quantite ?? 0) - (b.quantite ?? 0),
  )
  for (const u of liste) u.tarifs.sort((a, b) => a.typeClient.localeCompare(b.typeClient, 'fr'))

  return { syncedAt: grille.syncedAt, unites: liste }
}

export interface ProduitCatalogueClient {
  idStockBouteille: number
  idProduit?: number
  idContenant?: number
  idLot?: number
  libelle: string
  libelleEasybeer: string
  contenant: string | null
  packaging: string | null
  photoUrl: string | null
  rupture: boolean
  prixHT: number | null
  prixUpdatedAt: number | null
  prixEstFrais: boolean
  /** Incrément de quantité imposé (1 sauf clients La Poste : 3 ou 2). */
  pas: number
}

/**
 * Prix d'une unité pour un client, résolu 100 % depuis le cache :
 *  1. prix PERSONNALISÉ du client (cacheClients.prix) s'il existe — c'est la
 *     valeur exacte d'Easybeer pour ce client (tarifs négociés inclus) ;
 *  2. sinon, prix de la GRILLE de son type (cache/grilleTarifaire).
 * La fraîcheur suit la source : date du prix client, ou date de synchro grille.
 * → rendre une unité visible affiche/commande son prix immédiatement (grille),
 *   sans attendre une resynchro par client.
 */
/** Sources et réglages de la résolution du prix client (tout optionnel). */
export interface SourcesPrixClient {
  /** Prix personnalisés du client (cacheClients.prix) — priment quand frais. */
  prixClient?: Record<string, number> | null
  /** Horodatage par prix personnalisé. */
  prixUpdatedAt?: Record<string, number> | null
  /** Prix de la grille tarifaire du type du client (base). */
  grillePrix?: Record<string, number> | null
  /** Date de synchro de la grille (fraîcheur des prix de grille). */
  grilleSyncedAt?: number | null
  /** Âge max d'un prix avant d'être considéré périmé (garde-fou 36 h). */
  maxAgeMs?: number
  now?: number
}

export function resoudrePrixUnite(
  idStockBouteille: number,
  sources: SourcesPrixClient,
): { prixHT: number | null; updatedAt: number | null } {
  const {
    prixClient = null,
    prixUpdatedAt = null,
    grillePrix = null,
    grilleSyncedAt = null,
    maxAgeMs = Infinity,
    now = Date.now(),
  } = sources
  const k = String(idStockBouteille)
  const custom = prixClient?.[k] ?? null
  const customAt = prixUpdatedAt?.[k] ?? null
  const grille = grillePrix?.[k] ?? null
  const frais = (t: number | null) => t != null && now - t <= maxAgeMs

  // 1. Prix perso FRAIS → la valeur la plus précise (tarifs négociés).
  if (custom != null && frais(customAt)) return { prixHT: custom, updatedAt: customAt }
  // 2. Sinon grille FRAÎCHE → base fiable. Évite qu'un prix perso périmé (ex. non
  //    resynchronisé depuis >36 h) bloque un produit alors que la grille est à jour.
  if (grille != null && frais(grilleSyncedAt)) return { prixHT: grille, updatedAt: grilleSyncedAt }
  // 3. Aucune source fraîche : on renvoie ce qu'on a (perso prioritaire), marqué non-frais.
  if (custom != null) return { prixHT: custom, updatedAt: customAt }
  if (grille != null) return { prixHT: grille, updatedAt: grilleSyncedAt }
  return { prixHT: null, updatedAt: null }
}

/**
 * Prix de grille applicables à un client : résout son type vers la grille la
 * plus proche qui EXISTE (lui-même ou un ancêtre) — un Distributeur tape la
 * grille Distributeur, un GMS/CHR remonte jusqu'à `client PRO`. Renvoie la map
 * idStockBouteille → prixHT pour ce type.
 */
export function grillePrixPourClient(
  grilleLignes: GrilleLigne[],
  idClientType: number | null | undefined,
  types: ModeleClientType[],
): { prix: Record<string, number>; idTypeGrille: number | null } {
  const grilleTypes = new Set<number>()
  for (const l of grilleLignes) grilleTypes.add(l.idClientType)

  const parId = new Map<number, ModeleClientType>()
  for (const t of types) if (t.idClientType != null) parId.set(t.idClientType, t)

  let idTypeGrille: number | null = null
  let courant: number | null = idClientType ?? null
  const vus = new Set<number>()
  while (courant != null && !vus.has(courant)) {
    if (grilleTypes.has(courant)) {
      idTypeGrille = courant
      break
    }
    vus.add(courant)
    courant = parId.get(courant)?.idParent ?? null
  }

  const prix: Record<string, number> = {}
  if (idTypeGrille != null) {
    for (const l of grilleLignes) {
      if (l.idClientType === idTypeGrille && l.idStockBouteille != null) {
        prix[String(l.idStockBouteille)] = l.prixHT
      }
    }
  }
  return { prix, idTypeGrille }
}

/**
 * Vue CLIENT : uniquement les produits rendus visibles, libellé d'affichage,
 * prix du client connecté (personnalisé sinon grille), flag rupture. Pas de
 * quantités de stock (brief §6.2 : la dispo = le flag rupture géré dans l'app).
 */
export function catalogueClient(
  produits: ProduitAutocomplete[],
  overrides: Record<string, CatalogueOverride>,
  options: SourcesPrixClient & {
    tagsClient?: unknown
    unitesMeta?: Record<
      number,
      { produit: string | null; contenant: string | null; packaging: string | null }
    >
  } = {},
): ProduitCatalogueClient[] {
  const tags = normaliserTags(options.tagsClient ?? null)
  const now = options.now ?? Date.now()
  const prixMaxAgeMs = options.maxAgeMs ?? Infinity
  const sources: SourcesPrixClient = { ...options, now, maxAgeMs: prixMaxAgeMs }
  return produits
    .filter((p) => overrides[String(p.idStockBouteille)]?.visible)
    .map((p) => {
      const o = overrides[String(p.idStockBouteille)]
      const { prixHT, updatedAt } = resoudrePrixUnite(p.idStockBouteille, sources)
      return {
        idStockBouteille: p.idStockBouteille,
        idProduit: p.idProduit,
        idContenant: p.idContenant,
        idLot: p.idLot,
        // Le format a ses propres badges côté client : sans nom personnalisé,
        // afficher seulement le produit évite de répéter contenant/packaging.
        libelle: o.displayName || options.unitesMeta?.[p.idStockBouteille]?.produit || p.libelle,
        libelleEasybeer: p.libelle,
        contenant: options.unitesMeta?.[p.idStockBouteille]?.contenant ?? null,
        packaging: options.unitesMeta?.[p.idStockBouteille]?.packaging ?? null,
        photoUrl: o.photoUrl || null,
        rupture: o.rupture,
        prixHT,
        prixUpdatedAt: updatedAt,
        prixEstFrais: prixHT != null && updatedAt != null && now - updatedAt <= prixMaxAgeMs,
        pas: pasDeCommande(p.libelle, tags),
      }
    })
    .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'))
}

/** Upsert d'un override (admin). Seuls les champs fournis sont modifiés. */
export async function majOverride(
  db: Firestore,
  idStockBouteille: number,
  patch: Partial<CatalogueOverride>,
): Promise<CatalogueOverride> {
  const ref = db.collection('catalogueOverrides').doc(String(idStockBouteille))
  const cacheRef = db.doc('cache/catalogueOverrides')
  // Initialise l'agrégat si le projet existait avant cette optimisation.
  await lireOverrides(db)
  const champs: Partial<CatalogueOverride> = {}
  if (typeof patch.visible === 'boolean') champs.visible = patch.visible
  if (typeof patch.rupture === 'boolean') champs.rupture = patch.rupture
  if (typeof patch.displayName === 'string') champs.displayName = patch.displayName.trim()
  // La politique d'URL (chemin local ou https) est validée en amont (schemas.ts).
  if (typeof patch.photoUrl === 'string') champs.photoUrl = patch.photoUrl.trim()
  const updatedAt = Date.now()
  return db.runTransaction(async (tx) => {
    const [existant, cache] = await Promise.all([tx.get(ref), tx.get(cacheRef)])
    const override = {
      ...OVERRIDE_DEFAUT,
      ...(existant.data() as Partial<CatalogueOverride> | undefined),
      ...champs,
      updatedAt,
    }
    const overrides = (cache.data()?.overrides ?? {}) as Record<string, CatalogueOverride>
    tx.set(ref, override)
    tx.set(cacheRef, { overrides: { ...overrides, [String(idStockBouteille)]: override }, syncedAt: updatedAt })
    return override
  })
}
