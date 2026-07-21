/**
 * (Re)câble un client Easybeer EXISTANT dans la plateforme (émulateurs) :
 * cache client + compte de connexion + entrée dans la liste admin.
 *
 * Contrairement à `creer-client-test-easybeer.ts`, ce script NE CRÉE PAS de
 * nouveau client dans Easybeer — il réutilise un idClient existant. À lancer
 * après un reset des émulateurs (qui efface le câblage local mais pas Easybeer).
 *
 * 1 seul appel Easybeer (lecture de la fiche). Les remises SEGMENT et le champ
 * `scope` sont posés correctement car on passe les référentiels à allegerClient.
 *
 * Usage : cd server && npx tsx scripts/cabler-client-test.ts [idClient] [email]
 *   défaut : 825435  client-remise-eb@goa.local
 */
import { getClient, resoudreGrilleRacine } from '../src/easybeer.js'
import { allegerClient, lireReferentiels, lireGrilleTarifaire, type CacheClientDoc } from '../src/sync.js'
import { getDb, getAdminAuth } from '../src/firebase.js'
import { config } from '../src/config.js'

const ID_CLIENT = Number(process.argv[2] ?? 825435)
const EMAIL = process.argv[3] ?? 'client-remise-eb@goa.local'
const PASSWORD = 'goa-dev-123'

if (!config.firebase.emulators) {
  console.error('[cabler] Refusé : FIREBASE_EMULATORS doit être à true.')
  process.exit(1)
}

const db = getDb()
const auth = getAdminAuth()
if (!db || !auth) {
  console.error('[cabler] Firebase Admin non initialisé.')
  process.exit(1)
}

const fiche = await getClient(ID_CLIENT)
if (!fiche) {
  console.error(`[cabler] Client ${ID_CLIENT} introuvable dans Easybeer (ban ou id erroné ?).`)
  process.exit(1)
}

const [types, grille] = await Promise.all([lireReferentiels(db), lireGrilleTarifaire(db)])
const client = allegerClient(fiche, types)
const doc: CacheClientDoc = {
  client,
  idGrilleTarifaire: resoudreGrilleRacine(fiche.type?.idClientType ?? undefined, types) ?? null,
  // Prix perso vides : les prix viennent de la GRILLE du type (déjà en cache).
  prix: {},
  prixUpdatedAt: {},
  syncedAt: Date.now(),
}
await db.doc(`cacheClients/${ID_CLIENT}`).set(doc)

const uid = await auth
  .getUserByEmail(EMAIL)
  .then((u) => u.uid)
  .catch(async () => (await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true })).uid)
await db
  .collection('users')
  .doc(uid)
  .set({ email: EMAIL, role: 'client', status: 'active', easybeerIdClient: ID_CLIENT }, { merge: true })

const listeRef = db.doc('cache/clientsListe')
const liste = (await listeRef.get()).data() as { clients?: any[]; syncedAt?: number } | undefined
const clients = (liste?.clients ?? []).filter((c) => c.idClient !== ID_CLIENT)
clients.push({
  idClient: ID_CLIENT,
  nom: client.nom,
  raisonSociale: client.raisonSociale,
  numero: client.numero,
  emailPrincipal: client.emailPrincipal ?? EMAIL,
  categorie: client.type?.libelle ?? null,
  actif: true,
})
await listeRef.set({ clients, syncedAt: liste?.syncedAt ?? Date.now() }, { merge: true })

console.log(`✅ Client ${ID_CLIENT} « ${client.nom} » câblé.`)
console.log(`   connexion : ${EMAIL} / ${PASSWORD}`)
console.log(`   grille ${doc.idGrilleTarifaire} (${grille.lignes.length} lignes) | remise commande : ${client.remise}`)
console.log(`   remisesCiblees : ${JSON.stringify(client.remisesCiblees)}`)
process.exit(0)
