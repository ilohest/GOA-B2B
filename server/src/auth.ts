/**
 * Middleware d'authentification.
 *
 * - Prod : vérifie l'ID token Firebase (header Authorization: Bearer <token>),
 *   puis résout le mapping users/{uid} -> easybeerIdClient dans Firestore.
 * - Dev (AUTH_DISABLED=true) : injecte un utilisateur de test lié à
 *   DEV_EASYBEER_ID_CLIENT, sans Firebase. NE JAMAIS activer en prod.
 */
import type { Context, Next } from 'hono'
import { config } from './config.js'
import { verifyIdToken } from './firebase.js'
import { getDb } from './firebase.js'

export interface AuthUser {
  uid: string
  email?: string
  role: 'client' | 'admin'
  status?: 'invited' | 'active' | 'revoked' | 'source_deleted'
  easybeerIdClient?: number
}

export interface ProfilPlateforme {
  role?: 'client' | 'admin'
  status?: 'invited' | 'active' | 'revoked' | 'source_deleted'
  easybeerIdClient?: number | null
}

/** Un compte Firebase seul ne constitue jamais une autorisation plateforme. */
export function comptePlateformeAutorise(profil: ProfilPlateforme | null | undefined): boolean {
  if (!profil || profil.status === 'revoked' || profil.status === 'source_deleted') return false
  if (profil.role === 'admin') return true
  return (
    profil.role === 'client' &&
    typeof profil.easybeerIdClient === 'number' &&
    Number.isFinite(profil.easybeerIdClient) &&
    profil.easybeerIdClient > 0
  )
}

export function comptePlateformePresentDansEasybeer(
  profil: ProfilPlateforme | null | undefined,
  clients: Array<{ idClient?: number | null }> | null | undefined,
): boolean {
  if (!comptePlateformeAutorise(profil)) return false
  if (profil?.role === 'admin') return true
  return clients?.some((client) => client.idClient === profil?.easybeerIdClient) === true
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
  }
}

async function resolveUser(uid: string, email?: string): Promise<AuthUser | null> {
  const db = getDb()
  if (!db) return null
  const snap = await db.collection('users').doc(uid).get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  const profil = data as ProfilPlateforme
  if (!comptePlateformeAutorise(profil)) return null
  if (profil.role !== 'admin') {
    const clientsSnap = await db.doc('cache/clientsListe').get()
    const clients = clientsSnap.data()?.clients as Array<{ idClient?: number | null }> | undefined
    if (!comptePlateformePresentDansEasybeer(profil, clients)) return null
  }
  return {
    uid,
    email: email ?? (data.email as string | undefined),
    role: (data.role as 'client' | 'admin') ?? 'client',
    status: data.status as 'invited' | 'active' | 'revoked' | 'source_deleted' | undefined,
    easybeerIdClient: data.easybeerIdClient as number | undefined,
  }
}

async function authentifier(c: Context, next: Next, autoriserIdentiteSeule: boolean) {
  if (config.authDisabled) {
    c.set('user', {
      uid: 'dev-user',
      email: 'dev@goa.local',
      role: 'admin',
      easybeerIdClient: config.devEasybeerIdClient,
    })
    return next()
  }

  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return c.json({ error: 'Non authentifié' }, 401)

  try {
    const decoded = await verifyIdToken(token)
    const user = await resolveUser(decoded.uid, decoded.email)
    if (!user && !autoriserIdentiteSeule) {
      return c.json({ error: 'Compte non autorisé' }, 403)
    }
    c.set('user', user ?? { uid: decoded.uid, email: decoded.email, role: 'client' })
    return next()
  } catch {
    return c.json({ error: 'Token invalide' }, 401)
  }
}

/** Authentification + compte GOA autorisé pour toutes les routes applicatives. */
export async function requireAuth(c: Context, next: Next) {
  return authentifier(c, next, false)
}

/**
 * Identité Firebase suffisante uniquement pendant l'activation : l'invitation
 * valide associera ensuite cette identité à un véritable compte GOA.
 */
export async function requireFirebaseIdentity(c: Context, next: Next) {
  return authentifier(c, next, true)
}

export async function requireAdmin(c: Context, next: Next) {
  const user = c.get('user')
  if (user.role !== 'admin') return c.json({ error: 'Réservé aux administrateurs' }, 403)
  return next()
}
