/**
 * Envoi d'emails via SMTP (OVH en prod). Transport nodemailer paresseux :
 * sans SMTP_HOST configuré, `emailActif()` est false et l'appelant retombe sur
 * le lien d'invitation copiable (dev / SMTP non branché).
 */
import nodemailer, { type Transporter } from 'nodemailer'
import { config } from './config.js'
import { renderInvitationEmail, type InvitationEmailInput } from './emails/invitation.js'
import { renderLoginLinkEmail, renderResetPasswordEmail } from './emails/authLink.js'

let transporter: Transporter | null = null
let tried = false

/** true si un serveur SMTP est configuré (sinon : pas d'envoi, lien copiable). */
export function emailActif(): boolean {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass)
}

function getTransporter(): Transporter | null {
  if (tried) return transporter
  tried = true
  if (!emailActif()) {
    console.warn('[email] SMTP non configuré (SMTP_HOST/USER/PASS) — envoi désactivé, lien copiable.')
    return null
  }
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user!, pass: config.smtp.pass! },
  })
  return transporter
}

/** Vérifie la connexion SMTP (handshake + auth), sans envoyer d'email. */
export async function verifierSmtp(): Promise<void> {
  const t = getTransporter()
  if (!t) throw new Error('SMTP non configuré')
  await t.verify()
}

interface MailInput {
  to: string
  subject: string
  html: string
  text: string
}

/** Envoi générique. Lève si SMTP indisponible ou refus du serveur. */
export async function envoyerEmail({ to, subject, html, text }: MailInput): Promise<void> {
  const t = getTransporter()
  if (!t) throw new Error('SMTP non configuré')
  await t.sendMail({
    from: config.smtp.from,
    replyTo: config.smtp.replyTo,
    to,
    subject,
    html,
    text,
  })
}

/** Rend + envoie l'email d'invitation « créez votre mot de passe ». */
export async function envoyerInvitationEmail(
  input: Omit<InvitationEmailInput, 'logoUrl' | 'expiresInDays'> & { expiresInDays?: number },
): Promise<void> {
  const { subject, html, text } = renderInvitationEmail({
    ...input,
    expiresInDays: input.expiresInDays ?? config.invite.expiresInDays,
    logoUrl: config.invite.logoUrl,
  })
  await envoyerEmail({ to: input.email, subject, html, text })
}

/** Rend + envoie l'email « lien de connexion » (connexion sans mot de passe). */
export async function envoyerLoginLinkEmail(email: string, lien: string): Promise<void> {
  const { subject, html, text } = renderLoginLinkEmail({ lien, logoUrl: config.invite.logoUrl })
  await envoyerEmail({ to: email, subject, html, text })
}

/** Rend + envoie l'email « réinitialisation de mot de passe ». */
export async function envoyerResetPasswordEmail(email: string, lien: string): Promise<void> {
  const { subject, html, text } = renderResetPasswordEmail({ lien, logoUrl: config.invite.logoUrl })
  await envoyerEmail({ to: email, subject, html, text })
}
