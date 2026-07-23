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
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'

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
export const firebaseAuth: Auth | null = firebaseConfigured ? getAuth((app = initializeApp(cfg))) : null

if (firebaseAuth && useEmulator) {
  const host = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? 'http://localhost:9100'
  connectAuthEmulator(firebaseAuth, host, { disableWarnings: true })
}

void app
