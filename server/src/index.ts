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
  listeCommandesRecentes,
  listeCommandesClient,
  listeTournees,
  attribuerTournee,
  enregistrerCommande,
  modifierCommande,
  detailCommande,
  telechargerDocument,
  type ProduitAutocomplete,
} from './easybeer.js'
import { lireCacheClient, lireCatalogue, syncTout } from './sync.js'
import {
  BulkParamsSchema,
  CommandeBodySchema,
  InvitationBodySchema,
  InvitationsBulkSchema,
  OverridePatchSchema,
  parserBody,
} from './schemas.js'
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

/** Normalise l'état Easybeer en { code, libelle, couleur } pour l'affichage. */
function etatAffichage(etat: unknown): { code: string; libelle: string; couleur: string | null } {
  if (typeof etat === 'string') return { code: etat, libelle: etat, couleur: null }
  const e = (etat ?? {}) as { code?: string; libelle?: string; couleur?: string }
  return { code: e.code ?? '', libelle: e.libelle ?? e.code ?? '', couleur: e.couleur ?? null }
}

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

  const parse = parserBody(CommandeBodySchema, await c.req.json().catch(() => null))
  if ('erreur' in parse) return c.json({ error: parse.erreur }, 400)
  const body = parse.data

  const resolution = await resoudreLignes(db, user.easybeerIdClient, body.lignes)
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
      etat: etatAffichage(r.etat),
      modifiable: r.estModifiable ?? !ETATS_NON_MODIFIABLES.has(codeEtat(r.etat)),
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

interface DocumentEasybeer {
  idCommandeDocument?: number
  code?: string
  nomFichierTelechargement?: string
  nomFichier?: string
  annule?: boolean
  type?: { code?: string; libelle?: string }
  dateCreation?: number
}

/** Détail d'une commande pour AFFICHAGE (lignes + documents), tout état. */
app.get('/api/commandes/:id', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.easybeerIdClient == null) return c.json({ error: 'Compte non lié à un client Easybeer' }, 400)
  const idCommande = Number(c.req.param('id'))
  const commande = await chargerCommandeClient(idCommande, user.easybeerIdClient)
  if (!commande) return c.json({ error: 'Commande introuvable' }, 404)

  const lignes = ((commande.elementsBouteilles as Record<string, unknown>[] | undefined) ?? []).map((e) => ({
    designation:
      ((e.stockProduit as { libelle?: string } | undefined)?.libelle as string) ??
      ((e.designation as string) || 'Produit'),
    quantite: e.quantite as number,
    prixUnitaireHT: (e.prixUnitaireHTHorsRemise as number) ?? null,
  }))
  const documents = (((commande.documents as DocumentEasybeer[] | undefined) ?? []) )
    .filter((d) => !d.annule && d.idCommandeDocument != null)
    .map((d) => ({
      idCommandeDocument: d.idCommandeDocument!,
      libelle: d.type?.libelle ?? 'Document',
      code: d.code ?? '',
      nomFichier: d.nomFichierTelechargement || d.nomFichier || `${d.code ?? 'document'}.pdf`,
    }))

  return c.json({
    idCommande,
    numero: commande.numero ?? null,
    reference: commande.reference ?? null,
    totalHT: commande.totalHT ?? null,
    totalTTC: commande.totalTTC ?? null,
    commentaire: (commande.commentaire as string) || '',
    lignes,
    documents,
  })
})

/** Téléchargement d'un document (facture, BL…) — toujours la version à jour d'Easybeer. */
app.get('/api/commandes/:id/documents/:idDoc/pdf', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.easybeerIdClient == null) return c.json({ error: 'Compte non lié à un client Easybeer' }, 400)
  const idCommande = Number(c.req.param('id'))
  const idDoc = Number(c.req.param('idDoc'))

  // Propriété : le document doit appartenir à une commande du client connecté.
  const commande = await chargerCommandeClient(idCommande, user.easybeerIdClient)
  if (!commande) return c.json({ error: 'Commande introuvable' }, 404)
  const doc = ((commande.documents as DocumentEasybeer[] | undefined) ?? []).find(
    (d) => d.idCommandeDocument === idDoc,
  )
  if (!doc) return c.json({ error: 'Document introuvable' }, 404)

  const { corps, contentType } = await telechargerDocument(idDoc)
  const nom = doc.nomFichierTelechargement || 'document.pdf'
  const nomAscii = nom.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  return new Response(corps, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${nomAscii}"; filename*=UTF-8''${encodeURIComponent(nom)}`,
    },
  })
})

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

  const parse = parserBody(CommandeBodySchema, await c.req.json().catch(() => null))
  if ('erreur' in parse) return c.json({ error: parse.erreur }, 400)
  const body = parse.data

  const resolution = await resoudreLignes(db, user.easybeerIdClient, body.lignes)
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
 * Cœur de l'invitation (réutilisé en unitaire et en masse) : crée le compte
 * Firebase (sans mot de passe), écrit users/{uid}, génère un lien « créez
 * votre mot de passe » (page /activer). Idempotent (ré-invitation = lien frais).
 * ⚠️ N'ENVOIE RIEN : l'email partira via SMTP quand il sera configuré (prod).
 */
async function inviterClient(
  db: NonNullable<ReturnType<typeof getDb>>,
  adminAuth: NonNullable<ReturnType<typeof getAdminAuth>>,
  adminUid: string,
  easybeerIdClient: number,
  emailOverride?: string,
): Promise<
  | { ok: true; email: string; lien: string; dejaActif: boolean; client: { idClient?: number; nom?: string; numero?: string } }
  | { ok: false; erreur: string }
> {
  const client = await getClient(easybeerIdClient)
  if (!client) return { ok: false, erreur: `Client Easybeer ${easybeerIdClient} introuvable` }

  const email = (emailOverride ?? client.emailPrincipal ?? '').trim().toLowerCase()
  if (!email) return { ok: false, erreur: `${client.nom ?? easybeerIdClient} : pas d'email dans Easybeer` }

  // Compte Firebase : réutilisé s'il existe déjà (ré-invitation), sinon créé
  // sans mot de passe (connexion impossible tant que le lien n'est pas utilisé).
  const existing = await adminAuth.getUserByEmail(email).catch(() => null)
  const uid = existing?.uid ?? (await adminAuth.createUser({ email })).uid

  const prev = (await db.collection('users').doc(uid).get()).data() ?? {}
  await db.collection('users').doc(uid).set(
    {
      email,
      easybeerIdClient,
      role: prev.role ?? 'client',
      status: prev.status === 'active' ? 'active' : 'invited',
      invitedAt: Date.now(),
      invitedBy: adminUid,
    },
    { merge: true },
  )

  // Lien Firebase natif → on extrait l'oobCode pour pointer vers NOTRE page
  // /activer (même mécanique en prod, aucune page Firebase hébergée).
  const resetLink = await adminAuth.generatePasswordResetLink(email)
  const oobCode = new URL(resetLink).searchParams.get('oobCode')
  const lien = `${config.invite.baseUrl}?oobCode=${encodeURIComponent(oobCode ?? '')}&email=${encodeURIComponent(email)}`

  return {
    ok: true,
    email,
    lien,
    dejaActif: prev.status === 'active',
    client: { idClient: client.idClient, nom: client.nom, numero: client.numero },
  }
}

/** Invitation d'UN client. */
app.post('/api/admin/invitations', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  const adminAuth = getAdminAuth()
  if (!db || !adminAuth) return c.json({ error: 'Firebase non configuré' }, 501)

  const parse = parserBody(InvitationBodySchema, await c.req.json().catch(() => null))
  if ('erreur' in parse) return c.json({ error: parse.erreur }, 400)

  const res = await inviterClient(db, adminAuth, c.get('user').uid, parse.data.easybeerIdClient, parse.data.email)
  if (!res.ok) return c.json({ error: res.erreur }, 400)
  return c.json(res)
})

/**
 * Invitations en MASSE : un lien par client sélectionné. L'email d'invitation
 * sera envoyé automatiquement quand SMTP sera branché ; d'ici là, les liens
 * sont renvoyés à l'admin (copie manuelle).
 */
app.post('/api/admin/invitations/bulk', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  const adminAuth = getAdminAuth()
  if (!db || !adminAuth) return c.json({ error: 'Firebase non configuré' }, 501)

  const parse = parserBody(InvitationsBulkSchema, await c.req.json().catch(() => null))
  if ('erreur' in parse) return c.json({ error: parse.erreur }, 400)

  const adminUid = c.get('user').uid
  const resultats = []
  for (const inv of parse.data.invitations) {
    try {
      const res = await inviterClient(db, adminAuth, adminUid, inv.easybeerIdClient, inv.email)
      resultats.push({ easybeerIdClient: inv.easybeerIdClient, ...res })
    } catch (e) {
      resultats.push({ easybeerIdClient: inv.easybeerIdClient, ok: false as const, erreur: (e as Error).message })
    }
  }
  return c.json({ resultats, reussies: resultats.filter((r) => r.ok).length })
})

/**
 * Fiche client détaillée (admin) : paramètres commerciaux Easybeer +
 * historique de commandes + comptes plateforme liés.
 */
app.get('/api/admin/clients/:id', requireAuth, requireAdmin, async (c) => {
  const idClient = Number(c.req.param('id'))
  if (!Number.isFinite(idClient)) return c.json({ error: 'idClient invalide' }, 400)

  const [client, commandesBrutes] = await Promise.all([getClient(idClient), listeCommandesClient(idClient)])
  if (!client) return c.json({ error: 'Client introuvable' }, 404)

  const ts = (v: unknown) => (v == null ? 0 : new Date(v as string | number).getTime() || 0)
  const commandes = commandesBrutes
    .map((r) => ({
      idCommande: r.idCommande,
      numero: r.numero,
      etat: etatAffichage(r.etat),
      totalTTC: r.totalTTC ?? null,
      dateCreation: ts(r.dateCreation) || null,
    }))
    .sort((a, b) => (b.dateCreation ?? 0) - (a.dateCreation ?? 0))

  const comptes: { email: string; status: string }[] = []
  const db = getDb()
  if (db) {
    const snap = await db.collection('users').where('easybeerIdClient', '==', idClient).get()
    for (const doc of snap.docs) {
      const d = doc.data()
      comptes.push({ email: (d.email as string) ?? '?', status: (d.status as string) ?? 'invited' })
    }
  }

  return c.json({
    client: {
      idClient: client.idClient,
      nom: client.nom ?? null,
      raisonSociale: client.raisonSociale ?? null,
      numero: client.numero ?? null,
      emailPrincipal: client.emailPrincipal ?? null,
      telephonePrincipal: client.telephonePrincipal ?? null,
      adresseFacturation: client.adresse?.complete ?? null,
      adresseLivraison: client.adresseLivraisonDefaut?.complete ?? null,
      categorie: client.type?.libelle ?? null,
      minimumCommande: client.minimumCommande ?? client.minimumCommandeAutorise ?? null,
      fraisLivraisonHT: client.fraisLivraisonHT ?? null,
      remise: client.remise ?? null,
      remise2: client.remise2 ?? null,
      typeRemise2: client.typeRemise2 ?? null,
      nbRemisesCiblees: client.listeRemises?.length ?? 0,
      typeLivraisonFav: client.typeLivraisonFav || null,
      tournee: client.tournee?.libelle ?? null,
      tags: client.tags ?? null,
    },
    commandes,
    comptes,
    easybeerAppUrl: config.easybeer.appUrl,
  })
})

/** Tournées Easybeer (référentiel pour l'attribution en masse). */
app.get('/api/admin/tournees', requireAuth, requireAdmin, async (c) => {
  return c.json({ tournees: await listeTournees() })
})

/**
 * Paramètres clients en MASSE. V1 : attribution de tournée (endpoint bulk
 * natif Easybeer, ✅ validé en réel). Mode de livraison et minimum : à venir
 * (code enum / écriture fiche complète à valider — cf. EASYBEER.md).
 */
app.post('/api/admin/clients/bulk-params', requireAuth, requireAdmin, async (c) => {
  const parse = parserBody(BulkParamsSchema, await c.req.json().catch(() => null))
  if ('erreur' in parse) return c.json({ error: parse.erreur }, 400)
  const { idsClients, idClientTournee } = parse.data

  if (idClientTournee != null) {
    await attribuerTournee(idClientTournee, idsClients)
  }
  return c.json({ ok: true, clients: idsClients.length })
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
  const parse = parserBody(OverridePatchSchema, await c.req.json().catch(() => null))
  if ('erreur' in parse) return c.json({ error: parse.erreur }, 400)
  const override = await majOverride(db, id, parse.data)
  return c.json({ ok: true, override })
})

// ---- Admin : commandes (tous clients) ----

/** Les ~100 commandes les plus récentes de la brasserie (lecture directe Easybeer). */
app.get('/api/admin/commandes', requireAuth, requireAdmin, async (c) => {
  const res = await listeCommandesRecentes(100)
  const ts = (v: unknown) => (v == null ? 0 : new Date(v as string | number).getTime() || 0)
  const commandes = res.commandes.map((r) => ({
    idCommande: r.idCommande,
    numero: r.numero,
    client: r.client
      ? { idClient: r.client.idClient ?? null, nom: r.client.nom ?? null, numero: r.client.numero ?? null }
      : null,
    etat: etatAffichage(r.etat),
    paiement: typeof r.paiementEtat === 'string' ? r.paiementEtat : (r.paiementEtat?.libelle ?? null),
    totalTTC: r.totalTTC ?? null,
    dateCreation: ts(r.dateCreation) || null,
  }))
  return c.json({
    commandes,
    totalElements: res.totalElements,
    easybeerAppUrl: config.easybeer.appUrl,
  })
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
