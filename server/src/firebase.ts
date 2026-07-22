/**
 * Initialisation Firebase Admin (paresseuse).
 *
 * Deux modes :
 *  - Émulateurs (FIREBASE_EMULATORS=true, dev) : init sans clé de service,
 *    pointée sur les émulateurs Auth/Firestore locaux via les variables
 *    d'environnement standard du SDK Admin.
 *  - Prod Cloud Run : identité du compte de service via Application Default
 *    Credentials, sans fichier de clé. Une clé locale reste acceptée pour les
 *    outils ponctuels hors Google Cloud.
 *
 * En production, les garde-fous de config imposent un projectId et un bucket.
 */
import { readFileSync } from 'node:fs'
import { initializeApp, applicationDefault, cert, type App } from 'firebase-admin/app'
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { config } from './config.js'

/** Type dérivé pour éviter le conflit CJS/ESM de @google-cloud/storage. */
type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>

let app: App | null = null
let initTried = false

function ensureApp(): App | null {
  if (initTried) return app
  initTried = true

  if (config.firebase.emulators) {
    // Le SDK Admin détecte les émulateurs via ces variables d'environnement.
    process.env.FIREBASE_AUTH_EMULATOR_HOST = config.firebase.emulatorAuthHost
    process.env.FIRESTORE_EMULATOR_HOST = config.firebase.emulatorFirestoreHost
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = config.firebase.emulatorStorageHost
    const projectId = config.firebase.projectId ?? 'demo-goa-kombucha'
    app = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` })
    console.log(
      `[firebase] Admin en mode ÉMULATEURS (projet ${projectId}, auth ${config.firebase.emulatorAuthHost}, firestore ${config.firebase.emulatorFirestoreHost}).`,
    )
    return app
  }

  try {
    const path = config.firebase.credentialsPath
    const credential = path
      ? cert(JSON.parse(readFileSync(path, 'utf8')))
      : applicationDefault()
    app = initializeApp({
      credential,
      projectId: config.firebase.projectId,
      storageBucket: config.firebase.storageBucket,
    })
    console.log(`[firebase] Admin initialisé (${path ? 'clé locale' : 'identité Google du service'}).`)
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

export function getBucket(): Bucket | null {
  const a = ensureApp()
  return a ? getStorage(a).bucket() : null
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
