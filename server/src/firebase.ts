/**
 * Initialisation Firebase Admin (paresseuse).
 *
 * Si aucune clé de service n'est configurée (dev), l'app n'est pas initialisée
 * et `getDb()` renvoie null : les endpoints dépendant de Firestore le signalent
 * proprement au lieu de planter au démarrage.
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert, type App } from 'firebase-admin/app'
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { config } from './config.js'

let app: App | null = null
let initTried = false

function ensureApp(): App | null {
  if (initTried) return app
  initTried = true
  const path = config.firebase.credentialsPath
  if (!path) {
    console.warn('[firebase] Aucune clé de service (GOOGLE_APPLICATION_CREDENTIALS) — Firestore désactivé.')
    return null
  }
  try {
    const serviceAccount = JSON.parse(readFileSync(path, 'utf8'))
    app = initializeApp({ credential: cert(serviceAccount), projectId: config.firebase.projectId })
    console.log('[firebase] Admin initialisé.')
  } catch (e) {
    console.error('[firebase] Échec init Admin :', (e as Error).message)
    app = null
  }
  return app
}

export function getDb(): Firestore | null {
  const a = ensureApp()
  return a ? getFirestore(a) : null
}

export async function verifyIdToken(idToken: string): Promise<DecodedIdToken> {
  const a = ensureApp()
  if (!a) throw new Error('Firebase Admin non configuré')
  return getAuth(a).verifyIdToken(idToken)
}
