/**
 * Crée un VRAI client de test DANS EASYBEER (écriture API) avec des remises,
 * puis le câble dans la plateforme (cache Firestore + compte de connexion) pour
 * pouvoir se connecter et vérifier l'affichage des remises au moment de la
 * commande.
 *
 * ⚠️ Écrit dans le compte Easybeer (identifiants d'API de test). Le client est
 * clairement marqué « ZZZ TEST » et N'EST PAS supprimé (persistant, pour tester).
 * Pattern de création repris/validé du banc d'essai (gabarit purgé, cf.
 * banc-essai-clients-test.ts + EASYBEER.md §client/enregistrer).
 *
 * Économe en appels Easybeer (risque de ban) : 3 appels seulement
 * (gabarit + création + relecture). Le cache client est construit À PARTIR DE
 * LA FICHE + de la grille DÉJÀ synchronisée — aucune re-tarification unité par
 * unité (qui, elle, multiplierait les appels).
 *
 * Usage (émulateurs démarrés, cache déjà peuplé par une synchro admin) :
 *   cd server && npx tsx scripts/creer-client-test-easybeer.ts
 */
import { config } from '../src/config.js'
import { getDb, getAdminAuth } from '../src/firebase.js'
import { resoudreGrilleRacine } from '../src/easybeer.js'
import { allegerClient, lireReferentiels, lireGrilleTarifaire } from '../src/sync.js'
import type { CacheClientDoc } from '../src/sync.js'
import type { ModeleClient } from '../src/easybeer.js'

const PASSWORD = 'goa-dev-123'
const EMAIL_CONNEXION = 'client-remise-eb@goa.local'
const NOM = 'ZZZ TEST PLATEFORME REMISES — NE PAS UTILISER'
const REMISE = '12%'
const REMISE2 = '5'
const TYPE_REMISE2 = 'ADDITIONNELLE'

if (!config.firebase.emulators) {
  console.error('[creer-client] Refusé : FIREBASE_EMULATORS doit être à true (le câblage cache/login vise les émulateurs).')
  process.exit(1)
}

const auth = 'Basic ' + Buffer.from(`${config.easybeer.username}:${config.easybeer.password}`).toString('base64')
const delai = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function eb(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  await delai(700) // cadence prudente anti-throttle
  const res = await fetch(`${config.easybeer.target}${path}`, {
    method,
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if ((res.status === 400 && text.includes('banned')) || res.status === 429) {
    throw new Error(`BAN Easybeer pendant ${path} — ${text.slice(0, 120)}`)
  }
  let json: any = {}
  try {
    json = text ? JSON.parse(text.replace(/[\x00-\x1F]/g, ' ')) : {}
  } catch {
    json = { _raw: text.slice(0, 200) }
  }
  return { status: res.status, json }
}

const db = getDb()
const authFb = getAdminAuth()
if (!db || !authFb) {
  console.error('[creer-client] Firebase Admin non initialisé.')
  process.exit(1)
}

// --- 1. Création dans Easybeer (gabarit purgé d'un client réel) ---
console.log('--- 1. Gabarit + création Easybeer ---')
const modele = await eb('GET', `/parametres/client/edition/${config.devEasybeerIdClient}`)
if (!modele.json?.type?.idClientType) {
  throw new Error(`Gabarit ${config.devEasybeerIdClient} illisible (${modele.status}) — ban ou fiche vide ?`)
}

// Gabarit = fiche réelle, débarrassée de tout identifiant et sous-entité pour
// ne rien réattacher (mêmes règles que le banc d'essai validé).
const gabarit = structuredClone(modele.json) as Record<string, unknown>
const CLES_SUPPRIMEES = new Set([
  'numero',
  'listeAdresseLivraison',
  'adresseLivraisonDefaut',
  'listeRemises',
  'listeParticipations',
  'contacts',
  'listeContacts',
  'tournee',
  'commentaires',
  'documents',
])
const purger = (objet: unknown): void => {
  if (Array.isArray(objet)) return objet.forEach(purger)
  if (objet == null || typeof objet !== 'object') return
  const o = objet as Record<string, unknown>
  for (const cle of Object.keys(o)) {
    if ((/^id[A-Z]/.test(cle) && cle !== 'idClientType') || CLES_SUPPRIMEES.has(cle)) delete o[cle]
    else purger(o[cle])
  }
}
purger(gabarit)
gabarit.nom = NOM
gabarit.raisonSociale = 'ZZZ TEST PLATEFORME REMISES'
gabarit.emailPrincipal = EMAIL_CONNEXION
gabarit.commentaire = 'Client fictif de test — remises visibles au panier. Supprimable sans impact.'
// Remises encodées directement sur la fiche (champs scalaires, cf. EASYBEER.md).
gabarit.remise = REMISE
gabarit.remise2 = REMISE2
gabarit.typeRemise2 = TYPE_REMISE2

const creation = await eb('POST', '/parametres/client/enregistrer', gabarit)
console.log('création →', creation.status, JSON.stringify(creation.json).slice(0, 200))
let idClient: number | null = creation.json?.map?.id ?? creation.json?.idClient ?? null
if (idClient == null) {
  const recherche = await eb('POST', '/parametres/client/liste?colonneTri=nom&numeroPage=1&nombreParPage=5', {
    recherche: 'ZZZ TEST PLATEFORME REMISES',
  })
  idClient = recherche.json?.liste?.find((c: any) => c.nom?.startsWith('ZZZ TEST'))?.idClient ?? null
}
if (idClient == null) throw new Error('Création impossible — pas d’idClient renvoyé.')
console.log('→ idClient Easybeer créé :', idClient)

// --- 2. Relecture pour confirmer les remises ---
console.log('\n--- 2. Relecture de la fiche ---')
const relu = await eb('GET', `/parametres/client/edition/${idClient}`)
const fiche = relu.json as ModeleClient
console.log(
  `remise=${JSON.stringify(fiche.remise)} remise2=${JSON.stringify(fiche.remise2)} ` +
    `typeRemise2=${JSON.stringify(fiche.typeRemise2)} type=${fiche.type?.libelle} min=${fiche.minimumCommande}`,
)
if (!fiche.remise && !fiche.remise2) {
  console.warn('⚠️ Aucune remise relue sur la fiche — vérifie dans Easybeer avant de tester.')
}

// --- 3. Câblage plateforme : cache client (grille déjà synchro) + login ---
console.log('\n--- 3. Câblage plateforme (émulateurs) ---')
const [types, grille] = await Promise.all([lireReferentiels(db), lireGrilleTarifaire(db)])
const idGrilleTarifaire = resoudreGrilleRacine(fiche.type?.idClientType ?? undefined, types) ?? null
const now = Date.now()
const doc: CacheClientDoc = {
  client: allegerClient(fiche),
  idGrilleTarifaire,
  // Pas de prix perso : les prix affichés viennent de la GRILLE du type (déjà
  // en cache) via grillePrixPourClient à l'ouverture du catalogue.
  prix: {},
  prixUpdatedAt: {},
  syncedAt: now,
}
await db.doc(`cacheClients/${idClient}`).set(doc)
console.log(`cacheClients/${idClient} écrit (grille ${idGrilleTarifaire}, ${grille.lignes.length} lignes de grille dispo).`)

// Compte de connexion.
const uid = await authFb
  .getUserByEmail(EMAIL_CONNEXION)
  .then((u) => u.uid)
  .catch(async () => (await authFb.createUser({ email: EMAIL_CONNEXION, password: PASSWORD, emailVerified: true })).uid)
await db
  .collection('users')
  .doc(uid)
  .set({ email: EMAIL_CONNEXION, role: 'client', status: 'active', easybeerIdClient: idClient }, { merge: true })

// Liste clients admin.
const listeRef = db.doc('cache/clientsListe')
const liste = (await listeRef.get()).data() as { clients?: any[]; syncedAt?: number } | undefined
const clients = (liste?.clients ?? []).filter((c) => c.idClient !== idClient)
clients.push({
  idClient,
  nom: fiche.nom ?? NOM,
  raisonSociale: fiche.raisonSociale ?? null,
  numero: fiche.numero ?? null,
  emailPrincipal: fiche.emailPrincipal ?? EMAIL_CONNEXION,
  categorie: fiche.type?.libelle ?? null,
  actif: true,
})
await listeRef.set({ clients, syncedAt: liste?.syncedAt ?? now }, { merge: true })

console.log('\n✅ Terminé.')
console.log(`   Client Easybeer : ${idClient} « ${NOM} » (remise ${REMISE} + ${REMISE2}% ${TYPE_REMISE2.toLowerCase()})`)
console.log(`   Connexion plateforme : ${EMAIL_CONNEXION} / ${PASSWORD}`)
console.log(`   Nettoyage plus tard : supprimer le client ${idClient} dans Easybeer + le doc cacheClients/${idClient}.`)
process.exit(0)
