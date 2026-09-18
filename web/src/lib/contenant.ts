/**
 * Code couleur des contenants de la boutique.
 *
 * Objectif : rendre la grille de produits balayable d'un coup d'œil — repérer
 * tous les fûts, ou toutes les petites bouteilles, sans lire chaque pastille.
 *
 * La couleur est TOUJOURS doublée du libellé : elle ne porte jamais seule
 * l'information (daltonisme, impression noir et blanc).
 *
 * Deux contraintes ont dicté la forme :
 *  - Fonds volontairement très clairs : la teinte doit rester discrète sur une
 *    carte produit. C'est l'ÉCART DE TEINTE qui fait la lisibilité, pas la
 *    saturation — deux nuances voisines de bleu, même soutenues, ne se
 *    départagent pas, alors que trois teintes éloignées se lisent en pastel.
 *  - Les teintes retenues sont écartées d'au moins ~55° de teinte (oklch), et
 *    évitent le vert (marque et actions principales), l'ambre (rupture de stock
 *    et tarifs à vérifier) et le rouge (destructif).
 *
 * Attribution volontairement SANS ÉTAT : la teinte se déduit du seul libellé
 * ("Bouteille - 0.35L", "Fût - 20L"), jamais de la position dans la liste des
 * contenants du catalogue. Ajouter un format chez Easybeer ne redistribue donc
 * pas les couleurs des formats existants, et le composant reste utilisable là
 * où le catalogue complet n'est pas connu (panier, récapitulatif, dialogues).
 */

/** Format absent ou non reconnu : pastille neutre. */
const NEUTRE = 'border-border bg-background text-muted-foreground'

const FUT = 'border-violet-200 bg-violet-50 text-violet-800'
const PETITE = 'border-sky-200 bg-sky-50 text-sky-800'
const MOYENNE = 'border-teal-200 bg-teal-50 text-teal-800'
const GRANDE = 'border-slate-300 bg-slate-100 text-slate-800'

/** Volume en litres lu dans le libellé ("0.35L", "1 L", "20L"), sinon null. */
function volumeLitres(contenant: string): number | null {
  const m = contenant.match(/(\d+(?:[.,]\d+)?)\s*L\b/i)
  if (!m) return null
  const n = Number(m[1]!.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Teinte de la pastille d'un contenant : famille d'abord, volume ensuite. */
export function styleContenant(contenant?: string | null): string {
  if (!contenant) return NEUTRE
  const libelle = contenant.toLocaleLowerCase('fr')

  // Le fût se distingue de la bouteille : c'est un autre geste de service.
  if (libelle.includes('fût') || libelle.includes('fut') || libelle.includes('tonneau')) return FUT

  const litres = volumeLitres(contenant)
  if (litres == null) return NEUTRE
  if (litres < 0.5) return PETITE
  if (litres <= 1.5) return MOYENNE
  return GRANDE
}
