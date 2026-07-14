/** Formatteurs partagés (fr-FR). */

export const prixFr = (v: number): string =>
  v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

/** Date depuis un epoch millis (normalisé côté serveur). */
export const dateFr = (ts: number | null | undefined): string =>
  ts ? new Date(ts).toLocaleDateString('fr-FR', { dateStyle: 'medium' }) : '—'

export const dateHeureFr = (ts: number | null | undefined): string =>
  ts ? new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

/** Décomposition des totaux d'une commande : Sous-total HT, Remise, TVA, Total TTC. */
export function decomposerTotaux(detail: {
  totalHT: number | null
  totalTTC: number | null
  remiseTotale: number | null
}): { label: string; valeur: string; fort?: boolean }[] {
  const lignes: { label: string; valeur: string; fort?: boolean }[] = []
  if (detail.totalHT != null) lignes.push({ label: 'Sous-total HT', valeur: prixFr(detail.totalHT) })
  if (detail.remiseTotale) lignes.push({ label: 'Remise', valeur: `− ${prixFr(detail.remiseTotale)}` })
  if (detail.totalHT != null && detail.totalTTC != null) {
    lignes.push({ label: 'TVA (5,5 %)', valeur: prixFr(Math.max(0, detail.totalTTC - detail.totalHT)) })
  }
  if (detail.totalTTC != null) lignes.push({ label: 'Total TTC', valeur: prixFr(detail.totalTTC), fort: true })
  return lignes
}
