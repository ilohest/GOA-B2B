import { describe, expect, it } from 'vitest'
import { creerZip } from '../src/zip.js'

describe('création des archives ZIP de factures', () => {
  it('écrit les fichiers et le répertoire central dans une archive standard', () => {
    const zip = creerZip([
      { nom: 'Facture FA0001.pdf', contenu: new TextEncoder().encode('%PDF-premiere') },
      { nom: 'Facture été.pdf', contenu: new TextEncoder().encode('%PDF-seconde') },
    ])

    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.includes(Buffer.from('Facture FA0001.pdf'))).toBe(true)
    expect(zip.includes(Buffer.from('Facture été.pdf'))).toBe(true)
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50)
    expect(zip.readUInt16LE(zip.length - 12)).toBe(2)
  })

  it('produit aussi une archive vide valide', () => {
    const zip = creerZip([])
    expect(zip.length).toBe(22)
    expect(zip.readUInt32LE(0)).toBe(0x06054b50)
  })
})
