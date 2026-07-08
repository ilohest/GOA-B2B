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
  listeCommandesClient,
  enregistrerCommande,
  modifierCommande,
  detailCommande,
  type ProduitAutocomplete,
} from './easybeer.js'
import { lireCacheClient, lireCatalogue, syncTout } from './sync.js'
import {
  catalogueAdmin,
  catalogueClient,
  lireOverrides,
  majOverride,
  normaliserTags,
  pasDeCommande,
} from './catalogue.js'

import { EasybeerBanError } from './easybeer.js'

const app = new Hono()

app.use('*', cors({ origin: config.webOrigin, credentials: true }))

app.onError((err, c) => {
  if (err instanceof EasybeerBanError) {
    return c.json({ error: err.message, retryAfterSeconds: err.retryAfterSeconds }, 503)
  }
  console.error('[server]', err)
  return c.json({ error: err.message || 'Erreur interne' }, 500)
})

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

  const db = getDb()
  if (!db) {
    // Mode dev sans Firebase (AUTH_DISABLED) : lecture directe, jamais en prod.
    const [client, types] = await Promise.all([getClient(user.easybeerIdClient), listeTypesClient()])
    const idGrilleTarifaire = resoudreGrilleRacine(client?.type?.idClientType, types)
    return c.json({ user, client, idGrilleTarifaire })
  }

  // Lecture CACHE (rempli à la volée au premier login) — jamais Easybeer en direct.
  const cache = await lireCacheClient(db, user.easybeerIdClient)
  return c.json({
    user,
    client: cache.client,
    idGrilleTarifaire: cache.idGrilleTarifaire,
    syncedAt: cache.syncedAt,
  })
})

/**
 * Catalogue CLIENT : produits rendus visibles par GOA (overrides) + prix du
 * client connecté. Tout vient du cache — zéro appel Easybeer.
 */
app.get('/api/catalogue', requireAuth, async (c) => {
  const user = c.get('user')
  const db = getDb()
  if (!db) return c.json({ produits: await listeProduitsAutocomplete(true) })

  const [{ produits, syncedAt }, overrides] = await Promise.all([lireCatalogue(db), lireOverrides(db)])
  const cacheClient = user.easybeerIdClient != null ? await lireCacheClient(db, user.easybeerIdClient) : null
  return c.json({
    produits: catalogueClient(produits, overrides, cacheClient?.prix ?? null, cacheClient?.client.tags),
    syncedAt,
  })
})

// ---- Commandes ----

/** États Easybeer au-delà desquels le client ne peut plus modifier (décision §6.3). */
const ETATS_NON_MODIFIABLES = new Set(['LIVREE', 'ANNULEE'])

const codeEtat = (etat: unknown): string =>
  typeof etat === 'string' ? etat : ((etat as { code?: string } | null)?.code ?? '')

/**
 * Résout et valide les lignes d'une commande depuis le CACHE (produits
 * complets, prix du client, visibilité/rupture, minimum). Les prix ne sont
 * JAMAIS pris du client — il n'envoie que des quantités.
 */
async function resoudreLignes(
  db: NonNullable<ReturnType<typeof getDb>>,
  easybeerIdClient: number,
  lignesInput: { idStockBouteille: number; quantite: number }[],
): Promise<
  | { ok: false; erreur: string }
  | {
      ok: true
      lignes: { produit: ProduitAutocomplete; quantite: number; prixUnitaireHT: number }[]
      totalHT: number
      idGrilleTarifaire: number
      tags: string[] | string | null
    }
> {
  const ko = (erreur: string) => ({ ok: false as const, erreur })
  const valides = lignesInput.filter(
    (l) => Number.isInteger(l.quantite) && l.quantite > 0 && Number.isFinite(l.idStockBouteille),
  )
  if (!valides.length) return ko('Aucune ligne de commande valide')

  const [{ produits }, overrides, cacheClient] = await Promise.all([
    lireCatalogue(db),
    lireOverrides(db),
    lireCacheClient(db, easybeerIdClient),
  ])
  if (cacheClient.idGrilleTarifaire == null) return ko('Grille tarifaire introuvable pour ce client')

  const parId = new Map<number, ProduitAutocomplete>(produits.map((p) => [p.idStockBouteille, p]))
  const lignes: { produit: ProduitAutocomplete; quantite: number; prixUnitaireHT: number }[] = []
  for (const l of valides) {
    const produit = parId.get(l.idStockBouteille)
    const override = overrides[String(l.idStockBouteille)]
    if (!produit || !override?.visible) return ko(`Produit ${l.idStockBouteille} indisponible au catalogue`)
    if (override.rupture) return ko(`« ${override.displayName || produit.libelle} » est en rupture`)
    const prixUnitaireHT = cacheClient.prix[String(l.idStockBouteille)]
    if (prixUnitaireHT == null) {
      return ko(`Pas de tarif défini pour « ${override.displayName || produit.libelle} » — contactez GOA`)
    }
    lignes.push({ produit, quantite: l.quantite, prixUnitaireHT })
  }

  // Règle transporteur La Poste (brief §6.3) : gros cartons homogènes →
  // multiples de 3 (35cl) / 2 (1L) pour les clients tagués `laposte`.
  const tags = normaliserTags(cacheClient.client.tags)
  for (const l of lignes) {
    const pas = pasDeCommande(l.produit.libelle, tags)
    if (l.quantite % pas !== 0) {
      return ko(
        `« ${l.produit.libelle} » se commande par multiple de ${pas} (livraison La Poste) — quantité reçue : ${l.quantite}`,
      )
    }
  }

  // Contrôle du minimum de commande (brief §6.3), aussi appliqué côté front.
  const totalHT = lignes.reduce((somme, l) => somme + l.quantite * l.prixUnitaireHT, 0)
  const minimum = cacheClient.client.minimumCommande
  if (minimum != null && totalHT < minimum) {
    return ko(`Minimum de commande : ${minimum.toFixed(2)} € HT (panier : ${totalHT.toFixed(2)} € HT)`)
  }

  return {
    ok: true,
    lignes,
    totalHT,
    idGrilleTarifaire: cacheClient.idGrilleTarifaire,
    tags: cacheClient.client.tags,
  }
}

/** Créer une commande dans Easybeer (recette EASYBEER.md §4). */
app.post('/api/commandes', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.easybeerIdClient == null) return c.json({ error: 'Compte non lié à un client Easybeer' }, 400)
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)

  const body = await c.req.json<{
    commentaire?: string
    lignes: { idStockBouteille: number; quantite: number }[]
  }>()
  const resolution = await resoudreLignes(db, user.easybeerIdClient, body.lignes ?? [])
  if (!resolution.ok) return c.json({ error: resolution.erreur }, 400)
  const { lignes, totalHT, idGrilleTarifaire } = resolution

  const resultat = await enregistrerCommande({
    idClient: user.easybeerIdClient,
    idGrilleTarifaire,
    tauxTVA: lignes[0].produit.tauxTVA ?? {},
    commentaire: body.commentaire?.trim() || 'Commande via la plateforme GOA',
    estDevis: config.commandeEstDevis,
    lignes,
  })

  // Trace Firestore (suivi/debug — la source de vérité reste Easybeer).
  const orderId = randomUUID()
  await db.collection('orders').doc(orderId).set({
    orderId,
    uid: user.uid,
    easybeerIdClient: user.easybeerIdClient,
    easybeerIdCommande: resultat.id,
    easybeerNumero: resultat.numero ?? null,
    estDevis: config.commandeEstDevis,
    totalHT,
    lignes: lignes.map((l) => ({
      idStockBouteille: l.produit.idStockBouteille,
      quantite: l.quantite,
      prixUnitaireHT: l.prixUnitaireHT,
    })),
    commentaire: body.commentaire ?? '',
    createdAt: Date.now(),
  })

  return c.json({ ok: true, orderId, totalHT, easybeer: { id: resultat.id, numero: resultat.numero } })
})

/**
 * Historique des commandes du client, lu en direct d'Easybeer (brief §6.1 —
 * consultation ponctuelle, pas de statut affiché au client).
 */
app.get('/api/commandes', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.easybeerIdClient == null) return c.json({ commandes: [] })
  const resumes = await listeCommandesClient(user.easybeerIdClient)
  // dateCreation Easybeer = epoch millis ou chaîne selon les endpoints → on normalise.
  const ts = (v: unknown) => (v == null ? 0 : new Date(v as string | number).getTime() || 0)
  const commandes = resumes
    .map((r) => ({
      idCommande: r.idCommande,
      numero: r.numero,
      totalTTC: r.totalTTC ?? null,
      totalHT: r.totalHT ?? null,
      dateCreation: ts(r.dateCreation) || null,
      modifiable: !ETATS_NON_MODIFIABLES.has(codeEtat(r.etat)),
    }))
    .sort((a, b) => (b.dateCreation ?? 0) - (a.dateCreation ?? 0))
  return c.json({ commandes })
})

/** Charge une commande pour modification (contrôle propriété + garde-fou statut). */
async function chargerCommandeClient(idCommande: number, easybeerIdClient: number) {
  const commande = await detailCommande(idCommande)
  const proprietaire = (commande.client as { idClient?: number } | undefined)?.idClient
  if (proprietaire !== easybeerIdClient) return null
  return commande
}

/** Détail d'une commande (pré-remplissage du panier pour modification). */
app.get('/api/commandes/:id/edition', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.easybeerIdClient == null) return c.json({ error: 'Compte non lié à un client Easybeer' }, 400)
  const idCommande = Number(c.req.param('id'))
  const commande = await chargerCommandeClient(idCommande, user.easybeerIdClient)
  if (!commande) return c.json({ error: 'Commande introuvable' }, 404)

  const etat = codeEtat(commande.etat)
  const lignes = ((commande.elementsBouteilles as Record<string, unknown>[] | undefined) ?? []).map((e) => ({
    idStockBouteille: (e.stockBouteille as { idStockBouteille?: number })?.idStockBouteille ?? null,
    quantite: e.quantite as number,
  }))
  return c.json({
    idCommande,
    numero: commande.numero ?? null,
    etat,
    modifiable: !ETATS_NON_MODIFIABLES.has(etat),
    commentaire: (commande.commentaire as string) ?? '',
    lignes,
  })
})

/**
 * Modification EN PLACE d'une commande (upsert Easybeer, garde-fou : refusée
 * dès que la commande est LIVREE ou ANNULEE — décision brief §6.3/§9).
 */
app.put('/api/commandes/:id', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.easybeerIdClient == null) return c.json({ error: 'Compte non lié à un client Easybeer' }, 400)
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)

  const idCommande = Number(c.req.param('id'))
  const commande = await chargerCommandeClient(idCommande, user.easybeerIdClient)
  if (!commande) return c.json({ error: 'Commande introuvable' }, 404)
  const etat = codeEtat(commande.etat)
  if (ETATS_NON_MODIFIABLES.has(etat)) {
    return c.json({ error: `Cette commande ne peut plus être modifiée (état : ${etat.toLowerCase()})` }, 409)
  }

  const body = await c.req.json<{
    commentaire?: string
    lignes: { idStockBouteille: number; quantite: number }[]
  }>()
  const resolution = await resoudreLignes(db, user.easybeerIdClient, body.lignes ?? [])
  if (!resolution.ok) return c.json({ error: resolution.erreur }, 400)
  const { lignes, totalHT } = resolution

  const resultat = await modifierCommande({
    idCommande,
    commentaire: body.commentaire?.trim() || 'Commande via la plateforme GOA (modifiée)',
    lignes,
  })

  await db.collection('orders').add({
    uid: user.uid,
    easybeerIdClient: user.easybeerIdClient,
    easybeerIdCommande: idCommande,
    action: 'modification',
    totalHT,
    lignes: lignes.map((l) => ({
      idStockBouteille: l.produit.idStockBouteille,
      quantite: l.quantite,
      prixUnitaireHT: l.prixUnitaireHT,
    })),
    commentaire: body.commentaire ?? '',
    createdAt: Date.now(),
  })

  return c.json({ ok: true, totalHT, easybeer: { id: resultat.id, numero: resultat.numero } })
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

// ---- Admin : gestion du catalogue (visible / nom / photo / rupture) ----

/** Tous les produits Easybeer + overrides, pour l'écran admin catalogue. */
app.get('/api/admin/catalogue', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  return c.json(await catalogueAdmin(db))
})

/** Met à jour l'override d'un produit (champs partiels). */
app.put('/api/admin/catalogue/:idStockBouteille', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  const id = Number(c.req.param('idStockBouteille'))
  if (!Number.isFinite(id)) return c.json({ error: 'idStockBouteille invalide' }, 400)
  const patch = await c.req.json<Record<string, unknown>>()
  const override = await majOverride(db, id, patch)
  return c.json({ ok: true, override })
})

// ---- Admin : synchro du cache ----

/** Dernier rapport de synchro. */
app.get('/api/admin/sync', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  const snap = await db.doc('cache/meta').get()
  return c.json({ dernierSync: snap.data()?.dernierSync ?? null })
})

/** Déclenche une synchro complète Easybeer → cache. */
app.post('/api/admin/sync', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  const report = await syncTout(db)
  return c.json({ ok: true, report })
})

// Synchro périodique optionnelle (SYNC_INTERVAL_MINUTES > 0). En prod, préférer
// Cloud Scheduler → POST /api/admin/sync (étape 9).
if (config.syncIntervalMinutes > 0) {
  setInterval(
    () => {
      const db = getDb()
      if (db) syncTout(db).catch((e) => console.error('[sync] échec :', (e as Error).message))
    },
    config.syncIntervalMinutes * 60_000,
  )
  console.log(`[sync] synchro périodique toutes les ${config.syncIntervalMinutes} min.`)
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[server] GOA Kombucha backend sur http://localhost:${info.port}`)
  if (config.authDisabled) console.log('[server] ⚠️  AUTH_DISABLED=true (dev) — auth court-circuitée.')
})
