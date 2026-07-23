/** Convertit un libellé de contenant Easybeer en litres. */
export function contenanceLitres(contenant: string | null | undefined): number | null {
  if (!contenant) return null
  const resultat = contenant.match(/(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|l)\b/i)
  if (!resultat) return null
  const valeur = Number(resultat[1].replace(',', '.'))
  if (!Number.isFinite(valeur) || valeur <= 0) return null
  switch (resultat[2].toLowerCase()) {
    case 'ml': return valeur / 1000
    case 'cl': return valeur / 100
    case 'dl': return valeur / 10
    default: return valeur
  }
}

/** Volume d'une unité commandable : bouteille/fût × quantité du lot. */
export function litresParArticle(
  contenant: string | null | undefined,
  quantiteLot: number | null | undefined,
  packaging: string | null | undefined,
): number | null {
  const litres = contenanceLitres(contenant)
  if (litres == null) return null
  let quantite = Number(quantiteLot)
  if (!Number.isFinite(quantite) || quantite <= 0) {
    if (/\bunit[eé]\b/i.test(packaging ?? '')) quantite = 1
    else {
      const resultat = packaging?.match(/\b(\d+)\b/)
      quantite = resultat ? Number(resultat[1]) : 1
    }
  }
  return litres * quantite
}
