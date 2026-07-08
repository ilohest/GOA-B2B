/** Formatteurs partagés (fr-FR). */

export const prixFr = (v: number): string =>
  v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

/** Date depuis un epoch millis (normalisé côté serveur). */
export const dateFr = (ts: number | null | undefined): string =>
  ts ? new Date(ts).toLocaleDateString('fr-FR', { dateStyle: 'medium' }) : '—'

export const dateHeureFr = (ts: number | null | undefined): string =>
  ts ? new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
