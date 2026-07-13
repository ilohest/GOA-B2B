/**
 * Invitations « créez votre mot de passe » — tokens à usage unique stockés
 * dans Firestore (`invitations/{token}`), remplaçant les liens de reset Firebase
 * (expiraient en 1 h, trop court pour un email B2B).
 *
 * Garanties :
 *  - péremption configurable (INVITE_EXPIRES_DAYS, 14 j par défaut) ;
 *  - usage unique (`usedAt`) ;
 *  - un seul lien valide à la fois (les précédents non consommés sont révoqués) ;
 *  - refus si le compte plateforme est déjà ACTIF (→ « Mot de passe oublié »).
 */
import { randomBytes } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import type { Auth } from 'firebase-admin/auth'
import { config } from './config.js'
import { getClient } from './easybeer.js'

const COLL = 'invitations'

export interface InvitationCreee {
  token: string
  lien: string
  email: string
  uid: string
  expiresAt: number
  client: { idClient?: number; nom?: string; numero?: string }
}

export type InvitationEtat = 'valide' | 'introuvable' | 'expire' | 'utilise' | 'revoque'

function nouveauToken(): string {
  return randomBytes(32).toString('hex')
}

function lienInvitation(token: string, email: string): string {
  const base = config.invite.baseUrl
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}token=${token}&email=${encodeURIComponent(email)}`
}

/**
 * Crée (ou réutilise) le compte plateforme sans mot de passe, puis génère un
 * token d'invitation frais. N'ENVOIE PAS l'email (l'appelant s'en charge).
 */
export async function creerInvitation(
  db: Firestore,
  adminAuth: Auth,
  adminUid: string,
  easybeerIdClient: number,
  emailOverride?: string,
): Promise<{ ok: true; invitation: InvitationCreee } | { ok: false; erreur: string; dejaActif?: boolean }> {
  const client = await getClient(easybeerIdClient)
  if (!client) return { ok: false, erreur: `Client Easybeer ${easybeerIdClient} introuvable` }

  const email = (emailOverride ?? client.emailPrincipal ?? '').trim().toLowerCase()
  if (!email) return { ok: false, erreur: `${client.nom ?? easybeerIdClient} : pas d'email dans Easybeer` }

  // Compte Firebase : réutilisé s'il existe, sinon créé sans mot de passe
  // (connexion impossible tant que l'invitation n'est pas consommée).
  const existing = await adminAuth.getUserByEmail(email).catch(() => null)
  const uid = existing?.uid ?? (await adminAuth.createUser({ email })).uid

  const prev = (await db.collection('users').doc(uid).get()).data() ?? {}
  if (prev.status === 'active') {
    return {
      ok: false,
      dejaActif: true,
      erreur: `${email} a déjà un compte actif — il peut utiliser « Mot de passe oublié » pour se reconnecter.`,
    }
  }

  await db.collection('users').doc(uid).set(
    {
      email,
      easybeerIdClient,
      role: prev.role ?? 'client',
      status: 'invited',
      invitedAt: Date.now(),
      invitedBy: adminUid,
    },
    { merge: true },
  )

  // Un seul lien valide : révoquer les tokens précédents non consommés de ce compte.
  const anciens = await db.collection(COLL).where('uid', '==', uid).get()
  const batch = db.batch()
  for (const d of anciens.docs) {
    const data = d.data()
    if (!data.usedAt && !data.revoked) batch.update(d.ref, { revoked: true })
  }

  const token = nouveauToken()
  const now = Date.now()
  const expiresAt = now + config.invite.expiresInDays * 24 * 3600 * 1000
  batch.set(db.collection(COLL).doc(token), {
    token,
    uid,
    easybeerIdClient,
    email,
    nom: client.nom ?? null,
    createdAt: now,
    expiresAt,
    usedAt: null,
    revoked: false,
    invitedBy: adminUid,
  })
  await batch.commit()

  return {
    ok: true,
    invitation: {
      token,
      lien: lienInvitation(token, email),
      email,
      uid,
      expiresAt,
      client: { idClient: client.idClient, nom: client.nom, numero: client.numero },
    },
  }
}

/** Lit l'état d'un token SANS le consommer (page d'activation, au chargement). */
export async function lireInvitation(
  db: Firestore,
  token: string,
): Promise<{ etat: InvitationEtat; email?: string; nom?: string }> {
  const snap = await db.collection(COLL).doc(token).get()
  if (!snap.exists) return { etat: 'introuvable' }
  const d = snap.data()!
  if (d.revoked) return { etat: 'revoque' }
  if (d.usedAt) return { etat: 'utilise' }
  if (Date.now() > (d.expiresAt as number)) return { etat: 'expire' }
  return { etat: 'valide', email: d.email as string, nom: (d.nom as string | null) ?? undefined }
}

/**
 * Consomme un token : pose le mot de passe (Admin SDK), marque le token utilisé
 * et active le compte. Idempotence : un token déjà consommé/expiré est refusé.
 */
export async function consommerInvitation(
  db: Firestore,
  adminAuth: Auth,
  token: string,
  password: string,
): Promise<{ ok: true; email: string } | { ok: false; etat: InvitationEtat; erreur: string }> {
  const ref = db.collection(COLL).doc(token)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, etat: 'introuvable', erreur: 'Lien invalide' }
  const d = snap.data()!
  if (d.revoked) return { ok: false, etat: 'revoque', erreur: 'Ce lien a été remplacé par un plus récent' }
  if (d.usedAt) return { ok: false, etat: 'utilise', erreur: 'Ce lien a déjà été utilisé' }
  if (Date.now() > (d.expiresAt as number)) return { ok: false, etat: 'expire', erreur: 'Ce lien a expiré' }

  await adminAuth.updateUser(d.uid as string, { password })
  await ref.update({ usedAt: Date.now() })
  await db.collection('users').doc(d.uid as string).set({ status: 'active', activatedAt: Date.now() }, { merge: true })
  return { ok: true, email: d.email as string }
}
