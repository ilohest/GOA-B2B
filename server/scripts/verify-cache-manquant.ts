/**
 * Vérif priorité #1 : un client SANS cache ne casse plus l'app.
 * - remplirCacheClientCible crée le cache (1 fiche + prix visibles, Easybeer réel)
 * - anti-rafale : une 2e tentative immédiate sur cache absent renvoie null
 * Utilise le client de test 588074 : on SAUVEGARDE son cache, on le supprime,
 * on vérifie, on restaure si besoin (le remplissage le recrée de toute façon).
 */
import { getDb } from '../src/firebase.js'
import { remplirCacheClientCible, lireCacheClient } from '../src/sync.js'
const db = getDb(); if (!db) throw new Error('émulateurs ?')
let ok = true; const check=(l:string,c:boolean)=>{console.log(`${c?'✅':'❌'} ${l}`); if(!c) ok=false}
const ID = 588074
async function main(){
  const ref = db!.doc(`cacheClients/${ID}`)
  const sauvegarde = (await ref.get()).data()
  await ref.delete()
  console.log(`cache client ${ID} supprimé (simulation compte fraîchement activé)`)

  // Lecture applicative → CacheIndisponibleError (comportement attendu, intercepté par les endpoints)
  const lecture = await lireCacheClient(db!, ID).then(()=> 'ok').catch((e)=> e.name)
  check('lecture cache absent → CacheIndisponibleError', lecture === 'CacheIndisponibleError')

  // Remplissage ciblé → crée le cache via Easybeer (fiche + prix visibles)
  const doc = await remplirCacheClientCible(db!, ID)
  check('remplissage ciblé → cache créé', doc != null && doc.client?.idClient === ID)
  check('  … avec la grille racine résolue', doc?.idGrilleTarifaire === 17849)
  console.log(`  prix chargés : ${Object.keys(doc?.prix ?? {}).length} (unités visibles)`)

  // Cache existant → renvoyé tel quel, AUCUN appel Easybeer
  const again = await remplirCacheClientCible(db!, ID)
  check('cache existant → retour immédiat sans re-sync', again != null)

  // Anti-rafale : on resupprime, la tentative suivante est bloquée (fenêtre 10 min)
  await ref.delete()
  const bloque = await remplirCacheClientCible(db!, ID)
  check('anti-rafale : 2e tentative dans la fenêtre → null (pas d\'appel Easybeer)', bloque === null)

  // Restauration de l'état initial
  if (sauvegarde) await ref.set(sauvegarde)
  console.log(ok ? '\n🎉 Priorité #1 : OK' : '\n⚠️ échec'); process.exit(ok?0:1)
}
main().catch(e=>{console.error('❌',e);process.exit(1)})
