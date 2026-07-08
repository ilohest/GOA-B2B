/**
 * Init Firebase côté navigateur (Auth uniquement).
 *
 * La config vient des variables VITE_FIREBASE_*. Si elles sont absentes (dev),
 * `firebaseAuth` reste null et l'app fonctionne en mode dev (auth court-circuitée
 * côté backend via AUTH_DISABLED).
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId)

let app: FirebaseApp | null = null
export const firebaseAuth: Auth | null = firebaseConfigured
  ? getAuth((app = initializeApp(cfg)))
  : null

void app
