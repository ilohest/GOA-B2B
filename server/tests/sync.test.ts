import { describe, expect, it } from 'vitest'
import {
  agePrixMs,
  allegerClient,
  cacheClientDoitEtreRafraichi,
  cacheEstAncien,
  doitSynchroniserClientEasybeer,
  normaliserTarifsPersonnalises,
  prixEstFrais,
  type CacheClientDoc,
} from '../src/sync.js'

describe('sélection des comptes pour la synchro Easybeer', () => {
  it('synchronise par défaut un compte lié à un client Easybeer réel', () => {
    expect(doitSynchroniserClientEasybeer({ easybeerIdClient: 588074 })).toBe(true)
  })

  it('ignore un compte explicitement marqué comme fictif', () => {
    expect(doitSynchroniserClientEasybeer({ easybeerIdClient: 900001, syncEasybeer: false })).toBe(false)
  })

  it('ignore les identifiants absents ou invalides', () => {
    expect(doitSynchroniserClientEasybeer({})).toBe(false)
    expect(doitSynchroniserClientEasybeer({ easybeerIdClient: '588074' })).toBe(false)
  })
})

describe('tarifs personnalisés client', () => {
  it('extrait les prix produit de la fiche Easybeer sans les confondre avec les remises', () => {
    expect(
      normaliserTarifsPersonnalises([
        {
          id: 142693,
          type: 'STOCK_PRODUIT',
          modeleProduit: {
            idProduit: 40716,
            nom: 'Gingembre - Citron',
            nomCommercial: 'Gingembre - Citron',
            degreAlcool: 0,
          },
          modeleContenant: { idContenant: 2654, libelleAvecContenance: 'Bouteille - 1L' },
          modeleLot: { idLot: 3, libelle: 'Carton de 6' },
          prixHT: 2,
        },
      ]),
    ).toEqual([
      {
        id: 142693,
        idProduit: 40716,
        idContenant: 2654,
        idLot: 3,
        produit: 'Gingembre - Citron - 0°',
        contenant: 'Bouteille - 1L',
        packaging: 'Carton de 6',
        prixHT: 2,
      },
    ])
  })
})

describe('fraîcheur des prix en cache', () => {
  const cache = {
    prixUpdatedAt: {
      '1': 1_000,
      '2': 10_000,
    },
  } as Pick<CacheClientDoc, 'prixUpdatedAt'>

  it('accepte uniquement les prix avec un timestamp récent', () => {
    expect(prixEstFrais(cache, 2, 5_000, 12_000)).toBe(true)
    expect(prixEstFrais(cache, 1, 5_000, 12_000)).toBe(false)
    expect(prixEstFrais(cache, 3, 5_000, 12_000)).toBe(false)
  })

  it("expose l'âge d'un prix quand il existe", () => {
    expect(agePrixMs(cache, 2, 12_000)).toBe(2_000)
    expect(agePrixMs(cache, 3, 12_000)).toBeNull()
  })

  it('demande un refresh proactif avant expiration, ou si un prix visible manque', () => {
    const cacheComplet = {
      prix: { '1': 12, '2': 20 },
      prixUpdatedAt: { '1': 9_000, '2': 7_001 },
    }
    expect(cacheClientDoitEtreRafraichi(cacheComplet, [1, 2], 5_000, 12_000)).toBe(false)
    expect(cacheClientDoitEtreRafraichi(cacheComplet, [1, 2], 4_000, 12_000)).toBe(true)
    expect(cacheClientDoitEtreRafraichi(cacheComplet, [1, 3], 5_000, 12_000)).toBe(true)
  })

  it('détecte un cache global absent ou trop ancien', () => {
    expect(cacheEstAncien(null, 5_000, 12_000)).toBe(true)
    expect(cacheEstAncien(8_000, 5_000, 12_000)).toBe(false)
    expect(cacheEstAncien(7_000, 5_000, 12_000)).toBe(true)
  })
})

describe('remises client + segment', () => {
  it('garde la remise commande du client quand une remise segment existe aussi', () => {
    const client = allegerClient(
      {
        idClient: 246,
        remise: '12%',
        type: { idClientType: 2, libelle: 'type test' },
      },
      [
        { idClientType: 1, libelle: 'client PRO', remise: '11%' },
        { idClientType: 2, libelle: 'type test', idParent: 1, remise: '11%' },
      ],
    )

    expect(client.remise).toBe('12%')
  })

  it('utilise la remise commande du segment si le client n’a pas de remise propre', () => {
    const client = allegerClient(
      {
        idClient: 246,
        type: { idClientType: 2, libelle: 'type test' },
      },
      [
        { idClientType: 2, libelle: 'type test', remise: '11%' },
      ],
    )

    expect(client.remise).toBe('11%')
  })

  it('combine les remises produit du client et du segment', () => {
    const client = allegerClient(
      {
        idClient: 246,
        type: { idClientType: 2, libelle: 'type test' },
        listeRemises: [
          { idProduit: 10, idContenant: 20, idLot: 30, quantite: 2, remise: '10%' },
        ],
      },
      [
        {
          idClientType: 2,
          libelle: 'type test',
          listeRemises: [
            { idProduit: 10, idContenant: 20, idLot: 30, quantite: 10, remise: '20%' },
          ],
        },
      ],
    )

    expect(client.remisesCiblees.map((remise) => remise.remise)).toEqual(['10%', '20%'])
    // La PORTÉE est conservée (client d'abord, segment ensuite) — c'est elle qui
    // permet à l'application de faire primer la remise produit CLIENT sur SEGMENT.
    expect(client.remisesCiblees.map((remise) => remise.scope)).toEqual(['client', 'segment'])
  })
})
