import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { requireAuth, requireAdmin } from './auth.js'
import { getDb, getAdminAuth } from './firebase.js'
import {
  listeClients,
  getClient,
  listeTypesClient,
  resoudreGrilleRacine,
  listeProduitsAutocomplete,
  enregistrerCommande,
  detailCommande,
  type ProduitAutocomplete,
} from './easybeer.js'

const app = new Hono()

app.use('*', cors({ origin: config.webOrigin, credentials: true }))

app.get('/api/health', (c) => c.json({ ok: true, authDisabled: config.authDisabled }))

/** Profil de l'utilisateur connecté + données client Easybeer + grille tarifaire résolue. */
app.get('/api/me', requireAuth, async (c) => {
  const user = c.get('user')

  // Premier login après invitation : le compte devient actif.
  if (user.status === 'invited') {
    const db = getDb()
    if (db) {
      await db.collection('users').doc(user.uid).set({ status: 'active', activatedAt: Date.now() }, { merge: true })
      user.status = 'active'
    }
  }

  if (user.easybeerIdClient == null) {
    return c.json({ user, client: null, idGrilleTarifaire: null })
  }
  const [client, types] = await Promise.all([getClient(user.easybeerIdClient), listeTypesClient()])
  const idGrilleTarifaire = resoudreGrilleRacine(client?.type?.idClientType, types)
  return c.json({ user, client, idGrilleTarifaire })
})

/** Catalogue commun (produits commandables + dispo). */
app.get('/api/catalogue', requireAuth, async (c) => {
  const produits = await listeProduitsAutocomplete(true)
  return c.json({ produits })
})

/** Créer une proposition de commande => devis Easybeer + trace Firestore. */
app.post('/api/commandes', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.easybeerIdClient == null) return c.json({ error: 'Compte non lié à un client Easybeer' }, 400)

  const body = await c.req.json<{
    commentaire?: string
    estDevis?: boolean
    lignes: { idStockBouteille: number; quantite: number; prixUnitaireHT: number }[]
  }>()
  if (!body.lignes?.length) return c.json({ error: 'Aucune ligne de commande' }, 400)

  // Résolution serveur : client -> grille racine, et produits complets depuis l'autocomplete.
  const [client, types, produits] = await Promise.all([
    getClient(user.easybeerIdClient),
    listeTypesClient(),
    listeProduitsAutocomplete(true),
  ])
  const idGrilleTarifaire = resoudreGrilleRacine(client?.type?.idClientType, types)
  if (idGrilleTarifaire == null) return c.json({ error: 'Grille tarifaire introuvable pour ce client' }, 400)

  const parId = new Map<number, ProduitAutocomplete>(produits.map((p) => [p.idStockBouteille, p]))
  const lignes = body.lignes.map((l) => {
    const produit = parId.get(l.idStockBouteille)
    if (!produit) throw new Error(`Produit ${l.idStockBouteille} introuvable au catalogue`)
    return { produit, quantite: l.quantite, prixUnitaireHT: l.prixUnitaireHT }
  })
  const tauxTVA = lignes[0].produit.tauxTVA ?? {}

  const resultat = await enregistrerCommande({
    idClient: user.easybeerIdClient,
    idGrilleTarifaire,
    tauxTVA,
    commentaire: body.commentaire ?? '',
    estDevis: body.estDevis ?? true,
    lignes,
  })

  // Trace côté Firestore (miroir léger de suivi), si disponible.
  const db = getDb()
  const orderId = randomUUID()
  if (db) {
    await db.collection('orders').doc(orderId).set({
      orderId,
      uid: user.uid,
      easybeerIdClient: user.easybeerIdClient,
      easybeerIdCommande: resultat.id,
      easybeerNumero: resultat.numero,
      statut: 'proposee',
      lignes: body.lignes,
      commentaire: body.commentaire ?? '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }

  return c.json({ ok: true, orderId, easybeer: resultat })
})

/** Liste des commandes de l'utilisateur (Firestore). */
app.get('/api/commandes', requireAuth, async (c) => {
  const user = c.get('user')
  const db = getDb()
  if (!db) return c.json({ commandes: [], note: 'Firestore non configuré (dev).' })
  const snap = await db.collection('orders').where('uid', '==', user.uid).get()
  const commandes = snap.docs.map((d) => d.data()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return c.json({ commandes })
})

/** Détail d'une commande Easybeer (pour le suivi). */
app.get('/api/commandes/:id/easybeer', requireAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const detail = await detailCommande(id)
  return c.json({ detail })
})

// ---- Admin : invitations (flux §5 du brief) ----

/**
 * Liste des clients Easybeer + statut de compte plateforme par client
 * (aucun compte / invited / active — plusieurs comptes possibles par client).
 */
app.get('/api/admin/clients', requireAuth, requireAdmin, async (c) => {
  const page = Number(c.req.query('page') ?? 1)
  const recherche = c.req.query('q') ?? ''
  const res = await listeClients(recherche ? { recherche } : {}, { numeroPage: page, nombreParPage: 25 })

  // Statuts des comptes liés (la collection users reste petite : lecture complète).
  const comptes: Record<number, { statut: 'invited' | 'active'; emails: string[] }> = {}
  const db = getDb()
  if (db) {
    const snap = await db.collection('users').where('easybeerIdClient', '!=', null).get()
    for (const doc of snap.docs) {
      const d = doc.data()
      const id = d.easybeerIdClient as number
      const entry = (comptes[id] ??= { statut: 'invited', emails: [] })
      if (d.email) entry.emails.push(d.email as string)
      if (d.status === 'active') entry.statut = 'active'
    }
  }
  return c.json({ ...res, comptes })
})

/**
 * Invite un client Easybeer : crée le compte Firebase (sans mot de passe),
 * écrit users/{uid} = { easybeerIdClient, role client, status invited } et
 * génère un lien « créez votre mot de passe » (page /activer de l'app).
 * Ré-appelable pour le même email → régénère simplement un lien frais.
 */
app.post('/api/admin/invitations', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  const adminAuth = getAdminAuth()
  if (!db || !adminAuth) return c.json({ error: 'Firebase non configuré' }, 501)

  const body = await c.req.json<{ easybeerIdClient: number; email?: string }>()
  if (!body.easybeerIdClient) return c.json({ error: 'easybeerIdClient requis' }, 400)

  const client = await getClient(body.easybeerIdClient)
  if (!client) return c.json({ error: `Client Easybeer ${body.easybeerIdClient} introuvable` }, 404)

  const email = (body.email ?? client.emailPrincipal ?? '').trim().toLowerCase()
  if (!email) {
    return c.json({ error: "Ce client n'a pas d'email dans Easybeer — saisissez une adresse." }, 400)
  }

  // Compte Firebase : réutilisé s'il existe déjà (ré-invitation), sinon créé
  // sans mot de passe (connexion impossible tant que le lien n'est pas utilisé).
  const existing = await adminAuth.getUserByEmail(email).catch(() => null)
  const uid = existing?.uid ?? (await adminAuth.createUser({ email })).uid

  const prev = (await db.collection('users').doc(uid).get()).data() ?? {}
  await db
    .collection('users')
    .doc(uid)
    .set(
      {
        email,
        easybeerIdClient: body.easybeerIdClient,
        role: prev.role ?? 'client',
        status: prev.status === 'active' ? 'active' : 'invited',
        invitedAt: Date.now(),
        invitedBy: c.get('user').uid,
      },
      { merge: true },
    )

  // Lien Firebase natif → on extrait l'oobCode pour pointer vers NOTRE page
  // /activer (même mécanique en prod, aucune page Firebase hébergée).
  const resetLink = await adminAuth.generatePasswordResetLink(email)
  const oobCode = new URL(resetLink).searchParams.get('oobCode')
  const lien = `${config.invite.baseUrl}?oobCode=${encodeURIComponent(oobCode ?? '')}&email=${encodeURIComponent(email)}`

  // TODO V1 : envoi automatique par email (SMTP_URL) ; en attendant, lien à copier.
  return c.json({
    ok: true,
    email,
    lien,
    dejaActif: prev.status === 'active',
    client: { idClient: client.idClient, nom: client.nom, numero: client.numero },
  })
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[server] GOA Kombucha backend sur http://localhost:${info.port}`)
  if (config.authDisabled) console.log('[server] ⚠️  AUTH_DISABLED=true (dev) — auth court-circuitée.')
})
