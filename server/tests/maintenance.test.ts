import { describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { determinerCachesAActualiser, type EtatCachesPartages } from '../src/maintenance.js'

const maintenant = Date.UTC(2026, 6, 27, 12, 0, 0)

function etatFrais(): EtatCachesPartages {
  return {
    clientsAt: maintenant - (config.cache.clientsRefreshAgeMinutes - 1) * 60_000,
    commandesAt: maintenant - (config.cache.commandesRefreshAgeMinutes - 1) * 60_000,
    catalogueAt: maintenant - (config.cache.catalogueRefreshAgeMinutes - 1) * 60_000,
    referentielsAt: maintenant - (config.cache.catalogueRefreshAgeMinutes - 1) * 60_000,
    grilleAt: maintenant - (config.cache.catalogueRefreshAgeMinutes - 1) * 60_000,
  }
}

describe('maintenance conditionnelle des caches', () => {
  it('ne demande aucun appel Easybeer lorsque tous les caches sont frais', () => {
    expect(determinerCachesAActualiser(etatFrais(), maintenant)).toEqual({
      clients: false,
      commandes: false,
      catalogue: false,
    })
  })

  it('ne cible que les familles expirées', () => {
    const etat = etatFrais()
    etat.commandesAt = maintenant - (config.cache.commandesRefreshAgeMinutes + 1) * 60_000
    etat.grilleAt = maintenant - (config.cache.catalogueRefreshAgeMinutes + 1) * 60_000
    expect(determinerCachesAActualiser(etat, maintenant)).toEqual({
      clients: false,
      commandes: true,
      catalogue: true,
    })
  })

  it('répare un cache absent', () => {
    const etat = etatFrais()
    etat.clientsAt = null
    expect(determinerCachesAActualiser(etat, maintenant).clients).toBe(true)
  })
})
