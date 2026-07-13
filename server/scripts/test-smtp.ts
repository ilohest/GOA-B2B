/**
 * Test manuel du SMTP : vérifie la connexion puis envoie un exemple de
 * l'email d'invitation. Usage : `npx tsx scripts/test-smtp.ts [destinataire]`.
 */
import { verifierSmtp, envoyerInvitationEmail } from '../src/email.js'

const destinataire = process.argv[2] ?? 'isaure.lohest@gmail.com'

async function main() {
  console.log('[test-smtp] vérification de la connexion SMTP…')
  await verifierSmtp()
  console.log('[test-smtp] ✅ connexion + auth OK')

  console.log(`[test-smtp] envoi d'un exemple d'invitation à ${destinataire}…`)
  await envoyerInvitationEmail({
    nom: 'Le Bar à Bulles',
    email: destinataire,
    lien: 'https://commandes.goa-kombucha.fr/activer?token=EXEMPLE-DE-LIEN-SECURISE',
  })
  console.log('[test-smtp] ✅ email envoyé')
}

main().catch((e) => {
  console.error('[test-smtp] ❌ échec :', e)
  process.exit(1)
})
