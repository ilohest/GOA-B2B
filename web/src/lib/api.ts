/**
 * Client HTTP léger vers le backend (`/api`). Joint l'ID token Firebase si dispo.
 *
 * Robustesse 401 : un token peut expirer ou être invalidé (ex. redémarrage de
 * l'émulateur Auth en dev). Sur 401, on force un rafraîchissement du token et
 * on réessaie une fois ; si ça échoue encore, la session est réellement morte
 * → déconnexion + retour au login (au lieu d'une erreur affichée au client).
 */
import { firebaseAuth } from '../firebase'

async function authHeader(forceRefresh = false): Promise<Record<string, string>> {
  const token = await firebaseAuth?.currentUser?.getIdToken(forceRefresh).catch(() => null)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

let deconnexionEnCours = false

/** Session expirée irrécupérable : on déconnecte et on renvoie vers /login. */
async function sessionExpiree(): Promise<void> {
  if (deconnexionEnCours) return
  deconnexionEnCours = true
  try {
    await firebaseAuth?.signOut()
  } catch {
    // ignore
  }
  if (!location.pathname.startsWith('/login')) {
    location.assign('/login?expired=1')
  }
}

async function envoyer(method: string, path: string, body: unknown, forceRefresh: boolean): Promise<Response> {
  const estForm = body instanceof FormData
  return fetch(`/api${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && !estForm ? { 'Content-Type': 'application/json' } : {}),
      ...(await authHeader(forceRefresh)),
    },
    body: body === undefined ? undefined : estForm ? (body as FormData) : JSON.stringify(body),
  })
}

/** Requête authentifiée avec un retry sur 401 (token rafraîchi). */
async function requeteBrute(method: string, path: string, body?: unknown): Promise<Response> {
  let res = await envoyer(method, path, body, false)
  if (res.status === 401 && firebaseAuth?.currentUser) {
    res = await envoyer(method, path, body, true) // token peut-être périmé → refresh + retry
    if (res.status === 401) await sessionExpiree()
  }
  return res
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await requeteBrute(method, path, body)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`)
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),

  /** Envoie un fichier en multipart (champ nommé), avec le token Firebase. */
  async envoyerFichier<T>(path: string, champ: string, fichier: File): Promise<T> {
    const form = new FormData()
    form.append(champ, fichier)
    return request<T>('POST', path, form)
  },

  /** Télécharge un binaire authentifié (ex. PDF) et déclenche l'enregistrement. */
  async telecharger(path: string, nomFichier: string): Promise<void> {
    const res = await requeteBrute('GET', path)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error || `Erreur ${res.status}`)
    }
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = nomFichier
    a.click()
    URL.revokeObjectURL(url)
  },
}
