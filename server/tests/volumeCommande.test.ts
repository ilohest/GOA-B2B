import { describe, expect, it } from 'vitest'
import { contenanceLitres, litresParArticle } from '../src/volumeCommande.js'

describe('volume des commandes', () => {
  it('convertit les contenances usuelles en litres', () => {
    expect(contenanceLitres('Bouteille - 0.35L')).toBe(0.35)
    expect(contenanceLitres('Bouteille - 33cl')).toBe(0.33)
    expect(contenanceLitres('Fût - 20L')).toBe(20)
  })

  it('tient compte du nombre de contenants dans le packaging', () => {
    expect(litresParArticle('Bouteille - 0.35L', 12, 'Carton de 12')).toBeCloseTo(4.2)
    expect(litresParArticle('Bouteille - 1L', null, 'Carton de 6')).toBe(6)
    expect(litresParArticle('Fût - 20L', null, 'Unité')).toBe(20)
  })
})
