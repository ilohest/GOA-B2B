import { describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { renderInvitationEmail } from '../src/emails/invitation.js'
import { lireInvitation } from '../src/invitations.js'

function firestoreAvecInvitation(data: Record<string, unknown>): Firestore {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => data }),
      }),
    }),
  } as unknown as Firestore
}

describe('invitations sans email imposé', () => {
  it("ne révèle pas l'ancienne adresse d'une invitation encore valide", async () => {
    const resultat = await lireInvitation(
      firestoreAvecInvitation({
        email: 'contact-easybeer@example.com',
        expiresAt: Date.now() + 60_000,
        usedAt: null,
        revoked: false,
        nom: 'Le Bar',
      }),
      'token',
    )

    expect(resultat).toEqual({ etat: 'valide', nom: 'Le Bar' })
    expect(resultat).not.toHaveProperty('email')
  })

  it("présente l'adresse destinataire comme un simple canal de livraison", () => {
    const email = renderInvitationEmail({
      nom: 'Le Bar',
      email: 'contact-easybeer@example.com',
      lien: 'https://commande.example.com/activer?token=secret',
    })

    expect(email.html).not.toContain('contact-easybeer@example.com')
    expect(email.text).not.toContain('contact-easybeer@example.com')
    expect(email.text).toContain('choisissez librement votre adresse de connexion')
  })
})
