/**
 * Client HTTP léger vers le backend (`/api`). Joint l'ID token Firebase si dispo.
 */
import { firebaseAuth } from '../firebase'

async function authHeader(): Promise<Record<string, string>> {
  const token = await firebaseAuth?.currentUser?.getIdToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(await authHeader()),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
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
    const res = await fetch(`/api${path}`, { method: 'POST', headers: await authHeader(), body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`)
    return data as T
  },

  /** Télécharge un binaire authentifié (ex. PDF) et déclenche l'enregistrement. */
  async telecharger(path: string, nomFichier: string): Promise<void> {
    const res = await fetch(`/api${path}`, { headers: await authHeader() })
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
