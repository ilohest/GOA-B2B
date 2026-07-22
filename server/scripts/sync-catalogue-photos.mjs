/**
 * Synchronise uniquement les photos de la fixture vers des émulateurs Firebase.
 * Les utilisateurs, prix, disponibilités et autres réglages restent inchangés.
 */
import { readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

if (process.env.FIREBASE_EMULATORS !== 'true') {
  throw new Error('Synchronisation refusée : FIREBASE_EMULATORS doit être à true.')
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? 'demo-goa-kombucha'
const app = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` })
const db = getFirestore(app)
const bucket = getStorage(app).bucket()
const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const fixture = JSON.parse(readFileSync(resolve(fixturesDir, 'catalogue-seed.json'), 'utf8'))
const maintenant = Date.now()

function contentType(nomAsset) {
  const extension = extname(nomAsset).toLowerCase()
  if (extension === '.webp') return 'image/webp'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return 'image/png'
}

await Promise.all(
  Object.entries(fixture.photoAssets).map(async ([id, nomAsset]) => {
    const contenu = readFileSync(resolve(fixturesDir, 'catalogue-photos', nomAsset))
    await bucket.file(`produits/${id}`).save(contenu, {
      contentType: contentType(nomAsset),
      resumable: false,
      metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    })
    const version = nomAsset.split('.')[0]
    await db.doc(`catalogueOverrides/${id}`).set(
      { photoUrl: `/api/photos/produits/${id}?v=${version}`, updatedAt: maintenant },
      { merge: true },
    )
  }),
)

const overridesSnap = await db.collection('catalogueOverrides').get()
const overrides = Object.fromEntries(overridesSnap.docs.map((doc) => [doc.id, doc.data()]))
await db.doc('cache/catalogueOverrides').set({ overrides, syncedAt: maintenant })

console.log(
  `[photos] ${Object.keys(fixture.photoAssets).length} références synchronisées ` +
    `(${new Set(Object.values(fixture.photoAssets)).size} images uniques).`,
)
