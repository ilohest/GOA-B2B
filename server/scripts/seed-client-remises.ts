/**
 * Seed d'un CLIENT FICTIF avec des remises (émulateurs uniquement, dev).
 *
 * But : pouvoir se connecter en tant que client qui a des remises encodées et
 * vérifier qu'elles sont visibles au moment de la commande. Aucune écriture
 * Easybeer — on clone le cache du client de dev existant (grille + prix réels
 * résolvables) et on lui ajoute des remises globales.
 *
 * Crée / met à jour :
 *  - Auth : client-remise@goa.local (mot de passe goa-dev-123)
 *  - users/{uid} : role client, easybeerIdClient = ID_FICTIF,
 *    syncEasybeer = false (le client n'existe pas dans Easybeer)
 *  - cacheClients/{ID_FICTIF} : fiche clonée + remise 12% + remise2 5% additionnelle
 *  - cache/clientsListe : entrée ajoutée (visible dans l'admin)
 *
 * Idempotent. Usage : émulateurs démarrés, puis depuis server/ :
 *   npx tsx scripts/seed-client-remises.ts
 */
import { config } from '../src/config.js'
import { getDb, getAdminAuth } from '../src/firebase.js'
import type { CacheClientDoc } from '../src/sync.js'

const PASSWORD = 'goa-dev-123'
const EMAIL = 'client-remise@goa.local'
const ID_FICTIF = 900001
const NOM = 'ZZZ Client Test Remises'

if (!config.firebase.emulators) {
  console.error('[seed-remises] Refusé : FIREBASE_EMULATORS doit être à true — jamais sur un vrai projet.')
  process.exit(1)
}

const auth = getAdminAuth()
const db = getDb()
if (!auth || !db) {
  console.error('[seed-remises] Firebase Admin non initialisé.')
  process.exit(1)
}

// 1) Cloner le cache du client de dev (grille + prix réels), y poser des remises.
const source = (await db.doc(`cacheClients/${config.devEasybeerIdClient}`).get()).data() as
  | CacheClientDoc
  | undefined
if (!source) {
  console.error(
    `[seed-remises] cacheClients/${config.devEasybeerIdClient} introuvable — lance d'abord une synchro admin (bouton « Actualiser depuis Easybeer » du dashboard) pour peupler le cache, puis relance ce script.`,
  )
  process.exit(1)
}

const now = Date.now()
const prixUpdatedAt: Record<string, number> = {}
for (const k of Object.keys(source.prix ?? {})) prixUpdatedAt[k] = now

const doc: CacheClientDoc = {
  client: {
    ...source.client,
    idClient: ID_FICTIF,
    nom: NOM,
    raisonSociale: 'GOA — Compte de test remises',
    numero: 'CL-TEST-REMISE',
    emailPrincipal: EMAIL,
    // Remises encodées : 12 % + 5 % additionnelle (les deux sur la base).
    remise: '12%',
    remise2: '5%',
    typeRemise2: 'ADDITIONNELLE',
    // Pas de contrainte La Poste pour ne pas gêner le test du panier.
    tags: null,
  },
  idGrilleTarifaire: source.idGrilleTarifaire,
  prix: { ...(source.prix ?? {}) },
  prixUpdatedAt,
  syncedAt: now,
}
await db.doc(`cacheClients/${ID_FICTIF}`).set(doc)

// 2) Compte Auth + doc users.
const uid = await auth
  .getUserByEmail(EMAIL)
  .then((u) => u.uid)
  .catch(async () => (await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true })).uid)
await db
  .collection('users')
  .doc(uid)
  .set(
    { email: EMAIL, role: 'client', status: 'active', easybeerIdClient: ID_FICTIF, syncEasybeer: false },
    { merge: true },
  )

// 3) Ajout à la liste clients (écran admin).
const listeRef = db.doc('cache/clientsListe')
const liste = (await listeRef.get()).data() as { clients?: Record<string, unknown>[]; syncedAt?: number } | undefined
const clients = (liste?.clients ?? []).filter((c) => c.idClient !== ID_FICTIF)
clients.push({
  idClient: ID_FICTIF,
  nom: NOM,
  raisonSociale: 'GOA — Compte de test remises',
  numero: 'CL-TEST-REMISE',
  emailPrincipal: EMAIL,
  categorie: source.client.type?.libelle ?? null,
  actif: true,
})
await listeRef.set({ clients, syncedAt: liste?.syncedAt ?? now }, { merge: true })

console.log(`[seed-remises] Client fictif ${ID_FICTIF} « ${NOM} » créé (remise 12% + 5% additionnelle).`)
console.log(`[seed-remises] Connexion : ${EMAIL} / ${PASSWORD}`)
console.log(`[seed-remises] Grille ${doc.idGrilleTarifaire}, ${Object.keys(doc.prix).length} prix perso clonés, type ${source.client.type?.libelle}.`)
process.exit(0)
