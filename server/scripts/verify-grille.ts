/**
 * Vérif : synchro grille tarifaire (matrice par type) + vue admin agrégée.
 * Appelle Easybeer (catalogue + types + matrice/type). Usage :
 * npx tsx scripts/verify-grille.ts
 */
import { getDb } from '../src/firebase.js'
import { syncReferentiels, syncCatalogue, syncGrilleTarifaire, lireGrilleTarifaire } from '../src/sync.js'
import { catalogueAdmin } from '../src/catalogue.js'

const db = getDb()
if (!db) throw new Error('Firebase non initialisé (émulateurs ?)')

async function main() {
  console.log('… types de client'); const types = await syncReferentiels(db!)
  console.log(`   ${types.length} types`)
  console.log('… catalogue (tous conditionnements)'); const produits = await syncCatalogue(db!)
  console.log(`   ${produits.length} unités (idStockBouteille)`)
  console.log('… grille tarifaire (matrice par type)'); const lignes = await syncGrilleTarifaire(db!, types, produits)
  const { syncedAt } = await lireGrilleTarifaire(db!)
  console.log(`   ${lignes.length} lignes de grille, syncedAt=${syncedAt}`)
  const typesAvecGrille = [...new Set(lignes.map((l) => `${l.idClientType}/${l.typeClient}`))]
  console.log('   types AVEC grille :', typesAvecGrille)

  const { unites } = await catalogueAdmin(db!)
  console.log(`\nVue admin : ${unites.length} unités commandables avec prix`)
  const cola = unites.filter((u) => u.produit.includes('Cola'))
  console.log(`\nCola-Chaï — ${cola.length} unités :`)
  for (const u of cola) {
    const prix = u.tarifs.map((t) => `${t.typeClient}=${t.prixHT}€`).join('  ')
    console.log(`  • ${u.contenant} | ${u.packaging} | idSB=${u.idStockBouteille} | ${prix}`)
  }
  const sansSB = lignes.filter((l) => l.idStockBouteille == null).length
  if (sansSB) console.log(`\n⚠️ ${sansSB} ligne(s) de grille sans idStockBouteille (non commandables, exclues de la vue admin)`)
  process.exit(0)
}
main().catch((e) => { console.error('❌', e); process.exit(1) })
