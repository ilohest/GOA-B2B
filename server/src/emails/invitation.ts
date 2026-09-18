/**
 * Template de l'email d'activation de compte envoyé aux
 * clients pros de GOA (remplace la copie manuelle du lien). HTML compatible
 * emails (tables + styles inline), accent émeraude de la charte GOA.
 *
 * `renderInvitationEmail` renvoie { subject, html, text } — le branchement SMTP
 * (server/src/email.ts) n'a qu'à l'envoyer.
 *
 * Le message ne nomme pas le client : le texte validé par GOA s'ouvre sur un
 * « Bonjour, » neutre, ce qui évite d'afficher un nom Easybeer parfois cryptique
 * (raison sociale tronquée, « TEST », etc.).
 */

export interface InvitationEmailInput {
  /** Lien sécurisé vers /activer (token d'invitation). */
  lien: string
  /** Email utilisé uniquement pour la livraison du message. */
  email: string
  /** Durée de validité du lien, en jours (défaut 14). */
  expiresInDays?: number
  /** URL absolue du logo GOA (PNG, compatible email). Optionnel. */
  logoUrl?: string
}

const VERT = '#1f7a39'
const VERT_FONCE = '#175c2b'
const TEXTE = '#1c1917'
const GRIS = '#78716c'
const FOND = '#f0faf2'

/** Bénéfices listés dans le corps du message (ordre validé par GOA). */
const AVANTAGES = [
  'Un espace personnel et sécurisé',
  'Une interface simple et intuitive',
  'Vos documents et votre historique de commandes regroupés au même endroit',
  'Le suivi de l’état de vos commandes en temps réel',
  'La possibilité de modifier votre commande à tout moment',
]

export function renderInvitationEmail(input: InvitationEmailInput): {
  subject: string
  html: string
  text: string
} {
  const { lien, expiresInDays = 14, logoUrl } = input
  const subject = 'Votre nouvelle plateforme de commande GOA'

  const entete = logoUrl
    ? `<img src="${logoUrl}" alt="GOA Kombucha" width="120" style="display:block;margin:0 auto;height:auto;" />`
    : `<span style="font-family:Georgia,serif;font-size:26px;font-weight:700;letter-spacing:1px;color:${VERT};">GOA <span style="font-weight:400;">KOMBUCHA</span></span>`

  // Liste en table plutôt qu'en <ul> : Outlook (moteur Word) écrase les
  // marges des listes, les puces se retrouvent décalées ou collées au texte.
  const avantages = AVANTAGES.map(
    (a) => `<tr>
              <td valign="top" style="width:16px;padding:0 0 8px;font-size:15px;line-height:1.6;color:${VERT};">&bull;</td>
              <td style="padding:0 0 8px;font-size:15px;line-height:1.6;color:${TEXTE};">${a}</td>
            </tr>`,
  ).join('\n')

  const html = `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${subject}</title></head>
<body style="margin:0;padding:0;background:${FOND};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FOND};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7e5e4;">
        <tr><td style="background:${VERT};height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>
        <tr><td align="center" style="padding:32px 32px 8px;">${entete}</td></tr>
        <tr><td style="padding:8px 32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXTE};">
          <p style="margin:16px 0 16px;font-size:15px;line-height:1.6;color:${TEXTE};">Bonjour,</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXTE};">
            GOA évolue&nbsp;! Passez désormais vos commandes depuis notre <strong>nouvelle plateforme en ligne</strong>.
          </p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${TEXTE};">
            Ce qui change pour vous&nbsp;:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
${avantages}
          </table>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${TEXTE};">
            Pour activer votre accès, choisissez votre adresse e-mail de connexion, ou identifiez-vous directement avec votre compte Google.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:10px;background:${VERT};">
              <a href="${lien}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                Créer mon compte client
              </a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:0 32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          <p style="margin:0 0 20px;font-size:13px;color:${GRIS};">
            Ce lien est <strong>personnel</strong>, valable <strong>${expiresInDays} jours</strong> et utilisable une seule fois.
            S'il a expiré, demandez-nous un nouveau lien.
          </p>
          <p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:${GRIS};word-break:break-all;">
            Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur&nbsp;:<br />
            <a href="${lien}" style="color:${VERT_FONCE};">${lien}</a>
          </p>
        </td></tr>
        <tr><td style="padding:24px 32px 28px;border-top:1px solid #e7e5e4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          <p style="margin:0;font-size:12px;color:${GRIS};">La Brasserie de GOA — Kombucha artisanal</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    `Bonjour,`,
    ``,
    `GOA évolue ! Passez désormais vos commandes depuis notre nouvelle plateforme en ligne.`,
    ``,
    `Ce qui change pour vous :`,
    ...AVANTAGES.map((a) => `- ${a}`),
    ``,
    `Pour activer votre accès, choisissez votre adresse e-mail de connexion, ou identifiez-vous directement avec votre compte Google, via ce lien :`,
    lien,
    ``,
    `Lien personnel, valable ${expiresInDays} jours, utilisable une seule fois.`,
    ``,
    `La Brasserie de GOA — Kombucha artisanal`,
  ].join('\n')

  return { subject, html, text }
}
