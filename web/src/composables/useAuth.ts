/**
 * État d'authentification partagé (module singleton).
 *
 * Expose l'utilisateur Firebase courant + `waitForAuth()` pour que la garde
 * du router attende la restauration de session avant de décider d'une redirection.
 */
import { computed, ref } from 'vue'
import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  signInWithEmailLink,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { firebaseAuth, firebaseConfigured } from '@/firebase'

const currentUser = ref<User | null>(null)
const ready = ref(false)
let readyPromise: Promise<void> | null = null

function ensureListener(): Promise<void> {
  if (readyPromise) return readyPromise
  readyPromise = new Promise((resolve) => {
    if (!firebaseAuth) {
      ready.value = true
      resolve()
      return
    }
    onAuthStateChanged(firebaseAuth, (user) => {
      currentUser.value = user
      if (!ready.value) {
        ready.value = true
        resolve()
      }
    })
  })
  return readyPromise
}

function requireAuthInstance() {
  if (!firebaseAuth) throw new Error('Firebase Auth non configuré (voir web/.env.local).')
  return firebaseAuth
}

export function useAuth() {
  ensureListener()
  return {
    firebaseConfigured,
    user: currentUser,
    ready,
    isAuthenticated: computed(() => currentUser.value != null),
    waitForAuth: ensureListener,
    login: (email: string, password: string) =>
      signInWithEmailAndPassword(requireAuthInstance(), email, password),
    loginWithGoogle: () => signInWithPopup(requireAuthInstance(), new GoogleAuthProvider()),
    // Envoi des liens (connexion sans mot de passe, réinitialisation) : géré par
    // le backend GOA (emails à la charte). Seule la FINALISATION reste côté SDK.
    isLoginLink: (url = window.location.href) => isSignInWithEmailLink(requireAuthInstance(), url),
    loginWithEmailLink: (email: string, url = window.location.href) =>
      signInWithEmailLink(requireAuthInstance(), email, url),
    logout: () => signOut(requireAuthInstance()),
  }
}
