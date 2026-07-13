/**
 * Vérif ciblée du cycle de vie des tokens d'invitation contre les émulateurs
 * Firebase (Auth + Firestore) — sans appel Easybeer. Usage : `npx tsx scripts/verify-invitations.ts`.
 */
import { getDb, getAdminAuth } from '../src/firebase.js'
import { lireInvitation, consommerInvitation } from '../src/invitations.js'

const db = getDb()
const auth = getAdminAuth()
if (!db || !auth) throw new Error('Firebase non initialisé (émulateurs ?)')

const COLL = 'invitations'
let ok = true
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`)
  if (!cond) ok = false
}

async function seedToken(token: string, uid: string, email: string, patch: Record<string, unknown> = {}) {
  await db!.collection(COLL).doc(token).set({
    token,
    uid,
    easybeerIdClient: 999999,
    email,
    nom: 'Client Vérif',
    createdAt: Date.now(),
    expiresAt: Date.now() + 14 * 24 * 3600 * 1000,
    usedAt: null,
    revoked: false,
    invitedBy: 'verify',
    ...patch,
  })
}

async function main() {
  const email = `verify-invite-${Date.now()}@example.test`
  const u = await auth!.createUser({ email })
  await db!.collection('users').doc(u.uid).set({ email, easybeerIdClient: 999999, role: 'client', status: 'invited' })

  // 1) Token valide → lecture OK
  const tokValide = `verif-valide-${Date.now()}`
  await seedToken(tokValide, u.uid, email)
  check("token valide → etat 'valide'", (await lireInvitation(db!, tokValide)).etat === 'valide')

  // 2) Consommation → pose le mdp, active le compte, marque utilisé
  const consume = await consommerInvitation(db!, auth!, tokValide, 'motdepasse123')
  check('consommation OK', consume.ok === true)
  const userDoc = (await db!.collection('users').doc(u.uid).get()).data()
  check('compte passé actif', userDoc?.status === 'active')
  check("token consommé → etat 'utilise'", (await lireInvitation(db!, tokValide)).etat === 'utilise')

  // 3) Double consommation refusée (usage unique)
  const rejoue = await consommerInvitation(db!, auth!, tokValide, 'autre123')
  check('re-consommation refusée', rejoue.ok === false)

  // 4) Token expiré
  const tokExpire = `verif-expire-${Date.now()}`
  await seedToken(tokExpire, u.uid, email, { expiresAt: Date.now() - 1000 })
  check("token expiré → etat 'expire'", (await lireInvitation(db!, tokExpire)).etat === 'expire')

  // 5) Token révoqué
  const tokRevoque = `verif-revoque-${Date.now()}`
  await seedToken(tokRevoque, u.uid, email, { revoked: true })
  check("token révoqué → etat 'revoque'", (await lireInvitation(db!, tokRevoque)).etat === 'revoque')

  // 6) Token inconnu
  check("token inconnu → etat 'introuvable'", (await lireInvitation(db!, 'nexiste-pas')).etat === 'introuvable')

  // Nettoyage
  for (const t of [tokValide, tokExpire, tokRevoque]) await db!.collection(COLL).doc(t).delete()
  await db!.collection('users').doc(u.uid).delete()
  await auth!.deleteUser(u.uid)

  console.log(ok ? '\n🎉 Cycle de vie des invitations : OK' : '\n⚠️ Des vérifications ont échoué')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('❌ échec :', e)
  process.exit(1)
})
