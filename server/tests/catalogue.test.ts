import { describe, expect, it } from 'vitest'
import {
  catalogueClient,
  detecterFormat,
  grillePrixPourClient,
  normaliserTags,
  pasDeCommande,
  resoudrePrixUnite,
  type CatalogueOverride,
} from '../src/catalogue.js'
import type { ModeleClientType, ProduitAutocomplete } from '../src/easybeer.js'
import type { GrilleLigne } from '../src/sync.js'

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
    const res = catalogueClient(produits, overrides)
    expect(res.map((p) => p.idStockBouteille)).not.toContain(3)
    expect(res).toHaveLength(2)
  })

  it("applique displayName, photo, rupture, prix du client, et trie par libellé d'affichage", () => {
    const res = catalogueClient(produits, overrides, { prixClient: { '1': 27.3 } })
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
    const res = catalogueClient(produits, overrides, { tagsClient: 'laposte' })
    expect(res.find((p) => p.idStockBouteille === 1)?.pas).toBe(2)
    expect(res.find((p) => p.idStockBouteille === 2)?.pas).toBe(3)
    const sansTag = catalogueClient(produits, overrides)
    expect(sansTag.every((p) => p.pas === 1)).toBe(true)
  })

  it('marque les prix frais et expirés par produit', () => {
    const maintenant = Date.now()
    const res = catalogueClient(produits, overrides, {
      prixClient: { '1': 27.3, '2': 19.9 },
      prixUpdatedAt: { '1': maintenant - 30_000, '2': maintenant - 120_000 },
      maxAgeMs: 60_000,
    })
    expect(res.find((p) => p.idStockBouteille === 1)).toMatchObject({
      prixHT: 27.3,
      prixEstFrais: true,
    })
    expect(res.find((p) => p.idStockBouteille === 2)).toMatchObject({
      prixHT: 19.9,
      prixEstFrais: false,
    })
  })

  it('retombe sur le prix de grille quand le client n\'a pas de prix perso (fraîcheur = synchro grille)', () => {
    const maintenant = Date.now()
    // Produit 1 : pas de prix client → grille ; produit 2 : prix client (prime).
    const res = catalogueClient(produits, overrides, {
      prixClient: { '2': 18 }, // prix perso du produit 2 seulement
      prixUpdatedAt: { '2': maintenant - 10_000 },
      maxAgeMs: 60_000,
      grillePrix: { '1': 27.3, '2': 99 }, // grille (99 ignoré pour le 2 car le perso prime)
      grilleSyncedAt: maintenant - 5_000, // synchro grille récente
    })
    expect(res.find((p) => p.idStockBouteille === 1)).toMatchObject({ prixHT: 27.3, prixEstFrais: true })
    expect(res.find((p) => p.idStockBouteille === 2)).toMatchObject({ prixHT: 18, prixEstFrais: true })
  })
})

describe('resoudrePrixUnite (perso → grille)', () => {
  it('le prix personnalisé du client prime', () => {
    expect(
      resoudrePrixUnite(1, { prixClient: { '1': 20 }, prixUpdatedAt: { '1': 111 }, grillePrix: { '1': 27.3 }, grilleSyncedAt: 999 }),
    ).toEqual({ prixHT: 20, updatedAt: 111 })
  })
  it('retombe sur la grille (fraîcheur = synchro grille)', () => {
    expect(resoudrePrixUnite(1, { grillePrix: { '1': 27.3 }, grilleSyncedAt: 999 })).toEqual({
      prixHT: 27.3,
      updatedAt: 999,
    })
  })
  it('aucune source → null', () => {
    expect(resoudrePrixUnite(1, {})).toEqual({ prixHT: null, updatedAt: null })
  })
  it('un prix perso PÉRIMÉ ne bloque pas : bascule sur la grille fraîche', () => {
    const now = Date.now()
    const r = resoudrePrixUnite(1, {
      prixClient: { '1': 35.1 }, // prix perso...
      prixUpdatedAt: { '1': now - 3 * 24 * 3600 * 1000 }, // ...vieux de 3 jours (périmé)
      grillePrix: { '1': 35.1 }, // grille...
      grilleSyncedAt: now - 5 * 60 * 1000, // ...synchro il y a 5 min (fraîche)
      maxAgeMs: 36 * 3600 * 1000,
      now,
    })
    expect(r).toEqual({ prixHT: 35.1, updatedAt: now - 5 * 60 * 1000 })
  })
  it('prix perso frais prime sur la grille', () => {
    const now = Date.now()
    const r = resoudrePrixUnite(1, {
      prixClient: { '1': 20 },
      prixUpdatedAt: { '1': now - 1000 },
      grillePrix: { '1': 35.1 },
      grilleSyncedAt: now - 1000,
      maxAgeMs: 36 * 3600 * 1000,
      now,
    })
    expect(r.prixHT).toBe(20)
  })
})

describe('grillePrixPourClient (résolution du type vers la grille)', () => {
  const types: ModeleClientType[] = [
    { idClientType: 17849, libelle: 'client PRO' },
    { idClientType: 20680, libelle: 'GMS', idParent: 17849 },
    { idClientType: 20735, libelle: 'Distributeur', idParent: 17849 },
  ]
  const l = (idStockBouteille: number, idClientType: number, prixHT: number): GrilleLigne => ({
    idStockBouteille,
    idProduit: 40720,
    produit: 'Cola',
    idContenant: 2654,
    contenant: 'Bouteille - 1L',
    idLot: 3,
    packaging: 'Carton de 6',
    quantite: 6,
    idClientType,
    typeClient: String(idClientType),
    prixHT,
    horsDroits: true,
  })
  const lignes = [l(1, 17849, 27.3), l(1, 20735, 21.84)]

  it('un GMS (sans grille propre) hérite de client PRO', () => {
    const { prix, idTypeGrille } = grillePrixPourClient(lignes, 20680, types)
    expect(idTypeGrille).toBe(17849)
    expect(prix).toEqual({ '1': 27.3 })
  })
  it('un Distributeur utilise sa propre grille', () => {
    const { prix, idTypeGrille } = grillePrixPourClient(lignes, 20735, types)
    expect(idTypeGrille).toBe(20735)
    expect(prix).toEqual({ '1': 21.84 })
  })
  it('un client PRO direct utilise la grille PRO', () => {
    expect(grillePrixPourClient(lignes, 17849, types).prix).toEqual({ '1': 27.3 })
  })
  it('type inconnu → aucune grille', () => {
    expect(grillePrixPourClient(lignes, 99999, types)).toEqual({ prix: {}, idTypeGrille: null })
  })
})
