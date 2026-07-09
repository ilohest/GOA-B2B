/**
 * Remplit le cache des commandes récentes (cache/commandesRecentes), en
 * respectant le rate-limiting Easybeer : attend la levée d'un éventuel ban,
 * laisse un tampon, puis tente une synchro ; en cas de re-ban, patiente
 * longuement avant de réessayer (les durées annoncées par Easybeer mentent).
 *
 * Usage : `npx tsx scripts/remplir-cache-commandes.ts`
 */
import { getDb } from '../src/firebase.js'
import { EasybeerBanError, etatBanEasybeer } from '../src/easybeer.js'
import { syncCommandesRecentes } from '../src/sync.js'

const db = getDb()
if (!db) {
  console.error('Firebase non initialisé.')
  process.exit(1)
}

const delai = (ms: number) => new Promise((r) => setTimeout(r, ms))

for (let tentative = 1; tentative <= 6; tentative++) {
  // Attendre la fin d'un ban connu, sans toucher l'API.
  let etat = etatBanEasybeer()
  while (etat.banni) {
    console.log(`[remplissage] ban en cours (${etat.secondesRestantes} s) — attente…`)
    await delai((etat.secondesRestantes + 5) * 1000)
    etat = etatBanEasybeer()
  }

  console.log(`[remplissage] tentative ${tentative} — synchro des commandes…`)
  try {
    const commandes = await syncCommandesRecentes(db)
    console.log(`[remplissage] ✅ ${commandes.length} commandes mises en cache.`)
    process.exit(0)
  } catch (e) {
    if (e instanceof EasybeerBanError) {
      const attente = Math.max(e.retryAfterSeconds + 60, 240)
      console.log(`[remplissage] re-ban (${e.retryAfterSeconds} s annoncés) — pause ${attente} s avant réessai.`)
      await delai(attente * 1000)
    } else {
      console.error('[remplissage] échec :', (e as Error).message)
      process.exit(1)
    }
  }
}
console.error('[remplissage] abandon après 6 tentatives — Easybeer reste saturé, réessayer plus tard.')
process.exit(1)
