import { describe, expect, it } from 'vitest'
import { resoudreGrilleRacine, type ModeleClientType } from '../src/easybeer.js'

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
