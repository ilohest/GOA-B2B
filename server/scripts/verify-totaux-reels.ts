/**
 * Vérif #1/#2 : après création, on relit les totaux RÉELS d'Easybeer
 * (remise + consigne + TVA), qui diffèrent du total local (tarif de base).
 * Devis réversible sur le client test 588074, supprimé à la fin.
 */
import { enregistrerCommande, detailCommande, supprimerCommande } from '../src/easybeer.js'
import { lireCatalogue, lireCacheClient } from '../src/sync.js'
import { getDb } from '../src/firebase.js'
const db = getDb(); if (!db) throw new Error('ému ?')
const ID = 588074, SB = 150176 // Cola Carton 6x1L
let ok = true; const check=(l:string,c:boolean)=>{console.log(`${c?'✅':'❌'} ${l}`); if(!c) ok=false}
async function main(){
  const { produits } = await lireCatalogue(db!)
  const cc = await lireCacheClient(db!, ID)
  const produit = produits.find(p=>p.idStockBouteille===SB)!
  const prixBase = cc.prix[String(SB)]
  const totalLocal = prixBase * 2 // 2 cartons
  console.log(`total LOCAL (tarif de base ×2) = ${totalLocal} € HT`)

  const res = await enregistrerCommande({
    idClient: ID, idGrilleTarifaire: cc.idGrilleTarifaire ?? 17849,
    tauxTVA: produit.tauxTVA ?? { idTauxTVA: 13087 },
    commentaire: 'TEST totaux réels — à supprimer', estDevis: true,
    lignes: [{ produit, quantite: 2, prixUnitaireHT: prixBase }],
  })
  const d = await detailCommande(res.id!)
  const totalHT = d.totalHT as number, totalTTC = d.totalTTC as number, consigne = d.totalConsigne as number|undefined
  console.log(`totaux EASYBEER : HT=${totalHT} TTC=${totalTTC} consigne=${consigne ?? '—'} remise=${(d.remiseTotale as number|undefined) ?? '—'}`)
  check('total HT réel lisible', typeof totalHT === 'number')
  check('total TTC réel lisible (TVA incluse)', typeof totalTTC === 'number' && totalTTC >= totalHT)
  check('consigne appliquée par Easybeer (HT réel ≠ total local)', Math.abs(totalHT - totalLocal) > 0.001)

  await supprimerCommande(res.id!)
  console.log(`devis ${res.id} supprimé`)
  console.log(ok ? '\n🎉 Totaux réels : OK' : '\n⚠️ échec'); process.exit(ok?0:1)
}
main().catch(e=>{console.error('❌',e);process.exit(1)})
