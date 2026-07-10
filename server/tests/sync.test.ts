import { describe, expect, it } from 'vitest'
import { agePrixMs, prixEstFrais, type CacheClientDoc } from '../src/sync.js'

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
})
