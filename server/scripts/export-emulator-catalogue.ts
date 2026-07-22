/**
 * Exporte le catalogue actuellement chargé dans les émulateurs vers une fixture
 * versionnée. Aucun appel Easybeer : ce script ne lit que Firestore et Storage
 * locaux. Usage : émulateurs démarrés, puis `npm run seed:export-catalogue`.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../src/config.js'
import { getBucket, getDb } from '../src/firebase.js'

if (!config.firebase.emulators) {
  throw new Error('Export refusé : FIREBASE_EMULATORS doit être à true.')
}

const db = getDb()
const bucket = getBucket()
if (!db || !bucket) throw new Error('Émulateurs Firebase indisponibles.')

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const photosDir = resolve(fixturesDir, 'catalogue-photos')
await mkdir(photosDir, { recursive: true })

const [catalogue, referentiels, grille, overridesSnap, clientCache] = await Promise.all([
  db.doc('cache/catalogue').get(),
  db.doc('cache/referentiels').get(),
  db.doc('cache/grilleTarifaire').get(),
  db.collection('catalogueOverrides').get(),
  db.doc(`cacheClients/${config.devEasybeerIdClient}`).get(),
])

for (const [nom, snap] of [
  ['catalogue', catalogue],
  ['référentiels', referentiels],
  ['grille tarifaire', grille],
  [`cache client ${config.devEasybeerIdClient}`, clientCache],
] as const) {
  if (!snap.exists) throw new Error(`Impossible d'exporter : ${nom} absent de l'émulateur.`)
}

const photoAssets: Record<string, string> = {}
const overrides: Record<string, Record<string, unknown>> = {}
const assetsDejaEcrits = new Set<string>()

function cheminStorageDepuisUrl(photoUrl: string): string | null {
  const propre = photoUrl.split('?')[0]
  const brouillon = propre.match(/^\/api\/photos\/catalogue-drafts\/(.+)$/)
  if (brouillon) return `produits-drafts/${brouillon[1]}`
  const produit = propre.match(/^\/api\/photos\/produits\/(\d+)$/)
  if (produit) return `produits/${produit[1]}`
  return null
}

for (const doc of overridesSnap.docs) {
  const id = doc.id
  const override = { ...doc.data() } as Record<string, unknown>
  const photoUrl = typeof override.photoUrl === 'string' ? override.photoUrl : ''
  const cheminStorage = photoUrl ? cheminStorageDepuisUrl(photoUrl) : null
  if (cheminStorage) {
    const fichier = bucket.file(cheminStorage)
    const [existe] = await fichier.exists()
    if (!existe) throw new Error(`Photo absente de Storage : ${cheminStorage}`)
    const [[contenu], [metadata]] = await Promise.all([fichier.download(), fichier.getMetadata()])
    const extension = metadata.contentType === 'image/webp' ? 'webp' : metadata.contentType === 'image/jpeg' ? 'jpg' : 'png'
    const nomAsset = `${createHash('sha256').update(contenu).digest('hex').slice(0, 16)}.${extension}`
    if (!assetsDejaEcrits.has(nomAsset)) {
      await writeFile(resolve(photosDir, nomAsset), contenu)
      assetsDejaEcrits.add(nomAsset)
    }
    photoAssets[id] = nomAsset
    override.photoUrl = `/api/photos/produits/${id}?v=seed`
  }
  delete override.updatedAt
  overrides[id] = override
}

const clientCacheData = { ...clientCache.data() } as Record<string, unknown>
const clientData = { ...(clientCacheData.client as Record<string, unknown> | undefined) }
clientCacheData.client = {
  ...clientData,
  nom: 'Client test local',
  raisonSociale: 'Compte de démonstration',
  numero: 'DEV-LOCAL',
  emailPrincipal: 'client@goa.local',
}

const fixture = {
  version: 1,
  exportedAt: new Date().toISOString(),
  devEasybeerIdClient: config.devEasybeerIdClient,
  cache: {
    catalogue: catalogue.data(),
    referentiels: referentiels.data(),
    grilleTarifaire: grille.data(),
  },
  overrides,
  clientCache: clientCacheData,
  photoAssets,
}

await writeFile(resolve(fixturesDir, 'catalogue-seed.json'), `${JSON.stringify(fixture, null, 2)}\n`)
console.log(
  `[seed] Fixture catalogue exportée : ${catalogue.data()?.produits?.length ?? 0} unités, ` +
    `${Object.keys(overrides).length} réglages, ${assetsDejaEcrits.size} photos uniques.`,
)
