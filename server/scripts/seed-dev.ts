/**
 * Seed des émulateurs Firebase (dev uniquement).
 *
 * Crée deux comptes de test + leurs docs `users/{uid}`, puis restaure le
 * catalogue versionné (cache, prix, réglages et photos) :
 *  - admin@goa.local  (role admin, pas de client Easybeer lié)
 *  - client@goa.local (role client, lié à DEV_EASYBEER_ID_CLIENT)
 *
 * Idempotent : relançable sans erreur (récupère les comptes existants).
 * Usage : émulateurs démarrés, puis `npm run seed` (depuis server/).
 */
import { config } from '../src/config.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb, getAdminAuth, getBucket } from '../src/firebase.js'

const PASSWORD = 'goa-dev-123'

if (!config.firebase.emulators) {
  console.error('[seed] Refusé : FIREBASE_EMULATORS doit être à true — ce script ne doit JAMAIS toucher un vrai projet.')
  process.exit(1)
}

const auth = getAdminAuth()
const db = getDb()
const bucket = getBucket()
if (!auth || !db || !bucket) {
  console.error('[seed] Firebase Admin non initialisé.')
  process.exit(1)
}

interface CatalogueSeed {
  version: number
  devEasybeerIdClient: number
  cache: Record<string, Record<string, unknown>>
  overrides: Record<string, Record<string, unknown>>
  clientCache: Record<string, unknown>
  photoAssets: Record<string, string>
}

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const catalogueSeed = JSON.parse(
  readFileSync(resolve(fixturesDir, 'catalogue-seed.json'), 'utf8'),
) as CatalogueSeed
if (catalogueSeed.version !== 1) {
  throw new Error(`Version de fixture catalogue non prise en charge : ${catalogueSeed.version}.`)
}
if (catalogueSeed.devEasybeerIdClient !== config.devEasybeerIdClient) {
  throw new Error(
    `La fixture catalogue cible le client ${catalogueSeed.devEasybeerIdClient}, ` +
      `mais DEV_EASYBEER_ID_CLIENT vaut ${config.devEasybeerIdClient}.`,
  )
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

const maintenant = Date.now()
const overrides = Object.fromEntries(
  Object.entries(catalogueSeed.overrides).map(([id, override]) => [
    id,
    { ...override, updatedAt: maintenant },
  ]),
)

// Le seed est un instantané déterministe du catalogue de développement. Les
// timestamps sont remis à maintenant pour éviter une resynchronisation Easybeer
// immédiate sur une installation fraîche.
await Promise.all(
  Object.entries(catalogueSeed.cache).map(([id, data]) =>
    db!.doc(`cache/${id}`).set({ ...data, syncedAt: maintenant }),
  ),
)

const anciensOverrides = await db.collection('catalogueOverrides').get()
await Promise.all(anciensOverrides.docs.map((doc) => doc.ref.delete()))
await Promise.all(
  Object.entries(overrides).map(([id, override]) =>
    db!.doc(`catalogueOverrides/${id}`).set(override),
  ),
)
await db.doc('cache/catalogueOverrides').set({ overrides, syncedAt: maintenant })

const prix = (catalogueSeed.clientCache.prix ?? {}) as Record<string, number>
await db.doc(`cacheClients/${config.devEasybeerIdClient}`).set({
  ...catalogueSeed.clientCache,
  prixUpdatedAt: Object.fromEntries(Object.keys(prix).map((id) => [id, maintenant])),
  syncedAt: maintenant,
  clientUpdatedAt: maintenant,
})

await Promise.all(
  Object.entries(catalogueSeed.photoAssets).map(async ([id, nomAsset]) => {
    const contenu = readFileSync(resolve(fixturesDir, 'catalogue-photos', nomAsset))
    const extension = nomAsset.split('.').pop()?.toLowerCase()
    const contentType = extension === 'webp' ? 'image/webp' : extension === 'jpg' ? 'image/jpeg' : 'image/png'
    await bucket.file(`produits/${id}`).save(contenu, {
      contentType,
      resumable: false,
      metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    })
  }),
)

console.log(`[seed] admin@goa.local  → uid ${adminUid} (admin)`)
console.log(`[seed] client@goa.local → uid ${clientUid} (client Easybeer ${config.devEasybeerIdClient})`)
console.log(`[seed] Mot de passe des deux comptes : ${PASSWORD}`)
console.log(
  `[seed] Catalogue local → ${Object.keys(overrides).length} réglages, ` +
    `${Object.keys(catalogueSeed.photoAssets).length} photos produit.`,
)
