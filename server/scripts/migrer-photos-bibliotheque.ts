/**
 * Importe dans la bibliothèque les photos produit antérieures à celle-ci.
 *
 * Avant la bibliothèque, une photo n'existait que rattachée à un produit
 * (`produits/{id}` ou `produits-drafts/{nom}`) : elle s'affiche toujours, mais
 * reste introuvable au moment de choisir une image. Ce script la déclare comme
 * média et fait pointer le produit vers elle.
 *
 * Déduplication par empreinte du contenu : deux formats d'un même goût qui
 * partagent le visuel se retrouvent sur UNE seule image, ce qui est tout
 * l'intérêt d'une bibliothèque.
 *
 * Idempotent : relançable sans créer de doublon. Les anciens fichiers ne sont
 * pas supprimés — on ne casse rien tant que la migration n'est pas vérifiée.
 *
 * Usage : npm run migrer:photos   (ajouter --appliquer pour écrire)
 */
import { createHash, randomBytes } from 'node:crypto'
import { getDb, getBucket } from '../src/firebase.js'
import { config } from '../src/config.js'

const APPLIQUER = process.argv.includes('--appliquer')

const db = getDb()
const bucket = getBucket()
if (!db || !bucket) throw new Error('Firebase non initialisé.')

function formatImageReel(octets: Buffer): { type: string; extension: string } | null {
  if (octets.length < 12) return null
  if (octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return { type: 'image/jpeg', extension: 'jpg' }
  if (octets.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'image/png', extension: 'png' }
  }
  if (octets.subarray(0, 4).toString('ascii') === 'RIFF' && octets.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { type: 'image/webp', extension: 'webp' }
  }
  return null
}

/** Chemin de stockage correspondant à une ancienne URL de photo. */
function cheminAncienneImage(url: string): string | null {
  const draft = url.match(/^\/api\/photos\/catalogue-drafts\/([^?]+)/)
  if (draft) return `produits-drafts/${draft[1]}`
  const produit = url.match(/^\/api\/photos\/produits\/(\d+)/)
  if (produit) return `produits/${produit[1]}`
  return null
}

console.log(`Projet : ${config.firebase.projectId}${APPLIQUER ? '' : '  (simulation — ajouter --appliquer pour écrire)'}\n`)

const overrides = await db.collection('catalogueOverrides').get()

// Empreinte -> média existant, pour ne pas réimporter deux fois la même image.
const parEmpreinte = new Map<string, string>()
const mediaExistants = await db.collection('media').get()
for (const doc of mediaExistants.docs) {
  const donnees = doc.data()
  let empreinte = donnees.empreinte as string | undefined
  if (!empreinte) {
    // Média antérieur à la déduplication : sans empreinte, il serait réimporté
    // en double. On la calcule au passage plutôt que de supposer qu'elle existe.
    const fichier = bucket.file(`media/${doc.id}.${donnees.extension}`)
    const [existe] = await fichier.exists()
    if (!existe) continue
    const [contenu] = await fichier.download()
    empreinte = createHash('sha256').update(contenu).digest('hex')
    if (APPLIQUER) await doc.ref.set({ empreinte }, { merge: true })
    console.log(`  ~ média ${doc.id} : empreinte calculée`)
  }
  parEmpreinte.set(empreinte, doc.id)
}

let importees = 0
let reutilisees = 0
let ignorees = 0
let echecs = 0

for (const doc of overrides.docs) {
  const url = (doc.data().photoUrl as string | undefined)?.trim()
  if (!url) continue
  if (url.startsWith('/api/photos/media/')) {
    ignorees++
    continue
  }
  const chemin = cheminAncienneImage(url)
  if (!chemin) {
    console.log(`  ? ${doc.id} : URL non reconnue (${url.slice(0, 50)}) — laissée telle quelle`)
    ignorees++
    continue
  }

  const fichier = bucket.file(chemin)
  const [existe] = await fichier.exists()
  if (!existe) {
    console.log(`  ✗ ${doc.id} : fichier absent (${chemin})`)
    echecs++
    continue
  }

  const [contenu] = await fichier.download()
  const format = formatImageReel(contenu)
  if (!format) {
    console.log(`  ✗ ${doc.id} : contenu non reconnu comme image (${chemin})`)
    echecs++
    continue
  }

  const empreinte = createHash('sha256').update(contenu).digest('hex')
  let idMedia = parEmpreinte.get(empreinte)

  if (idMedia) {
    reutilisees++
    console.log(`  = ${doc.id} : image identique déjà en bibliothèque (${idMedia})`)
  } else {
    idMedia = randomBytes(12).toString('hex')
    if (APPLIQUER) {
      await bucket.file(`media/${idMedia}.${format.extension}`).save(contenu, {
        contentType: format.type,
        resumable: false,
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
      })
      await db.collection('media').doc(idMedia).set({
        nom: `${doc.id}.${format.extension}`,
        contentType: format.type,
        extension: format.extension,
        taille: contenu.length,
        empreinte,
        creeLe: Date.now(),
        creePar: 'migration',
      })
    }
    parEmpreinte.set(empreinte, idMedia)
    importees++
    console.log(`  + ${doc.id} : importée (${Math.round(contenu.length / 1024)} Ko, ${format.type})`)
  }

  if (APPLIQUER) {
    await doc.ref.set({ photoUrl: `/api/photos/media/${idMedia}` }, { merge: true })
  }
}

// L'agrégat sert les lectures : il doit refléter les nouvelles URL.
if (APPLIQUER && (importees || reutilisees)) {
  const frais = await db.collection('catalogueOverrides').get()
  const agregat = Object.fromEntries(frais.docs.map((d) => [d.id, d.data()]))
  await db.doc('cache/catalogueOverrides').set({ overrides: agregat, syncedAt: Date.now() })
  console.log('\nAgrégat cache/catalogueOverrides reconstruit.')
}

console.log(
  `\n${importees} importée(s), ${reutilisees} déduplication(s), ${ignorees} ignorée(s), ${echecs} échec(s).`,
)
if (!APPLIQUER) console.log('Simulation : rien n’a été écrit. Relancer avec --appliquer.')
