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
  status?: 'invited' | 'active' | 'revoked'
  easybeerIdClient?: number
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
  }
}

async function resolveUser(uid: string, email?: string): Promise<AuthUser> {
  const db = getDb()
  if (!db) return { uid, email, role: 'client' }
  const snap = await db.collection('users').doc(uid).get()
  const data = snap.data() ?? {}
  return {
    uid,
    email: email ?? (data.email as string | undefined),
    role: (data.role as 'client' | 'admin') ?? 'client',
    status: data.status as 'invited' | 'active' | 'revoked' | undefined,
    easybeerIdClient: data.easybeerIdClient as number | undefined,
  }
}

export async function requireAuth(c: Context, next: Next) {
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
    if (user.status === 'revoked') return c.json({ error: 'Ce compte a été révoqué' }, 401)
    c.set('user', user)
    return next()
  } catch {
    return c.json({ error: 'Token invalide' }, 401)
  }
}

export async function requireAdmin(c: Context, next: Next) {
  const user = c.get('user')
  if (user.role !== 'admin') return c.json({ error: 'Réservé aux administrateurs' }, 403)
  return next()
}
