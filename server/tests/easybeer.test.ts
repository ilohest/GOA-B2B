import { describe, expect, it } from 'vitest'
import {
  CODES_TYPE_LIVRAISON,
  filtrerCommandesDepuis,
  idStockBouteilleElementCommande,
  modeLivraisonCommande,
  resoudreGrilleRacine,
  type ModeleClientType,
} from '../src/easybeer.js'

describe('modes de livraison Easybeer', () => {
  it('expose les cinq choix disponibles dans la fiche client', () => {
    expect(CODES_TYPE_LIVRAISON).toEqual({
      ENLEVEMENT: 'Enlèvement par le client',
      TRANSPORTEUR: 'Livraison par transporteur',
      SELF: 'Livraison par nos soins',
      SELF_SERVICE: 'Livraison avec service',
      POINT_RETRAIT: 'Point de retrait',
    })
  })

  it('lit en priorité le mode enregistré sur la commande', () => {
    expect(
      modeLivraisonCommande({
        typeLivraison: { code: 'TRANSPORTEUR', libelle: 'Livraison par transporteur' },
        client: { typeLivraisonFav: 'Enlèvement par le client' },
      }),
    ).toBe('Livraison par transporteur')
  })

  it('accepte un code seul et les anciennes commandes qui ne portent que le réglage client', () => {
    expect(modeLivraisonCommande({ typeLivraison: { code: 'SELF' } })).toBe('Livraison par nos soins')
    expect(modeLivraisonCommande({ client: { typeLivraisonFav: 'Point de retrait' } })).toBe('Point de retrait')
    expect(modeLivraisonCommande({})).toBeNull()
  })
})

describe('lignes de commande Easybeer', () => {
  it('retrouve l’unité quelle que soit la structure renvoyée par Easybeer', () => {
    expect(idStockBouteilleElementCommande({ stockBouteille: { idStockBouteille: 101 } })).toBe(101)
    expect(idStockBouteilleElementCommande({ modeleStockBouteille: { idStockBouteille: 102 } })).toBe(102)
    expect(idStockBouteilleElementCommande({ stockProduit: { idStockBouteille: 103 } })).toBe(103)
    expect(idStockBouteilleElementCommande({ stockProduit: { stockBouteille: { idStockBouteille: '104' } } })).toBe(104)
    expect(idStockBouteilleElementCommande({ idStockBouteille: 105 })).toBe(105)
  })

  it('refuse une ligne sans identifiant exploitable', () => {
    expect(idStockBouteilleElementCommande({ stockProduit: {} })).toBeNull()
  })
})

describe('resoudreGrilleRacine', () => {
  const types: ModeleClientType[] = [
    { idClientType: 17849, libelle: 'client PRO' }, // racine
    { idClientType: 20680, libelle: 'GMS', idParent: 17849 },
    { idClientType: 20735, libelle: 'Distributeur', idParent: 17849 },
    { idClientType: 99999, libelle: 'Sous-GMS', idParent: 20680 }, // 2 niveaux
  ]

  it('remonte un sous-type CRM vers sa grille racine', () => {
    expect(resoudreGrilleRacine(20680, types)).toBe(17849)
    expect(resoudreGrilleRacine(99999, types)).toBe(17849)
  })

  it('laisse une racine inchangée', () => {
    expect(resoudreGrilleRacine(17849, types)).toBe(17849)
  })

  it('gère un type inconnu (renvoie le type fourni) et undefined', () => {
    expect(resoudreGrilleRacine(12345, types)).toBe(12345)
    expect(resoudreGrilleRacine(undefined, types)).toBeUndefined()
  })

  it('ne boucle pas sur un cycle de parenté', () => {
    const cycle: ModeleClientType[] = [
      { idClientType: 1, idParent: 2 },
      { idClientType: 2, idParent: 1 },
    ]
    expect(resoudreGrilleRacine(1, cycle)).toBeDefined()
  })
})

describe('filtrerCommandesDepuis', () => {
  it('conserve uniquement les commandes créées après la date seuil', () => {
    const seuil = Date.UTC(2026, 6, 1)
    const commandes = [
      { idCommande: 1, dateCreation: '2026-06-30T23:59:59.000Z' },
      { idCommande: 2, dateCreation: '2026-07-01T00:00:00.000Z' },
      { idCommande: 3, dateCreation: Date.UTC(2026, 6, 2) },
      { idCommande: 4 },
    ]

    expect(filtrerCommandesDepuis(commandes, seuil).map((cmd) => cmd.idCommande)).toEqual([2, 3])
  })

  it('laisse la liste intacte sans date seuil', () => {
    const commandes = [{ idCommande: 1 }, { idCommande: 2 }]
    expect(filtrerCommandesDepuis(commandes, null)).toBe(commandes)
  })
})
