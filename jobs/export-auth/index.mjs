/**
 * Sauvegarde hebdomadaire des comptes Firebase Authentication.
 *
 * Les comptes Auth ne sont couverts par aucune sauvegarde Firestore ni par le
 * PITR : ce job est le seul filet de sécurité en cas de suppression accidentelle
 * d'utilisateurs.
 *
 * Le contenu est chiffré avec age (clé publique uniquement, la clé privée reste
 * hors du cloud) et poussé dans un bucket dédié. Le JSON en clair ne touche
 * jamais le disque : il est écrit dans l'entrée standard de age, dont la sortie
 * alimente directement le flux d'envoi vers Cloud Storage.
 */
import { spawn } from 'node:child_process'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Storage } from '@google-cloud/storage'
import { GoogleAuth } from 'google-auth-library'

const projectId = process.env.FIREBASE_PROJECT_ID
const bucketName = process.env.BACKUP_BUCKET
const recipient = process.env.AGE_RECIPIENT

for (const [nom, valeur] of Object.entries({ FIREBASE_PROJECT_ID: projectId, BACKUP_BUCKET: bucketName, AGE_RECIPIENT: recipient })) {
  if (!valeur) {
    console.error(`Variable requise absente : ${nom}`)
    process.exit(1)
  }
}
if (!recipient.startsWith('age1')) {
  console.error("AGE_RECIPIENT ne ressemble pas à une clé publique age (age1...).")
  process.exit(1)
}

initializeApp({ credential: applicationDefault(), projectId })

/** Convertit un UserRecord en entrée acceptée par `firebase auth:import`. */
function versFormatImport(u) {
  const entree = {
    localId: u.uid,
    email: u.email,
    emailVerified: u.emailVerified,
    displayName: u.displayName,
    photoUrl: u.photoURL,
    phoneNumber: u.phoneNumber,
    disabled: u.disabled,
    passwordHash: u.passwordHash,
    salt: u.passwordSalt,
    createdAt: u.metadata?.creationTime ? String(Date.parse(u.metadata.creationTime)) : undefined,
    lastSignedInAt: u.metadata?.lastSignInTime ? String(Date.parse(u.metadata.lastSignInTime)) : undefined,
    customAttributes: u.customClaims && Object.keys(u.customClaims).length ? JSON.stringify(u.customClaims) : undefined,
    providerUserInfo: (u.providerData ?? []).map((p) => ({
      providerId: p.providerId,
      rawId: p.uid,
      email: p.email,
      displayName: p.displayName,
      photoUrl: p.photoURL,
      phoneNumber: p.phoneNumber,
    })),
  }
  return Object.fromEntries(Object.entries(entree).filter(([, v]) => v !== undefined))
}

async function listerTousLesComptes() {
  const comptes = []
  let pageToken
  do {
    const page = await getAuth().listUsers(1000, pageToken)
    comptes.push(...page.users.map((u) => versFormatImport(u.toJSON())))
    pageToken = page.pageToken
  } while (pageToken)
  return comptes
}

/**
 * Paramètres de hachage des mots de passe du projet. Sans eux, un import ne peut
 * pas restaurer les mots de passe : les utilisateurs devraient tous les
 * réinitialiser. Ils font donc partie intégrante de la sauvegarde.
 */
async function lireHashConfig() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  const client = await auth.getClient()
  const { data } = await client.request({
    url: `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`,
    headers: { 'x-goog-user-project': projectId },
  })
  return data?.signIn?.hashConfig ?? null
}

async function main() {
  const comptes = await listerTousLesComptes()
  console.log(`[export-auth] ${comptes.length} compte(s) lus dans ${projectId}`)

  if (comptes.length === 0) {
    // Un export vide ne doit pas venir s'ajouter aux sauvegardes : avant
    // l'ouverture aux clients c'est l'état normal, et plus tard ce serait le
    // signe d'un problème, pas une sauvegarde à conserver.
    console.log('[export-auth] Aucun compte : rien n’est écrit.')
    return
  }

  let hashConfig = null
  try {
    hashConfig = await lireHashConfig()
  } catch (erreur) {
    console.error(`[export-auth] Paramètres de hachage illisibles : ${erreur.message}`)
  }
  if (!hashConfig?.signerKey) {
    // On refuse plutôt que d'écrire une sauvegarde dont les mots de passe
    // seraient irrécupérables sans le dire.
    throw new Error("Paramètres de hachage absents : la sauvegarde ne permettrait pas de restaurer les mots de passe.")
  }

  const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
  const objet = `auth/${projectId}-${horodatage}.json.age`
  const contenu = JSON.stringify({
    exporteLe: new Date().toISOString(),
    projectId,
    hashConfig,
    users: comptes,
  })

  const chiffrement = spawn('age', ['-r', recipient], { stdio: ['pipe', 'pipe', 'inherit'] })
  const fichier = new Storage().bucket(bucketName).file(objet)
  const envoi = fichier.createWriteStream({ resumable: false, contentType: 'application/octet-stream' })

  // On compte les octets au passage plutôt que de relire l'objet : le compte de
  // service n'a volontairement que le droit de déposer, pas celui de lire.
  let octets = 0
  const compteur = new Transform({
    transform(morceau, _encodage, suite) {
      octets += morceau.length
      suite(null, morceau)
    },
  })

  chiffrement.stdin.end(contenu)
  const codeSortie = new Promise((resoudre, rejeter) => {
    chiffrement.on('error', rejeter)
    chiffrement.on('close', (code) => (code === 0 ? resoudre() : rejeter(new Error(`age a échoué (code ${code})`))))
  })

  await Promise.all([pipeline(chiffrement.stdout, compteur, envoi), codeSortie])

  if (octets === 0) throw new Error("Aucun octet envoyé : la sauvegarde serait vide.")
  console.log(`[export-auth] gs://${bucketName}/${objet} — ${octets} octets, ${comptes.length} compte(s).`)
}

main().catch((erreur) => {
  console.error(`[export-auth] Échec : ${erreur.message}`)
  process.exit(1)
})
