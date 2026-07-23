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
  email: string | null
  uid: string | null
  expiresAt: number
  client: { idClient?: number; nom?: string; numero?: string }
}

export type InvitationEtat = 'valide' | 'introuvable' | 'expire' | 'utilise' | 'revoque'

export interface InvitationAdminResume {
  etat: Exclude<InvitationEtat, 'introuvable'>
  lien: string
  email: string | null
  createdAt: number | null
  expiresAt: number
  usedAt: number | null
}

function nouveauToken(): string {
  return randomBytes(32).toString('hex')
}

function lienInvitation(token: string): string {
  const base = config.invite.baseUrl
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}token=${token}`
}

function etatInvitation(d: Record<string, unknown>): InvitationAdminResume['etat'] {
  if (d.revoked) return 'revoque'
  if (d.usedAt) return 'utilise'
  if (Date.now() > Number(d.expiresAt)) return 'expire'
  return 'valide'
}

/** Dernier lien d'invitation d'un client, destiné à sa fiche admin. */
export async function derniereInvitationClient(
  db: Firestore,
  easybeerIdClient: number,
): Promise<InvitationAdminResume | null> {
  const snap = await db.collection(COLL).where('easybeerIdClient', '==', easybeerIdClient).get()
  const doc = [...snap.docs].sort(
    (a, b) => Number(b.data().createdAt ?? 0) - Number(a.data().createdAt ?? 0),
  )[0]
  if (!doc) return null
  const d = doc.data()
  const email = String(d.emailDestinataire ?? d.email ?? '').trim().toLowerCase() || null
  return {
    etat: etatInvitation(d),
    lien: lienInvitation(doc.id),
    email,
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : null,
    expiresAt: Number(d.expiresAt),
    usedAt: typeof d.usedAt === 'number' ? d.usedAt : null,
  }
}

/**
 * Génère un token d'invitation sans le rattacher à une identité. L'adresse
 * Easybeer sert uniquement à livrer l'email : le client choisit toujours son
 * identifiant au moment de l'activation.
 */
export async function creerInvitation(
  db: Firestore,
  adminUid: string,
  easybeerIdClient: number,
  emailOverride?: string,
  autoriserSansEmail = false,
): Promise<
  | { ok: true; invitation: InvitationCreee }
  | { ok: false; erreur: string; dejaActif?: boolean; compteExistant?: boolean }
> {
  const client = await getClient(easybeerIdClient)
  if (!client) return { ok: false, erreur: `Client Easybeer ${easybeerIdClient} introuvable` }

  const emailDestinataire = (emailOverride ?? client.emailPrincipal ?? '').trim().toLowerCase() || null
  if (!emailDestinataire && !autoriserSansEmail) {
    return { ok: false, erreur: `${client.nom ?? easybeerIdClient} : pas d'email dans Easybeer` }
  }

  const comptes = await db.collection('users').where('easybeerIdClient', '==', easybeerIdClient).get()
  if (comptes.docs.some((doc) => doc.data().status === 'active')) {
    return {
      ok: false,
      dejaActif: true,
      compteExistant: true,
      erreur: 'Ce client possède déjà un compte actif.',
    }
  }
  if (comptes.docs.some((doc) => doc.data().status === 'revoked')) {
    return {
      ok: false,
      compteExistant: true,
      erreur: 'Ce client possède un compte révoqué — réactivez-le depuis sa fiche.',
    }
  }

  // Réutiliser le lien courant tant qu'il reste valable : copier le lien après
  // un envoi par email ne doit jamais invalider celui que le client a reçu.
  const anciens = await db.collection(COLL).where('easybeerIdClient', '==', easybeerIdClient).get()
  const invitationValide = [...anciens.docs]
    .filter(
      (d) =>
        etatInvitation(d.data()) === 'valide' &&
        (d.data().choixEmail === true || !d.data().uid),
    )
    .sort((a, b) => Number(b.data().createdAt ?? 0) - Number(a.data().createdAt ?? 0))[0]
  if (invitationValide) {
    const d = invitationValide.data()
    return {
      ok: true,
      invitation: {
        token: invitationValide.id,
        lien: lienInvitation(invitationValide.id),
        email: emailDestinataire,
        uid: null,
        expiresAt: Number(d.expiresAt),
        client: { idClient: client.idClient, nom: client.nom, numero: client.numero },
      },
    }
  }

  // Un seul nouveau lien valide : révoquer les précédents non consommés.
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
    uid: null,
    easybeerIdClient,
    email: null,
    emailDestinataire,
    choixEmail: true,
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
      lien: lienInvitation(token),
      email: emailDestinataire,
      uid: null,
      expiresAt,
      client: { idClient: client.idClient, nom: client.nom, numero: client.numero },
    },
  }
}

/** Lit l'état d'un token SANS le consommer (page d'activation, au chargement). */
export async function lireInvitation(
  db: Firestore,
  token: string,
): Promise<{ etat: InvitationEtat; nom?: string }> {
  const snap = await db.collection(COLL).doc(token).get()
  if (!snap.exists) return { etat: 'introuvable' }
  const d = snap.data()!
  if (d.revoked) return { etat: 'revoque' }
  if (d.usedAt) return { etat: 'utilise' }
  if (Date.now() > (d.expiresAt as number)) return { etat: 'expire' }
  return { etat: 'valide', nom: (d.nom as string | null) ?? undefined }
}

/**
 * Consomme un token : crée au besoin le compte, pose son mot de passe, marque
 * le token utilisé et active l'accès. Un token consommé ou expiré est refusé.
 */
export async function consommerInvitation(
  db: Firestore,
  adminAuth: Auth,
  token: string,
  password: string,
  emailSaisi?: string,
): Promise<
  | { ok: true; email: string; easybeerIdClient: number | null }
  | { ok: false; etat: InvitationEtat; erreur: string }
> {
  const ref = db.collection(COLL).doc(token)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, etat: 'introuvable', erreur: 'Lien invalide' }
  const d = snap.data()!
  if (d.revoked) return { ok: false, etat: 'revoque', erreur: 'Ce lien a été remplacé par un plus récent' }
  if (d.usedAt) return { ok: false, etat: 'utilise', erreur: 'Ce lien a déjà été utilisé' }
  if (Date.now() > (d.expiresAt as number)) return { ok: false, etat: 'expire', erreur: 'Ce lien a expiré' }

  const email = (emailSaisi ?? '').trim().toLowerCase()
  if (!email) {
    return { ok: false, etat: 'introuvable', erreur: 'Renseignez une adresse email pour créer votre compte' }
  }

  const ancienUid = typeof d.uid === 'string' && d.uid ? d.uid : null
  const existing = await adminAuth.getUserByEmail(email).catch(() => null)
  if (existing && existing.uid !== ancienUid) {
    return {
      ok: false,
      etat: 'introuvable',
      erreur: 'Cette adresse possède déjà un compte. Utilisez Google ou choisissez une autre adresse.',
    }
  }

  let uid = existing?.uid ?? null
  let compteCree = false
  if (uid) {
    await adminAuth.updateUser(uid, { password })
  } else {
    uid = (await adminAuth.createUser({ email, password })).uid
    compteCree = true
  }

  const now = Date.now()
  try {
    await db.runTransaction(async (transaction) => {
      const invitation = await transaction.get(ref)
      const actuelle = invitation.data()
      if (!invitation.exists || !actuelle || actuelle.revoked || actuelle.usedAt || Date.now() > Number(actuelle.expiresAt)) {
        throw new Error('INVITATION_DEJA_CONSOMMEE')
      }
      const ancienCompteRef = ancienUid && ancienUid !== uid ? db.collection('users').doc(ancienUid) : null
      const ancienCompte = ancienCompteRef ? await transaction.get(ancienCompteRef) : null
      transaction.update(ref, { usedAt: now, uid, email })
      transaction.set(
        db.collection('users').doc(uid!),
        {
          email,
          easybeerIdClient: (d.easybeerIdClient as number | undefined) ?? null,
          role: 'client',
          status: 'active',
          activatedAt: now,
        },
        { merge: true },
      )
      if (
        ancienCompteRef &&
        ancienCompte?.data()?.status === 'invited' &&
        ancienCompte.data()?.easybeerIdClient === d.easybeerIdClient
      ) {
        transaction.delete(ancienCompteRef)
      }
    })
  } catch (e) {
    if (compteCree) await adminAuth.deleteUser(uid).catch(() => undefined)
    if ((e as Error).message === 'INVITATION_DEJA_CONSOMMEE') {
      return { ok: false, etat: 'utilise', erreur: 'Ce lien a déjà été utilisé' }
    }
    throw e
  }
  return { ok: true, email, easybeerIdClient: (d.easybeerIdClient as number | undefined) ?? null }
}

/**
 * Active une invitation après une authentification fédérée (Google).
 * Le détenteur du lien choisit librement son compte Google à l'activation.
 */
export async function consommerInvitationAvecFournisseur(
  db: Firestore,
  token: string,
  uid: string,
  email?: string,
): Promise<
  | { ok: true; email: string; easybeerIdClient: number | null }
  | { ok: false; etat: InvitationEtat; erreur: string }
> {
  const ref = db.collection(COLL).doc(token)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, etat: 'introuvable', erreur: 'Lien invalide' }
  const d = snap.data()!
  if (d.revoked) return { ok: false, etat: 'revoque', erreur: 'Ce lien a été remplacé par un plus récent' }
  if (d.usedAt) return { ok: false, etat: 'utilise', erreur: 'Ce lien a déjà été utilisé' }
  if (Date.now() > (d.expiresAt as number)) return { ok: false, etat: 'expire', erreur: 'Ce lien a expiré' }

  const emailCompte = (email ?? '').trim().toLowerCase()
  if (!emailCompte) {
    return { ok: false, etat: 'introuvable', erreur: 'Ce compte Google ne fournit aucune adresse email' }
  }

  const compteRef = db.collection('users').doc(uid)
  const compte = (await compteRef.get()).data()
  const easybeerIdClient = (d.easybeerIdClient as number | undefined) ?? null
  if (compte?.role === 'admin' || (compte?.easybeerIdClient != null && compte.easybeerIdClient !== easybeerIdClient)) {
    return { ok: false, etat: 'introuvable', erreur: 'Ce compte est déjà associé à un autre accès' }
  }

  const now = Date.now()
  const ancienUid = typeof d.uid === 'string' && d.uid ? d.uid : null
  await db.runTransaction(async (transaction) => {
    const invitation = await transaction.get(ref)
    const actuelle = invitation.data()
    if (!invitation.exists || !actuelle || actuelle.revoked || actuelle.usedAt || Date.now() > Number(actuelle.expiresAt)) {
      throw new Error('Cette invitation n’est plus valide')
    }
    const ancienCompteRef = ancienUid && ancienUid !== uid ? db.collection('users').doc(ancienUid) : null
    const ancienCompte = ancienCompteRef ? await transaction.get(ancienCompteRef) : null
    transaction.update(ref, { usedAt: now, uid, email: emailCompte, activationProvider: 'google.com' })
    transaction.set(
      compteRef,
      { email: emailCompte, easybeerIdClient, role: 'client', status: 'active', activatedAt: now },
      { merge: true },
    )
    if (
      ancienCompteRef &&
      ancienCompte?.data()?.status === 'invited' &&
      ancienCompte.data()?.easybeerIdClient === d.easybeerIdClient
    ) {
      transaction.delete(ancienCompteRef)
    }
  })
  return {
    ok: true,
    email: emailCompte,
    easybeerIdClient,
  }
}
