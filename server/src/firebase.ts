/**
 * Initialisation Firebase Admin (paresseuse).
 *
 * Deux modes :
 *  - Émulateurs (FIREBASE_EMULATORS=true, dev) : init sans clé de service,
 *    pointée sur les émulateurs Auth/Firestore locaux via les variables
 *    d'environnement standard du SDK Admin.
 *  - Prod : clé de compte de service (GOOGLE_APPLICATION_CREDENTIALS).
 *
 * Si rien n'est configuré, `getDb()` renvoie null : les endpoints dépendant
 * de Firestore le signalent proprement au lieu de planter au démarrage.
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert, type App } from 'firebase-admin/app'
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { config } from './config.js'

let app: App | null = null
let initTried = false

function ensureApp(): App | null {
  if (initTried) return app
  initTried = true

  if (config.firebase.emulators) {
    // Le SDK Admin détecte les émulateurs via ces variables d'environnement.
    process.env.FIREBASE_AUTH_EMULATOR_HOST = config.firebase.emulatorAuthHost
    process.env.FIRESTORE_EMULATOR_HOST = config.firebase.emulatorFirestoreHost
    const projectId = config.firebase.projectId ?? 'demo-goa-kombucha'
    app = initializeApp({ projectId })
    console.log(
      `[firebase] Admin en mode ÉMULATEURS (projet ${projectId}, auth ${config.firebase.emulatorAuthHost}, firestore ${config.firebase.emulatorFirestoreHost}).`,
    )
    return app
  }

  const path = config.firebase.credentialsPath
  if (!path) {
    console.warn('[firebase] Aucune clé de service (GOOGLE_APPLICATION_CREDENTIALS) — Firestore désactivé.')
    return null
  }
  try {
    const serviceAccount = JSON.parse(readFileSync(path, 'utf8'))
    app = initializeApp({ credential: cert(serviceAccount), projectId: config.firebase.projectId })
    console.log('[firebase] Admin initialisé (clé de service).')
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

export function getAdminAuth(): Auth | null {
  const a = ensureApp()
  return a ? getAuth(a) : null
}

export async function verifyIdToken(idToken: string): Promise<DecodedIdToken> {
  const auth = getAdminAuth()
  if (!auth) throw new Error('Firebase Admin non configuré')
  return auth.verifyIdToken(idToken)
}
