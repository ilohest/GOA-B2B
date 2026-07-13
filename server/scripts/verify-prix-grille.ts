import { getDb } from '../src/firebase.js'
import { lireGrilleTarifaire, lireReferentiels } from '../src/sync.js'
import { grillePrixPourClient, catalogueClient, type CatalogueOverride } from '../src/catalogue.js'
const db = getDb(); if (!db) throw new Error('émulateurs ?')
let ok = true; const check=(l:string,c:boolean)=>{console.log(`${c?'✅':'❌'} ${l}`); if(!c) ok=false}
async function main(){
  const grille = await lireGrilleTarifaire(db!)
  const types = await lireReferentiels(db!).catch(()=>[])
  console.log(`grille: ${grille.lignes.length} lignes, syncedAt=${grille.syncedAt ? 'ok' : 'ABSENT'}, ${types.length} types`)
  if (!grille.lignes.length) { console.log('⚠️ grille vide — relancer verify-grille.ts (émulateur reset ?)'); process.exit(1) }

  // Carton 12x35cl Cola = idStockBouteille 165533 (PRO 23.4 / Distributeur 18.72)
  const SB = 165533
  const pro = grillePrixPourClient(grille.lignes, 17849, types)
  const distrib = grillePrixPourClient(grille.lignes, 20735, types)
  const gms = grillePrixPourClient(grille.lignes, 20680, types) // hérite PRO
  check(`PRO → Carton12 = 23.4`, pro.prix[String(SB)] === 23.4)
  check(`Distributeur → Carton12 = 18.72`, distrib.prix[String(SB)] === 18.72)
  check(`GMS hérite de PRO (idTypeGrille=17849) → 23.4`, gms.idTypeGrille === 17849 && gms.prix[String(SB)] === 23.4)

  // Scénario clé : unité VISIBLE, AUCUN prix perso client → prix vient de la grille, frais.
  const overrides: Record<string, CatalogueOverride> = { [String(SB)]: { visible: true, displayName: '', photoUrl: '', rupture: false } }
  const res = catalogueClient(
    [{ idStockBouteille: SB, libelle: 'Cola - Chaï - Carton de 12 - 0.35L' }],
    overrides,
    {
      // pas de prix perso client → le prix doit venir de la grille
      maxAgeMs: 36 * 60 * 60 * 1000,
      grillePrix: pro.prix,
      grilleSyncedAt: grille.syncedAt,
    },
  )
  const prod = res.find(p => p.idStockBouteille === SB)
  check('unité visible sans prix perso → prix affiché depuis la grille', prod?.prixHT === 23.4)
  check('… et marqué frais (pas de resynchro nécessaire)', prod?.prixEstFrais === true)

  console.log(ok ? '\n🎉 Prix grille-base : OK — visibilité instantanée' : '\n⚠️ échec')
  process.exit(ok?0:1)
}
main().catch(e=>{console.error('❌',e);process.exit(1)})
