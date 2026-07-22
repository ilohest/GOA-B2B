/**
 * Copie un texte dans le presse-papiers.
 *
 * `navigator.clipboard` est réservé aux contextes sécurisés (HTTPS ou
 * localhost). La préproduction actuelle étant servie en HTTP sur une IP, on
 * conserve un repli via une zone de texte temporaire pour les navigateurs qui
 * autorisent encore `execCommand('copy')`.
 */
export async function copierDansPressePapiers(texte: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texte)
      return true
    } catch {
      // Contexte HTTP ou permission refusée : tenter le repli ci-dessous.
    }
  }

  const zone = document.createElement('textarea')
  zone.value = texte
  zone.readOnly = true
  zone.setAttribute('aria-hidden', 'true')
  zone.style.position = 'fixed'
  zone.style.inset = '0 auto auto -9999px'
  zone.style.opacity = '0'
  document.body.appendChild(zone)
  zone.focus()
  zone.select()
  zone.setSelectionRange(0, zone.value.length)

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    zone.remove()
  }
}
