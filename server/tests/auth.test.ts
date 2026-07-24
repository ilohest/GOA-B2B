import { describe, expect, it } from 'vitest'
import { comptePlateformeAutorise, comptePlateformePresentDansEasybeer } from '../src/auth.js'

describe('autorisation des comptes plateforme', () => {
  it('autorise les clients réellement liés à Easybeer', () => {
    expect(comptePlateformeAutorise({ role: 'client', status: 'active', easybeerIdClient: 588074 })).toBe(true)
    expect(comptePlateformeAutorise({ role: 'client', status: 'invited', easybeerIdClient: 588074 })).toBe(true)
  })

  it('autorise les administrateurs sans liaison client', () => {
    expect(comptePlateformeAutorise({ role: 'admin', status: 'active' })).toBe(true)
  })

  it('refuse les identités Firebase orphelines et les comptes révoqués', () => {
    expect(comptePlateformeAutorise(undefined)).toBe(false)
    expect(comptePlateformeAutorise({ role: 'client', status: 'active' })).toBe(false)
    expect(comptePlateformeAutorise({ role: 'client', status: 'revoked', easybeerIdClient: 588074 })).toBe(false)
    expect(comptePlateformeAutorise({ role: 'client', status: 'source_deleted', easybeerIdClient: 588074 })).toBe(false)
    expect(comptePlateformeAutorise({ role: 'admin', status: 'revoked' })).toBe(false)
  })

  it('refuse un ancien client supprimé de la liste Easybeer', () => {
    const profil = { role: 'client' as const, status: 'active' as const, easybeerIdClient: 827557 }
    expect(comptePlateformePresentDansEasybeer(profil, [{ idClient: 588074 }])).toBe(false)
    expect(comptePlateformePresentDansEasybeer(profil, [{ idClient: 827557 }])).toBe(true)
  })

  it('ne fait pas dépendre un administrateur de la liste des clients Easybeer', () => {
    expect(comptePlateformePresentDansEasybeer({ role: 'admin', status: 'active' }, [])).toBe(true)
  })
})
