/**
 * Seed des émulateurs Firebase (dev uniquement).
 *
 * Crée deux comptes de test + leurs docs `users/{uid}` :
 *  - admin@goa.local  (role admin, pas de client Easybeer lié)
 *  - client@goa.local (role client, lié à DEV_EASYBEER_ID_CLIENT)
 *
 * Idempotent : relançable sans erreur (récupère les comptes existants).
 * Usage : émulateurs démarrés, puis `npm run seed` (depuis server/).
 */
import { config } from '../src/config.js'
import { getDb, getAdminAuth } from '../src/firebase.js'

const PASSWORD = 'goa-dev-123'

if (!config.firebase.emulators) {
  console.error('[seed] Refusé : FIREBASE_EMULATORS doit être à true — ce script ne doit JAMAIS toucher un vrai projet.')
  process.exit(1)
}

const auth = getAdminAuth()
const db = getDb()
if (!auth || !db) {
  console.error('[seed] Firebase Admin non initialisé.')
  process.exit(1)
}

async function ensureUser(email: string, doc: Record<string, unknown>): Promise<string> {
  const uid = await auth!
    .getUserByEmail(email)
    .then((u) => u.uid)
    .catch(async () => (await auth!.createUser({ email, password: PASSWORD, emailVerified: true })).uid)
  await db!.collection('users').doc(uid).set({ email, ...doc }, { merge: true })
  return uid
}

const adminUid = await ensureUser('admin@goa.local', { role: 'admin', status: 'active' })
const clientUid = await ensureUser('client@goa.local', {
  role: 'client',
  status: 'active',
  easybeerIdClient: config.devEasybeerIdClient,
})

console.log(`[seed] admin@goa.local  → uid ${adminUid} (admin)`)
console.log(`[seed] client@goa.local → uid ${clientUid} (client Easybeer ${config.devEasybeerIdClient})`)
console.log(`[seed] Mot de passe des deux comptes : ${PASSWORD}`)
