/**
 * Catalogue = produits Easybeer (cache) × overrides app (Firestore).
 *
 * `catalogueOverrides/{idStockBouteille}` = { visible, displayName, photoUrl,
 * rupture } — couche de personnalisation gérée par GOA dans l'admin.
 * **Masqué par défaut** : un produit Easybeer n'apparaît côté client que si
 * l'admin l'a explicitement rendu visible (brief §6.2).
 */
import type { Firestore } from 'firebase-admin/firestore'
import type { ProduitAutocomplete } from './easybeer.js'
import { lireCatalogue } from './sync.js'

export interface CatalogueOverride {
  visible: boolean
  displayName: string
  photoUrl: string
  rupture: boolean
  updatedAt?: number
}

const OVERRIDE_DEFAUT: CatalogueOverride = { visible: false, displayName: '', photoUrl: '', rupture: false }

export async function lireOverrides(db: Firestore): Promise<Record<string, CatalogueOverride>> {
  const snap = await db.collection('catalogueOverrides').get()
  const overrides: Record<string, CatalogueOverride> = {}
  for (const doc of snap.docs) overrides[doc.id] = { ...OVERRIDE_DEFAUT, ...(doc.data() as Partial<CatalogueOverride>) }
  return overrides
}

/** Vue ADMIN : tous les produits Easybeer + leur override (défaut : masqué). */
export async function catalogueAdmin(db: Firestore) {
  const [{ produits, syncedAt }, overrides] = await Promise.all([lireCatalogue(db), lireOverrides(db)])
  return {
    syncedAt,
    produits: produits.map((p) => ({
      produit: p,
      override: overrides[String(p.idStockBouteille)] ?? OVERRIDE_DEFAUT,
    })),
  }
}

export interface ProduitCatalogueClient {
  idStockBouteille: number
  libelle: string
  libelleEasybeer: string
  photoUrl: string | null
  rupture: boolean
  prixHT: number | null
}

/**
 * Vue CLIENT : uniquement les produits rendus visibles, libellé d'affichage,
 * prix du client connecté (cache), flag rupture. Pas de quantités de stock
 * (brief §6.2 : la dispo = le flag rupture géré dans l'app).
 */
export function catalogueClient(
  produits: ProduitAutocomplete[],
  overrides: Record<string, CatalogueOverride>,
  prixClient: Record<string, number> | null,
): ProduitCatalogueClient[] {
  return produits
    .filter((p) => overrides[String(p.idStockBouteille)]?.visible)
    .map((p) => {
      const o = overrides[String(p.idStockBouteille)]
      return {
        idStockBouteille: p.idStockBouteille,
        libelle: o.displayName || p.libelle,
        libelleEasybeer: p.libelle,
        photoUrl: o.photoUrl || null,
        rupture: o.rupture,
        prixHT: prixClient?.[String(p.idStockBouteille)] ?? null,
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
  const champs: Partial<CatalogueOverride> = {}
  if (typeof patch.visible === 'boolean') champs.visible = patch.visible
  if (typeof patch.rupture === 'boolean') champs.rupture = patch.rupture
  if (typeof patch.displayName === 'string') champs.displayName = patch.displayName.trim()
  if (typeof patch.photoUrl === 'string') champs.photoUrl = patch.photoUrl.trim()
  await ref.set({ ...champs, updatedAt: Date.now() }, { merge: true })
  return { ...OVERRIDE_DEFAUT, ...((await ref.get()).data() as Partial<CatalogueOverride>) }
}
