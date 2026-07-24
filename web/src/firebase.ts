/**
 * Init Firebase côté navigateur (Auth uniquement — Firestore n'est JAMAIS lu
 * en direct par le front, tout passe par le backend Hono).
 *
 * Deux modes :
 *  - Émulateur (VITE_FIREBASE_EMULATOR=true, dev) : config factice + émulateur
 *    Auth local. Démarrer avec `npm run dev:emulators` à la racine.
 *  - Prod : config réelle via les variables VITE_FIREBASE_*.
 *
 * Si rien n'est configuré, `firebaseAuth` reste null (l'app le signale).
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  connectAuthEmulator,
  inMemoryPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth'

const useEmulator = import.meta.env.VITE_FIREBASE_EMULATOR === 'true'

const cfg = useEmulator
  ? {
      apiKey: 'fake-api-key-emulator',
      authDomain: 'demo-goa-kombucha.firebaseapp.com',
      projectId: 'demo-goa-kombucha',
      appId: 'demo-goa-kombucha',
    }
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    }

export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId)

let app: FirebaseApp | null = null
if (firebaseConfigured) app = initializeApp(cfg)
export const firebaseAuth: Auth | null = app
  ? initializeAuth(app, {
      // Évite IndexedDB, qui peut bloquer Firebase Auth avant toute requête
      // réseau dans Safari iOS. Les replis gardent la connexion utilisable
      // même si le stockage local est restreint (navigation privée, etc.).
      persistence: [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    })
  : null

if (firebaseAuth && useEmulator) {
  const configuredHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? 'http://localhost:9100'
  const configuredUrl = new URL(configuredHost)
  const pageIsLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const emulatorIsLocal = ['localhost', '127.0.0.1'].includes(configuredUrl.hostname)
  // Un localhost injecté par erreur dans un build public désignerait le
  // téléphone ou le poste du visiteur. Le proxy Firebase est servi par la
  // même origine que GOA sur le VPS.
  const host = emulatorIsLocal && !pageIsLocal ? window.location.origin : configuredHost
  connectAuthEmulator(firebaseAuth, host, { disableWarnings: true })
}

void app
