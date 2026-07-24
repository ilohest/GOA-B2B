/**
 * Emails d'authentification GOA (connexion sans mot de passe + réinitialisation
 * de mot de passe). Même charte que l'email d'invitation — le lien est généré
 * côté serveur par l'Admin SDK Firebase, ces fonctions ne font que le mettre en
 * forme. Le branchement SMTP (server/src/email.ts) n'a qu'à envoyer le résultat.
 */

const VERT = '#1f7a39'
const VERT_FONCE = '#175c2b'
const TEXTE = '#1c1917'
const GRIS = '#78716c'
const FOND = '#f0faf2'

export interface AuthLinkEmailInput {
  /** Lien d'authentification généré par l'Admin SDK (à usage unique). */
  lien: string
  /** URL absolue du logo GOA (PNG, compatible email). Optionnel. */
  logoUrl?: string
}

interface RenduAuthEmail {
  subject: string
  titre: string
  intro: string
  boutonLabel: string
  lien: string
  note: string
  logoUrl?: string
}

function renderAuthEmail({
  subject,
  titre,
  intro,
  boutonLabel,
  lien,
  note,
  logoUrl,
}: RenduAuthEmail): { subject: string; html: string; text: string } {
  const entete = logoUrl
    ? `<img src="${logoUrl}" alt="GOA Kombucha" width="120" style="display:block;margin:0 auto;height:auto;" />`
    : `<span style="font-family:Georgia,serif;font-size:26px;font-weight:700;letter-spacing:1px;color:${VERT};">GOA <span style="font-weight:400;">KOMBUCHA</span></span>`

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
          <h1 style="margin:16px 0 8px;font-size:20px;font-weight:600;">${escapeHtml(titre)}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${TEXTE};">${escapeHtml(intro)}</p>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:10px;background:${VERT};">
              <a href="${lien}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                ${escapeHtml(boutonLabel)}
              </a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:0 32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          <p style="margin:0 0 20px;font-size:13px;color:${GRIS};">${escapeHtml(note)}</p>
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

  const text = [`${titre}`, ``, intro, ``, `${boutonLabel} :`, lien, ``, note, ``, `La Brasserie de GOA — Kombucha artisanal`].join('\n')

  return { subject, html, text }
}

/** Email « lien de connexion » (connexion sans mot de passe). */
export function renderLoginLinkEmail(input: AuthLinkEmailInput) {
  return renderAuthEmail({
    subject: 'Votre lien de connexion GOA',
    titre: 'Votre lien de connexion',
    intro:
      'Connectez-vous à votre espace de commande GOA en un clic, sans mot de passe, grâce au bouton ci-dessous.',
    boutonLabel: 'Me connecter',
    lien: input.lien,
    note: "Ce lien est personnel et à usage unique. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.",
    logoUrl: input.logoUrl,
  })
}

/** Email « réinitialisation de mot de passe ». */
export function renderResetPasswordEmail(input: AuthLinkEmailInput) {
  return renderAuthEmail({
    subject: 'Réinitialisation de votre mot de passe GOA',
    titre: 'Réinitialiser votre mot de passe',
    intro:
      'Vous avez demandé à réinitialiser le mot de passe de votre espace GOA. Choisissez-en un nouveau via le bouton ci-dessous.',
    boutonLabel: 'Choisir un nouveau mot de passe',
    lien: input.lien,
    note: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe restera inchangé.",
    logoUrl: input.logoUrl,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
