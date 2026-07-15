/**
 * Tests de la logique de remise commande.
 *
 * ⚠️ SOURCE DE VÉRITÉ = EASYBEER. Les valeurs attendues ici ne sont pas
 * arbitraires : elles reproduisent le comportement RÉEL d'Easybeer, vérifié en
 * live (résolveur `POST /parametres/remise` + commande manuelle #2012 de la
 * cliente). Le point sensible verrouillé : la remise produit du CLIENT prime sur
 * celle du SEGMENT (type client) — PAS la plus avantageuse. Ex. Cola : client
 * 10 % l'emporte sur segment 20 %. La cohérence avec Easybeer en conditions
 * réelles est en plus vérifiée par `scripts/verify-commande-coherence.ts`
 * (compare notre remise par ligne au résolveur d'Easybeer).
 */
import { describe, expect, it } from 'vitest'
import {
  calculerRemisesCommande,
  enrichirLigneAvecRemises,
  meilleureRemiseCibleeCommande,
  parseRemiseCommande,
} from '../src/remisesCommande.js'
import type { LigneCommandeInput, ProduitAutocomplete } from '../src/easybeer.js'
import type { CacheClientDoc } from '../src/sync.js'

type ClientCache = CacheClientDoc['client']
type RemiseCiblee = NonNullable<ClientCache['remisesCiblees']>[number]

const ID_COLA = 40720

function ligne(idProduit: number, quantite: number, prixUnitaireHT = 35.1, idStockBouteille = 1): LigneCommandeInput {
  const produit = { idStockBouteille, libelle: 'Produit test', idProduit } as ProduitAutocomplete
  return { produit, quantite, prixUnitaireHT }
}

function client(overrides: Partial<ClientCache> & { remisesCiblees?: Partial<RemiseCiblee>[] }): ClientCache {
  return {
    remise: null,
    remise2: null,
    typeRemise2: null,
    remisesCiblees: [],
    ...overrides,
  } as ClientCache
}

describe('priorité de portée : remise produit CLIENT > SEGMENT', () => {
  it('client 10 % l’emporte sur segment 20 % (PAS le max) — cas Easybeer vérifié', () => {
    const c = client({
      remise: '12%',
      remisesCiblees: [
        { idProduit: ID_COLA, quantite: 2, remise: '10%', scope: 'client' },
        { idProduit: ID_COLA, quantite: 10, remise: '20%', scope: 'segment' },
      ],
    })
    // qté 24 : les deux sont éligibles ; le client doit gagner.
    expect(enrichirLigneAvecRemises(ligne(ID_COLA, 24), c).remise).toBe('10%')
    expect(meilleureRemiseCibleeCommande(ligne(ID_COLA, 24), c)?.montant).toBeCloseTo(24 * 35.1 * 0.1, 2)
  })

  it('remise SEGMENT s’applique quand le client n’a pas de remise produit', () => {
    const c = client({ remisesCiblees: [{ idProduit: ID_COLA, quantite: 10, remise: '20%', scope: 'segment' }] })
    expect(enrichirLigneAvecRemises(ligne(ID_COLA, 24), c).remise).toBe('20%')
  })

  it('plusieurs remises produit CLIENT → la plus avantageuse (max AU SEIN de la portée)', () => {
    const c = client({
      remisesCiblees: [
        { idProduit: ID_COLA, quantite: 2, remise: '10%', scope: 'client' },
        { idProduit: ID_COLA, quantite: 10, remise: '15%', scope: 'client' },
      ],
    })
    expect(enrichirLigneAvecRemises(ligne(ID_COLA, 24), c).remise).toBe('15%')
  })
})

describe('produit vs commande, et fallback commande', () => {
  it('une remise produit remplace la remise commande sur la ligne', () => {
    const c = client({ remise: '12%', remisesCiblees: [{ idProduit: ID_COLA, quantite: 2, remise: '10%', scope: 'client' }] })
    expect(enrichirLigneAvecRemises(ligne(ID_COLA, 3), c).remise).toBe('10%')
  })

  it('sans remise produit applicable → remise commande globale du client', () => {
    const c = client({ remise: '12%', remisesCiblees: [] })
    expect(enrichirLigneAvecRemises(ligne(999, 3), c).remise).toBe('12%')
  })

  it('quantité sous le minimum → remise produit ignorée, repli sur la commande', () => {
    const c = client({
      remise: '12%',
      remisesCiblees: [{ idProduit: ID_COLA, quantite: 10, remise: '20%', scope: 'segment' }],
    })
    // qté 3 < 10 → segment inapplicable → commande 12 %.
    expect(enrichirLigneAvecRemises(ligne(ID_COLA, 3), c).remise).toBe('12%')
  })
})

describe('remise2 et robustesse', () => {
  it('ne transmet jamais remise2 / typeRemise2', () => {
    const c = client({ remise: '12%', remise2: '5', typeRemise2: 'ADDITIONNELLE' })
    const e = enrichirLigneAvecRemises(ligne(999, 3), c)
    expect(e.remise).toBe('12%')
    expect(e.remise2).toBeNull()
    expect(e.typeRemise2).toBeNull()
  })

  it('remise « 0% » ou vide → ligne inchangée, pas de crash', () => {
    expect(enrichirLigneAvecRemises(ligne(999, 3), client({ remise: '0%' })).remise).toBeUndefined()
    expect(enrichirLigneAvecRemises(ligne(999, 3), client({ remise: null })).remise).toBeUndefined()
  })

  it('parseRemiseCommande : % vs €, rejette vide/négatif/zéro', () => {
    expect(parseRemiseCommande('12%')).toEqual({ type: 'pct', valeur: 12 })
    expect(parseRemiseCommande('5')).toEqual({ type: 'eur', valeur: 5 })
    expect(parseRemiseCommande('5€')).toEqual({ type: 'eur', valeur: 5 })
    expect(parseRemiseCommande('0%')).toBeNull()
    expect(parseRemiseCommande('')).toBeNull()
    expect(parseRemiseCommande(null)).toBeNull()
  })
})

describe('estimation (calculerRemisesCommande) : même priorité que l’application', () => {
  it('la ciblée client prime dans l’estimation aussi (10 %, pas 20 %)', () => {
    const c = client({
      remise: '12%',
      remise2: '5',
      remisesCiblees: [
        { idProduit: ID_COLA, quantite: 2, remise: '10%', scope: 'client' },
        { idProduit: ID_COLA, quantite: 10, remise: '20%', scope: 'segment' },
      ],
    })
    const res = calculerRemisesCommande([ligne(ID_COLA, 24)], c)
    expect(res.ciblees).toHaveLength(1)
    expect(res.ciblees[0].montant).toBeCloseTo(24 * 35.1 * 0.1, 2) // 10 % du client, pas 20 % segment
  })
})
