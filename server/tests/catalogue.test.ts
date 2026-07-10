import { describe, expect, it } from 'vitest'
import {
  catalogueClient,
  detecterFormat,
  normaliserTags,
  pasDeCommande,
  type CatalogueOverride,
} from '../src/catalogue.js'
import type { ProduitAutocomplete } from '../src/easybeer.js'

describe('detecterFormat', () => {
  it('reconnaît le 1L', () => {
    expect(detecterFormat('Cola - Chaï - 0.0° - Carton de 6 Bouteilles - 1L')).toBe('1l')
  })
  it('reconnaît le 0.35L', () => {
    expect(detecterFormat('Cola - Chaï - 0.0° - Carton de 18 Bouteilles - 0.35L')).toBe('35cl')
    expect(detecterFormat('Framboise - 0,35 L')).toBe('35cl')
  })
  it('ne confond pas 0.35L avec 1L (le « 5L » de 0.35 ne matche pas 1L)', () => {
    expect(detecterFormat('Carton de 18 Bouteilles - 0.35L')).toBe('35cl')
  })
  it('renvoie null pour un format inconnu', () => {
    expect(detecterFormat('Fût 20 litres')).toBeNull()
  })
})

describe('normaliserTags', () => {
  it('gère null/undefined', () => {
    expect(normaliserTags(null)).toEqual([])
    expect(normaliserTags(undefined)).toEqual([])
  })
  it('gère une chaîne avec virgules et casse', () => {
    expect(normaliserTags('Frigo, LaPoste ')).toEqual(['frigo', 'laposte'])
  })
  it('gère un tableau de chaînes', () => {
    expect(normaliserTags(['LAPOSTE'])).toEqual(['laposte'])
  })
  it("gère un tableau d'objets Easybeer { libelle }", () => {
    expect(normaliserTags([{ libelle: 'Frigo' }, { libelle: '' }])).toEqual(['frigo'])
  })
})

describe('pasDeCommande (règle La Poste)', () => {
  const l1 = 'Cola - Chaï - 0.0° - Carton de 6 Bouteilles - 1L'
  const l35 = 'Cola - Chaï - 0.0° - Carton de 18 Bouteilles - 0.35L'
  it('client non tagué → pas de contrainte', () => {
    expect(pasDeCommande(l1, [])).toBe(1)
    expect(pasDeCommande(l35, ['frigo'])).toBe(1)
  })
  it('client laposte → multiples 2 (1L) et 3 (35cl)', () => {
    expect(pasDeCommande(l1, ['laposte'])).toBe(2)
    expect(pasDeCommande(l35, ['laposte'])).toBe(3)
  })
  it('format inconnu → pas de contrainte même en laposte', () => {
    expect(pasDeCommande('Fût 20 litres', ['laposte'])).toBe(1)
  })
})

describe('catalogueClient (fusion produits × overrides × prix)', () => {
  const produits: ProduitAutocomplete[] = [
    { idStockBouteille: 1, libelle: 'Zeta - 1L' },
    { idStockBouteille: 2, libelle: 'Alpha - 0.35L' },
    { idStockBouteille: 3, libelle: 'Caché - 1L' },
  ]
  const overrides: Record<string, CatalogueOverride> = {
    '1': { visible: true, displayName: '', photoUrl: '', rupture: false },
    '2': { visible: true, displayName: 'Mon Alpha', photoUrl: '/p/a.webp', rupture: true },
    // 3 : pas d'override → masqué par défaut
  }

  it('masque par défaut les produits sans override visible', () => {
    const res = catalogueClient(produits, overrides, null)
    expect(res.map((p) => p.idStockBouteille)).not.toContain(3)
    expect(res).toHaveLength(2)
  })

  it("applique displayName, photo, rupture, prix du client, et trie par libellé d'affichage", () => {
    const res = catalogueClient(produits, overrides, { '1': 27.3 })
    expect(res[0]).toMatchObject({
      idStockBouteille: 2,
      libelle: 'Mon Alpha',
      libelleEasybeer: 'Alpha - 0.35L',
      photoUrl: '/p/a.webp',
      rupture: true,
      prixHT: null,
    })
    expect(res[1]).toMatchObject({ idStockBouteille: 1, libelle: 'Zeta - 1L', prixHT: 27.3, photoUrl: null })
  })

  it('expose le pas La Poste selon le tag client', () => {
    const res = catalogueClient(produits, overrides, null, 'laposte')
    expect(res.find((p) => p.idStockBouteille === 1)?.pas).toBe(2)
    expect(res.find((p) => p.idStockBouteille === 2)?.pas).toBe(3)
    const sansTag = catalogueClient(produits, overrides, null, null)
    expect(sansTag.every((p) => p.pas === 1)).toBe(true)
  })

  it('marque les prix frais et expirés par produit', () => {
    const maintenant = Date.now()
    const res = catalogueClient(
      produits,
      overrides,
      { '1': 27.3, '2': 19.9 },
      null,
      { '1': maintenant - 30_000, '2': maintenant - 120_000 },
      60_000,
    )
    expect(res.find((p) => p.idStockBouteille === 1)).toMatchObject({
      prixHT: 27.3,
      prixEstFrais: true,
    })
    expect(res.find((p) => p.idStockBouteille === 2)).toMatchObject({
      prixHT: 19.9,
      prixEstFrais: false,
    })
  })
})
