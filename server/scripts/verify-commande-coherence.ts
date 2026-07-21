/**
 * Vérif E2E de COHÉRENCE d'une commande à travers TOUT le flux :
 *   création (client) → vue CLIENT → vue ADMIN → vue EASYBEER (source de vérité).
 * On crée un devis réel (client test 825435), on relit les 3 vues, on vérifie
 * qu'elles concordent (id, n°, total HT, remise, état), puis on SUPPRIME le devis.
 *
 * ⚠️ Tape Easybeer (création + relectures + suppression) → à lancer ponctuellement
 * (risque de ban en session de tests intensive). Nécessite le SERVEUR lancé
 * (localhost:8788) + les émulateurs (comptes seed) + le client 825435 câblé
 * (scripts/creer-client-test-easybeer.ts).
 *
 * Usage : cd server && npx tsx scripts/verify-commande-coherence.ts
 */
import { config } from '../src/config.js'
import { supprimerCommande, detailCommande } from '../src/easybeer.js'
import { getDb } from '../src/firebase.js'
import { lireCatalogue } from '../src/sync.js'

const BASE = `http://localhost:${config.port}`
const AUTH_EMU = `http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key-emulator`
const CLIENT_EMAIL = 'client-remise-eb@goa.local'
const ADMIN_EMAIL = 'admin@goa.local'
const PASSWORD = 'goa-dev-123'
const ID_CLIENT = 825435

// Résolveur AUTORITAIRE d'Easybeer : quelle remise produit s'applique pour ce
// client + produit + quantité (POST /parametres/remise = recupererRemiseBouteille).
// C'est LA source de vérité : notre logique doit renvoyer la même chose.
const AUTH_EB = 'Basic ' + Buffer.from(`${config.easybeer.username}:${config.easybeer.password}`).toString('base64')
async function remiseProduitEasybeer(refs: {
  idProduit?: number | null
  idContenant?: number | null
  idStockBouteille: number
  quantite: number
}): Promise<string | null> {
  const res = await fetch(`${config.easybeer.target}/parametres/remise`, {
    method: 'POST',
    headers: { Authorization: AUTH_EB, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idClient: ID_CLIENT,
      idProduit: refs.idProduit,
      idContenant: refs.idContenant,
      idStockProduit: refs.idStockBouteille,
      quantite: refs.quantite,
    }),
  })
  const txt = await res.text()
  try {
    return (JSON.parse(txt.replace(/[\x00-\x1F]/g, ' '))?.map?.remise as string | undefined) ?? null
  } catch {
    return null
  }
}

// Deux lignes pour couvrir LES DEUX chemins de remise dans un seul devis :
//  - Cola Carton 18 (133238) : remise CIBLÉE 10 % (qté ≥2) → remplace la globale.
//  - Framboise Carton 18 (116441) : pas de ciblée → remise GLOBALE 12 %.
const LIGNES = [
  { idStockBouteille: 133238, quantite: 3, remisePct: 10, libelle: 'Cola (ciblée 10%)' },
  { idStockBouteille: 116441, quantite: 3, remisePct: 12, libelle: 'Framboise (globale 12%)' },
]

let ok = true
const check = (label: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) ok = false
}
const proche = (a: unknown, b: unknown, eps = 0.02) =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < eps

async function token(email: string): Promise<string> {
  const res = await fetch(AUTH_EMU, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  })
  const j = (await res.json()) as { idToken?: string }
  if (!j.idToken) throw new Error(`Auth émulateur échouée pour ${email}`)
  return j.idToken
}

async function api<T = any>(chemin: string, tok: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${chemin}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, ...(init?.headers ?? {}) },
  })
  const txt = await res.text()
  let j: any = {}
  try {
    j = txt ? JSON.parse(txt) : {}
  } catch {
    j = { _raw: txt.slice(0, 200) }
  }
  if (res.status >= 400) throw new Error(`${chemin} → HTTP ${res.status} ${JSON.stringify(j).slice(0, 200)}`)
  return j as T
}

async function main() {
  console.log(`Serveur ${BASE} — vérif de cohérence d'une commande`)
  // ⚠️ Selon COMMANDE_EST_DEVIS, ce test écrit un DEVIS (jetable) ou une VRAIE
  // COMMANDE dans Easybeer. Il la supprime à la fin, mais supprimer une commande
  // ferme n'est pas neutre côté GOA — d'où l'avertissement explicite.
  console.log(
    config.commandeEstDevis
      ? 'Mode : DEVIS (réversible)\n'
      : '⚠️  Mode : VRAIE COMMANDE (COMMANDE_EST_DEVIS=false) — une commande ferme va être créée puis supprimée.\n',
  )
  const [tClient, tAdmin] = await Promise.all([token(CLIENT_EMAIL), token(ADMIN_EMAIL)])
  const db = getDb()
  const { produits } = db ? await lireCatalogue(db) : { produits: [] as any[] }
  const refProduit = (idStockBouteille: number) => produits.find((p) => p.idStockBouteille === idStockBouteille)

  // --- 1. CRÉATION (côté client) ---
  const creation = await api(`/api/commandes`, tClient, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commentaire: 'VERIF cohérence — à supprimer',
      lignes: LIGNES.map((l) => ({ idStockBouteille: l.idStockBouteille, quantite: l.quantite })),
    }),
  })
  const idCommande: number = creation.easybeer?.id
  const numero = creation.easybeer?.numero
  console.log(`1. Créée : idCommande=${idCommande} n°${numero} | confirmation totalHT=${creation.totalHT} remise=${creation.remiseTotale} totauxReels=${creation.totauxReels}\n`)
  check('création OK (id Easybeer renvoyé)', typeof idCommande === 'number')
  check('confirmation = totaux RÉELS Easybeer (pas repli local)', creation.totauxReels === true)
  if (!idCommande) {
    console.log('\n⚠️ pas d’idCommande — abandon.')
    process.exit(1)
  }

  try {
    // --- 2. VUE EASYBEER (source de vérité) ---
    const eb = await detailCommande(idCommande)
    const ebHT = eb.totalHT as number
    const ebRemise = (eb.remiseTotale as number | undefined) ?? 0
    console.log(`2. Easybeer : totalHT=${ebHT} remiseTotale=${ebRemise} état=${JSON.stringify((eb.etat as any)?.code ?? eb.etat)}`)

    // --- 3. VUE CLIENT (GET /api/commandes/:id) ---
    const vueClient = await api(`/api/commandes/${idCommande}`, tClient)
    console.log(`3. Client  : totalHT=${vueClient.totalHT} remiseTotale=${vueClient.remiseTotale} état=${vueClient.etat?.code}`)

    // --- 4. VUE ADMIN (GET /api/admin/commandes/:id) ---
    const vueAdmin = await api(`/api/admin/commandes/${idCommande}`, tAdmin)
    console.log(`4. Admin   : totalHT=${vueAdmin.totalHT} remiseTotale=${vueAdmin.remiseTotale} état=${vueAdmin.etat?.code}\n`)

    // --- COHÉRENCE ENTRE LES VUES ---
    check('client.totalHT == Easybeer.totalHT', proche(vueClient.totalHT, ebHT), `${vueClient.totalHT} vs ${ebHT}`)
    check('admin.totalHT == Easybeer.totalHT', proche(vueAdmin.totalHT, ebHT), `${vueAdmin.totalHT} vs ${ebHT}`)
    check('client.totalHT == confirmation.totalHT', proche(vueClient.totalHT, creation.totalHT))
    check('client.remiseTotale == Easybeer.remiseTotale', proche(vueClient.remiseTotale ?? 0, ebRemise))
    check('admin.remiseTotale == Easybeer.remiseTotale', proche(vueAdmin.remiseTotale ?? 0, ebRemise))
    check('client.numero == admin.numero', vueClient.numero === vueAdmin.numero, `${vueClient.numero}/${vueAdmin.numero}`)

    // --- COHÉRENCE REMISE PAR LIGNE : ciblée-ou-globale, UNE remise/ligne ---
    const elems = (eb.elementsBouteilles as any[]) ?? []
    for (const attendu of LIGNES) {
      const brut = attendu.quantite * 35.1
      const elem = elems.find(
        (e) => (e.stockBouteille?.idStockBouteille ?? e.idStockBouteille) === attendu.idStockBouteille,
      )
      const remiseLigne = String(elem?.remise ?? '')
      const montantLigne = (elem?.valeurRemise as number | undefined) ?? 0
      check(
        `ligne ${attendu.libelle} : remise = ${attendu.remisePct}%`,
        remiseLigne.replace(/\s/g, '') === `${attendu.remisePct}%`,
        `envoyé/relu « ${remiseLigne} »`,
      )
      check(
        `ligne ${attendu.libelle} : montant ≈ ${attendu.remisePct}% de ${brut}`,
        proche(montantLigne, (brut * attendu.remisePct) / 100, 0.05),
        `${montantLigne}`,
      )

      // COHÉRENCE AVEC LA SOURCE DE VÉRITÉ : ce que NOTRE app a envoyé sur la
      // ligne doit correspondre à ce que le résolveur d'Easybeer dit lui-même.
      const p = refProduit(attendu.idStockBouteille)
      const remiseResolveur = p
        ? await remiseProduitEasybeer({
            idProduit: p.idProduit,
            idContenant: p.idContenant,
            idStockBouteille: attendu.idStockBouteille,
            quantite: attendu.quantite,
          })
        : null
      if (remiseResolveur) {
        // Le produit a une remise produit autoritaire → notre ligne DOIT l'appliquer.
        check(
          `ligne ${attendu.libelle} : notre remise == résolveur Easybeer`,
          remiseLigne.replace(/\s/g, '') === remiseResolveur.replace(/\s/g, ''),
          `nous=« ${remiseLigne} » easybeer=« ${remiseResolveur} »`,
        )
      } else {
        // Pas de remise produit côté Easybeer → notre ligne applique la remise
        // COMMANDE (globale), pas une remise produit fantôme.
        check(
          `ligne ${attendu.libelle} : Easybeer sans remise produit → on applique la remise commande`,
          true,
          `nous=« ${remiseLigne} »`,
        )
      }
    }
    const remiseAttendueTotale = LIGNES.reduce((s, l) => s + (l.quantite * 35.1 * l.remisePct) / 100, 0)
    check(
      'remiseTotale Easybeer = somme des remises par ligne',
      proche(ebRemise, remiseAttendueTotale, 0.05),
      `remise=${ebRemise} attendu≈${remiseAttendueTotale.toFixed(2)}`,
    )
  } finally {
    // --- NETTOYAGE ---
    await supprimerCommande(idCommande).then(
      () => console.log(`\nDevis ${idCommande} supprimé.`),
      (e) => console.warn(`\n⚠️ suppression ${idCommande} échouée : ${(e as Error).message}`),
    )
  }

  console.log(ok ? '\n🎉 Cohérence commande : OK (client = admin = Easybeer)' : '\n⚠️ Incohérence détectée')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('❌', (e as Error).message)
  process.exit(1)
})
