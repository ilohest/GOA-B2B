/**
 * Remplit cache/commandesRecentes en UNE seule tentative (pas de boucle qui
 * risquerait d'entretenir un ban). À lancer quand on pense l'API calmée.
 */
import { getDb } from '../src/firebase.js'
import { EasybeerBanError } from '../src/easybeer.js'
import { syncCommandesRecentes } from '../src/sync.js'

const db = getDb()
if (!db) {
  console.error('Firebase non initialisé.')
  process.exit(1)
}

try {
  const commandes = await syncCommandesRecentes(db)
  console.log(`[remplissage] ✅ ${commandes.length} commandes mises en cache.`)
} catch (e) {
  if (e instanceof EasybeerBanError) {
    console.log(`[remplissage] ⛔ toujours banni (${e.retryAfterSeconds} s annoncés) — réessayer plus tard.`)
  } else {
    console.error('[remplissage] échec :', (e as Error).message)
  }
  process.exit(1)
}
