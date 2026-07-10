import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { requireAuth, requireAdmin } from './auth.js'
import { getDb, getAdminAuth, getBucket } from './firebase.js'
import {
  getClient,
  listeTypesClient,
  resoudreGrilleRacine,
  listeProduitsAutocomplete,
  listeCommandesClient,
  listeTournees,
  attribuerTournee,
  attribuerTypeLivraison,
  majMinimumClient,
  CODES_TYPE_LIVRAISON,
  enregistrerCommande,
  modifierCommande,
  detailCommande,
  telechargerDocument,
  type ProduitAutocomplete,
} from './easybeer.js'
import {
  agePrixMs,
  CacheIndisponibleError,
  lireCacheClient,
  lireCatalogue,
  lireCommandesClient as lireCommandesClientCache,
  lireCommandesRecentes,
  lireListeClients,
  lancerSync,
  prixEstFrais,
  syncCommandesClient,
  type CommandeClientCache,
} from './sync.js'
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

import { EasybeerBanError, etatBanEasybeer, surBan, restaurerBan } from './easybeer.js'

const app = new Hono()

app.use('*', cors({ origin: config.webOrigin, credentials: true }))

app.onError((err, c) => {
  if (err instanceof EasybeerBanError) {
    return c.json({ error: err.message, retryAfterSeconds: err.retryAfterSeconds }, 503)
  }
  if (err instanceof CacheIndisponibleError) {
    return c.json({ error: err.message, code: err.code }, 503)
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
  const prixMaxAgeMs = config.cache.prixMaxAgeMinutes * 60_000
  const produitsClient = catalogueClient(
    produits,
    overrides,
    cacheClient?.prix ?? null,
    cacheClient?.client.tags,
    cacheClient?.prixUpdatedAt,
    prixMaxAgeMs,
  )
  const ages = produitsClient
    .map((p) => (p.prixUpdatedAt == null ? null : Date.now() - p.prixUpdatedAt))
    .filter((age): age is number => age != null)
  return c.json({
    produits: produitsClient,
    syncedAt,
    prixMaxAgeMinutes: config.cache.prixMaxAgeMinutes,
    prixPlusAncienAgeMs: ages.length ? Math.max(...ages) : null,
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

async function upsertCommandeClientCache(
  db: NonNullable<ReturnType<typeof getDb>>,
  idClient: number,
  commande: CommandeClientCache,
): Promise<void> {
  const ref = db.doc(`cacheCommandesClients/${idClient}`)
  const snap = await ref.get()
  const data = snap.data() as { commandes?: CommandeClientCache[]; syncedAt?: number } | undefined
  const commandes = [commande, ...(data?.commandes ?? []).filter((c) => c.idCommande !== commande.idCommande)]
    .sort((a, b) => (b.dateCreation ?? 0) - (a.dateCreation ?? 0))
    .slice(0, 200)
  await ref.set({ commandes, syncedAt: data?.syncedAt ?? Date.now(), localUpdatedAt: Date.now() }, { merge: true })
}

async function lireCommandesLocales(
  db: NonNullable<ReturnType<typeof getDb>>,
  idClient: number,
): Promise<CommandeClientCache[]> {
  const snap = await db.collection('orders').where('easybeerIdClient', '==', idClient).get()
  const parCommande = new Map<number, CommandeClientCache>()
  for (const doc of snap.docs) {
    const d = doc.data()
    const idCommande = d.easybeerIdCommande as number | undefined
    if (idCommande == null) continue
    const createdAt = (d.createdAt as number | undefined) ?? 0
    const existante = parCommande.get(idCommande)
    if (existante && (existante.dateCreation ?? 0) >= createdAt) continue
    parCommande.set(idCommande, {
      idCommande,
      numero: (d.easybeerNumero as number | undefined) ?? null,
      etat: {
        code: d.estDevis === false ? 'TRANSMISE' : 'DEVIS',
        libelle: d.estDevis === false ? 'Transmise à GOA' : 'Devis',
        couleur: null,
      },
      totalHT: (d.totalHT as number | undefined) ?? null,
      totalTTC: null,
      dateCreation: createdAt || null,
      modifiable: false,
    })
  }
  return [...parCommande.values()].sort((a, b) => (b.dateCreation ?? 0) - (a.dateCreation ?? 0))
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
    if (!prixEstFrais(cacheClient, l.idStockBouteille, config.cache.prixMaxAgeMinutes * 60_000)) {
      const ageMinutes = agePrixMs(cacheClient, l.idStockBouteille)
      const ageTexte = ageMinutes == null ? 'inconnu' : `${Math.ceil(ageMinutes / 60_000)} min`
      return ko(
        `Tarif en cours de vérification pour « ${override.displayName || produit.libelle} » (âge : ${ageTexte}). Contactez GOA avant de commander.`,
      )
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

  await upsertCommandeClientCache(db, user.easybeerIdClient, {
    idCommande: resultat.id!,
    numero: resultat.numero ?? null,
    etat: {
      code: config.commandeEstDevis ? 'DEVIS' : 'TRANSMISE',
      libelle: config.commandeEstDevis ? 'Devis' : 'Transmise à GOA',
      couleur: null,
    },
    totalHT,
    totalTTC: null,
    dateCreation: Date.now(),
    modifiable: true,
  })

  return c.json({ ok: true, orderId, totalHT, easybeer: { id: resultat.id, numero: resultat.numero } })
})

/**
 * Historique des commandes du client depuis le cache alimenté par la synchro.
 * Une consultation client ne doit pas appeler Easybeer : le rate-limit est trop sensible.
 */
app.get('/api/commandes', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.easybeerIdClient == null) return c.json({ commandes: [] })
  const db = getDb()
  if (!db) {
    const resumes = await listeCommandesClient(user.easybeerIdClient)
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
    return c.json({ commandes, direct: true })
  }
  if (c.req.query('refresh') === '1') {
    const commandes = await syncCommandesClient(db, user.easybeerIdClient)
    return c.json({ commandes, syncedAt: Date.now(), indisponible: false })
  }
  try {
    const { commandes, syncedAt } = await lireCommandesClientCache(db, user.easybeerIdClient)
    return c.json({ commandes, syncedAt, indisponible: false })
  } catch (e) {
    if (e instanceof CacheIndisponibleError) {
      const commandes = await lireCommandesLocales(db, user.easybeerIdClient)
      return c.json({
        commandes,
        syncedAt: null,
        indisponible: true,
        source: commandes.length ? 'local' : 'aucune',
        code: e.code,
      })
    }
    throw e
  }
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

/** Construit le détail d'affichage d'une commande (lignes, totaux, documents). */
function construireDetailCommande(commande: Record<string, unknown>, idCommande: number) {
  const lignes = ((commande.elementsBouteilles as Record<string, unknown>[] | undefined) ?? []).map((e) => ({
    designation:
      ((e.stockProduit as { libelle?: string } | undefined)?.libelle as string) ??
      ((e.designation as string) || 'Produit'),
    quantite: e.quantite as number,
    prixUnitaireHT: (e.prixUnitaireHTHorsRemise as number) ?? null,
  }))
  const documents = ((commande.documents as DocumentEasybeer[] | undefined) ?? [])
    .filter((d) => !d.annule && d.idCommandeDocument != null)
    .map((d) => ({
      idCommandeDocument: d.idCommandeDocument!,
      libelle: d.type?.libelle ?? 'Document',
      code: d.code ?? '',
      nomFichier: d.nomFichierTelechargement || d.nomFichier || `${d.code ?? 'document'}.pdf`,
    }))
  return {
    idCommande,
    numero: commande.numero ?? null,
    reference: commande.reference ?? null,
    etat: etatAffichage(commande.etat),
    totalHT: commande.totalHT ?? null,
    totalTTC: commande.totalTTC ?? null,
    remiseTotale: commande.remiseTotale ?? null,
    totalConsigne: commande.totalConsigne ?? null,
    commentaire: (commande.commentaire as string) || '',
    lignes,
    documents,
  }
}

/** Détail d'une commande pour AFFICHAGE (lignes + documents), tout état. */
app.get('/api/commandes/:id', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.easybeerIdClient == null) return c.json({ error: 'Compte non lié à un client Easybeer' }, 400)
  const idCommande = Number(c.req.param('id'))
  const commande = await chargerCommandeClient(idCommande, user.easybeerIdClient)
  if (!commande) return c.json({ error: 'Commande introuvable' }, 404)
  return c.json(construireDetailCommande(commande, idCommande))
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

  await upsertCommandeClientCache(db, user.easybeerIdClient, {
    idCommande,
    numero: resultat.numero ?? ((commande.numero as number | undefined) ?? null),
    etat: etatAffichage(commande.etat),
    totalHT,
    totalTTC: (commande.totalTTC as number | undefined) ?? null,
    dateCreation: (commande.dateCreation == null ? Date.now() : new Date(commande.dateCreation as string | number).getTime()) || Date.now(),
    modifiable: true,
  })

  return c.json({ ok: true, totalHT, easybeer: { id: resultat.id, numero: resultat.numero } })
})

// ---- Admin : invitations (flux §5 du brief) ----

/** Statuts des comptes plateforme par idClient (collection users, petite). */
async function comptesParClient(): Promise<Record<number, { statut: 'invited' | 'active'; emails: string[] }>> {
  const comptes: Record<number, { statut: 'invited' | 'active'; emails: string[] }> = {}
  const db = getDb()
  if (!db) return comptes
  const snap = await db.collection('users').where('easybeerIdClient', '!=', null).get()
  for (const doc of snap.docs) {
    const d = doc.data()
    const id = d.easybeerIdClient as number
    const entry = (comptes[id] ??= { statut: 'invited', emails: [] })
    if (d.email) entry.emails.push(d.email as string)
    if (d.status === 'active') entry.statut = 'active'
  }
  return comptes
}

/**
 * TOUS les clients (résumés) depuis le CACHE — recherche et pagination se font
 * côté front. `?refresh=1` force une resynchro depuis Easybeer.
 */
app.get('/api/admin/clients', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  const [{ clients, syncedAt, indisponible }, comptes] = await Promise.all([
    lireListeClients(db, c.req.query('refresh') === '1'),
    comptesParClient(),
  ])
  return c.json({
    clients,
    comptes,
    syncedAt,
    indisponible: indisponible ?? false,
    retryAfterSeconds: indisponible ? etatBanEasybeer().secondesRestantes : 0,
  })
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

/** Référentiels pour les paramètres en masse : tournées + modes de livraison validés. */
app.get('/api/admin/tournees', requireAuth, requireAdmin, async (c) => {
  return c.json({
    tournees: await listeTournees(),
    typesLivraison: Object.entries(CODES_TYPE_LIVRAISON).map(([code, libelle]) => ({ code, libelle })),
  })
})

/**
 * Paramètres clients en MASSE (écritures Easybeer validées sur client fictif) :
 * tournée (bulk natif), mode de livraison (bulk natif + relecture de contrôle,
 * échec silencieux possible), minimum HT (fiche par fiche, 2 appels/client).
 */
app.post('/api/admin/clients/bulk-params', requireAuth, requireAdmin, async (c) => {
  const parse = parserBody(BulkParamsSchema, await c.req.json().catch(() => null))
  if ('erreur' in parse) return c.json({ error: parse.erreur }, 400)
  const { idsClients, idClientTournee, typeLivraison, minimumCommande } = parse.data

  if (typeLivraison != null && !(typeLivraison in CODES_TYPE_LIVRAISON)) {
    return c.json({ error: `Mode de livraison inconnu : ${typeLivraison}` }, 400)
  }
  if (minimumCommande != null && idsClients.length > 30) {
    return c.json({ error: 'Minimum en masse : 30 clients maximum par lot (2 appels Easybeer par client)' }, 400)
  }

  const erreurs: string[] = []

  if (idClientTournee != null) {
    await attribuerTournee(idClientTournee, idsClients)
  }

  if (typeLivraison != null) {
    await attribuerTypeLivraison(typeLivraison, idsClients)
    // Relecture de contrôle sur le premier client (échec silencieux documenté).
    const controle = await getClient(idsClients[0])
    if (!controle?.typeLivraisonFav) {
      erreurs.push('Mode de livraison : la relecture de contrôle est vide — vérifier dans Easybeer')
    }
  }

  if (minimumCommande != null) {
    for (const idClient of idsClients) {
      try {
        await majMinimumClient(idClient, minimumCommande)
      } catch (e) {
        erreurs.push(`minimum client ${idClient} : ${(e as Error).message}`)
      }
    }
  }

  // Rafraîchit le cache des clients à compte concernés (minimum affiché côté boutique).
  const db = getDb()
  if (db && (minimumCommande != null || typeLivraison != null)) {
    for (const idClient of idsClients) {
      const ref = db.doc(`cacheClients/${idClient}`)
      if ((await ref.get()).exists) {
        await ref.set(
          {
            client: {
              ...(minimumCommande != null ? { minimumCommande } : {}),
              ...(typeLivraison != null ? { typeLivraisonFav: CODES_TYPE_LIVRAISON[typeLivraison] } : {}),
            },
          },
          { merge: true },
        )
      }
    }
  }

  return c.json({ ok: erreurs.length === 0, clients: idsClients.length, erreurs })
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

// ---- Photos produits (Firebase Storage, servies par le serveur) ----

const TYPES_IMAGE = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])
const TAILLE_MAX_PHOTO = 5 * 1024 * 1024 // 5 Mo

/**
 * Upload de la photo d'un produit (multipart, champ `photo`). Stockée dans
 * Storage sous produits/{idStockBouteille} ; l'override pointe vers notre
 * endpoint de service avec un cache-buster.
 */
app.post('/api/admin/catalogue/:idStockBouteille/photo', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  const bucket = getBucket()
  if (!db || !bucket) return c.json({ error: 'Firebase non configuré' }, 501)
  const id = Number(c.req.param('idStockBouteille'))
  if (!Number.isFinite(id)) return c.json({ error: 'idStockBouteille invalide' }, 400)

  const body = await c.req.parseBody()
  const photo = body.photo
  if (!(photo instanceof File)) return c.json({ error: 'Fichier manquant (champ « photo »)' }, 400)
  if (!TYPES_IMAGE.has(photo.type)) {
    return c.json({ error: 'Format non supporté — utilisez JPEG, PNG ou WebP' }, 400)
  }
  if (photo.size > TAILLE_MAX_PHOTO) {
    return c.json({ error: 'Image trop lourde (5 Mo maximum)' }, 400)
  }

  await bucket.file(`produits/${id}`).save(Buffer.from(await photo.arrayBuffer()), {
    contentType: photo.type,
    resumable: false,
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  })

  const override = await majOverride(db, id, { photoUrl: `/api/photos/produits/${id}?v=${Date.now()}` })
  return c.json({ ok: true, override })
})

/** Retire la photo d'un produit (fichier + override). */
app.delete('/api/admin/catalogue/:idStockBouteille/photo', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  const bucket = getBucket()
  if (!db || !bucket) return c.json({ error: 'Firebase non configuré' }, 501)
  const id = Number(c.req.param('idStockBouteille'))
  if (!Number.isFinite(id)) return c.json({ error: 'idStockBouteille invalide' }, 400)

  await bucket.file(`produits/${id}`).delete({ ignoreNotFound: true })
  const override = await majOverride(db, id, { photoUrl: '' })
  return c.json({ ok: true, override })
})

/**
 * Service PUBLIC des photos produits (les <img> ne portent pas de token ;
 * ce sont des visuels non sensibles). Cache long — l'URL change à chaque
 * upload (cache-buster `v`).
 */
app.get('/api/photos/produits/:idStockBouteille', async (c) => {
  const bucket = getBucket()
  if (!bucket) return c.json({ error: 'Stockage non configuré' }, 501)
  const id = Number(c.req.param('idStockBouteille'))
  if (!Number.isFinite(id)) return c.json({ error: 'id invalide' }, 400)

  const fichier = bucket.file(`produits/${id}`)
  const [existe] = await fichier.exists()
  if (!existe) return c.json({ error: 'Photo introuvable' }, 404)

  const [meta] = await fichier.getMetadata()
  const [contenu] = await fichier.download()
  return new Response(new Uint8Array(contenu), {
    headers: {
      'Content-Type': (meta.contentType as string) ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
})

/** État du rate-limiting Easybeer (pour désactiver les boutons d'actualisation). */
app.get('/api/admin/statut-easybeer', requireAuth, requireAdmin, (c) => c.json(etatBanEasybeer()))

// ---- Admin : commandes (tous clients) ----

/**
 * Les ~200 commandes les plus récentes, depuis le CACHE (resynchro via
 * `?refresh=1` ou le job de synchro) — plus d'appel Easybeer par visite.
 */
app.get('/api/admin/commandes', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  const { commandes, syncedAt, indisponible } = await lireCommandesRecentes(db, c.req.query('refresh') === '1')
  return c.json({
    commandes,
    syncedAt,
    indisponible: indisponible ?? false,
    retryAfterSeconds: indisponible ? etatBanEasybeer().secondesRestantes : 0,
    easybeerAppUrl: config.easybeer.appUrl,
  })
})

/** Détail d'une commande (n'importe laquelle) pour l'admin. */
app.get('/api/admin/commandes/:id', requireAuth, requireAdmin, async (c) => {
  const idCommande = Number(c.req.param('id'))
  if (!Number.isFinite(idCommande)) return c.json({ error: 'idCommande invalide' }, 400)
  const commande = await detailCommande(idCommande)
  if (commande?.idCommande == null) return c.json({ error: 'Commande introuvable' }, 404)
  return c.json(construireDetailCommande(commande, idCommande))
})

/** Téléchargement d'un document de commande (admin, sans contrôle de propriété). */
app.get('/api/admin/commandes/:id/documents/:idDoc/pdf', requireAuth, requireAdmin, async (c) => {
  const idCommande = Number(c.req.param('id'))
  const idDoc = Number(c.req.param('idDoc'))
  const commande = await detailCommande(idCommande)
  const doc = ((commande?.documents as DocumentEasybeer[] | undefined) ?? []).find(
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

/** Statistiques du tableau de bord — 100 % depuis les caches, zéro appel Easybeer. */
app.get('/api/admin/dashboard', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)

  const [clientsSnap, commandesSnap, catalogueSnap, overridesSnap, metaSnap, comptes] = await Promise.all([
    db.doc('cache/clientsListe').get(),
    db.doc('cache/commandesRecentes').get(),
    db.doc('cache/catalogue').get(),
    db.collection('catalogueOverrides').get(),
    db.doc('cache/meta').get(),
    comptesParClient(),
  ])

  const clients = (clientsSnap.data()?.clients ?? []) as { actif: boolean }[]
  const commandes = (commandesSnap.data()?.commandes ?? []) as {
    totalTTC: number | null
    dateCreation: number | null
    etat: { code: string }
  }[]
  const produits = (catalogueSnap.data()?.produits ?? []) as unknown[]

  const depuis30j = Date.now() - 30 * 24 * 3600 * 1000
  const commandes30j = commandes.filter((cmd) => (cmd.dateCreation ?? 0) >= depuis30j && cmd.etat.code !== 'ANNULEE')
  const caTTC30j = commandes30j.reduce((somme, cmd) => somme + (cmd.totalTTC ?? 0), 0)

  const statutsComptes = Object.values(comptes)
  let visibles = 0
  let ruptures = 0
  for (const doc of overridesSnap.docs) {
    const d = doc.data()
    if (d.visible) visibles++
    if (d.visible && d.rupture) ruptures++
  }

  return c.json({
    clients: { total: clients.length, avecCompte: statutsComptes.length, actifs: statutsComptes.filter((s) => s.statut === 'active').length },
    commandes30j: { nombre: commandes30j.length, caTTC: caTTC30j },
    catalogue: { produits: produits.length, visibles, ruptures },
    dernierSync: metaSnap.data()?.dernierSync?.syncedAt ?? null,
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

/** Diagnostic local de la synchro, sans aucun appel Easybeer. */
app.get('/api/admin/sync/status', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)

  const [banSnap, lockSnap, metaSnap] = await Promise.all([
    db.doc('cache/easybeerBan').get(),
    db.doc('cache/lock').get(),
    db.doc('cache/meta').get(),
  ])
  const now = Date.now()
  const persistedUntil = banSnap.data()?.until as number | undefined
  const lockStartedAt = lockSnap.data()?.startedAt as number | undefined | null
  const lockAgeMs = lockStartedAt ? now - lockStartedAt : null

  return c.json({
    now,
    nowIso: new Date(now).toISOString(),
    banMemoire: etatBanEasybeer(),
    banPersiste: persistedUntil
      ? {
          until: persistedUntil,
          untilIso: new Date(persistedUntil).toISOString(),
          secondesRestantes: Math.max(0, Math.ceil((persistedUntil - now) / 1000)),
          actif: persistedUntil > now,
        }
      : null,
    verrou: lockStartedAt
      ? {
          startedAt: lockStartedAt,
          startedAtIso: new Date(lockStartedAt).toISOString(),
          ageMs: lockAgeMs,
          ageMinutes: lockAgeMs == null ? null : Math.round(lockAgeMs / 60_000),
        }
      : null,
    dernierSync: metaSnap.data()?.dernierSync ?? null,
    syncIntervalMinutes: config.syncIntervalMinutes,
  })
})

async function executerSyncCache() {
  const db = getDb()
  if (!db) return { status: 501, body: { error: 'Firebase non configuré' } }

  // Ban connu → on n'attaque pas l'API (sinon on le prolonge) ; compte à rebours côté UI.
  const avant = etatBanEasybeer()
  if (avant.banni) {
    return {
      status: 503,
      body: { error: `API Easybeer saturée — réessayez dans ${avant.secondesRestantes} s`, retryAfterSeconds: avant.secondesRestantes },
    }
  }

  const res = await lancerSync(db)
  if ('enCours' in res) return { status: 409, body: { error: 'Une synchronisation est déjà en cours.' } }

  // Un ban a pu survenir PENDANT la synchro (syncTout le consigne sans planter) :
  // on le remonte pour que l'UI affiche le compte à rebours plutôt qu'un faux succès.
  const apres = etatBanEasybeer()
  if (apres.banni) {
    return {
      status: 503,
      body: { error: `API Easybeer saturée pendant la synchro — réessayez dans ${apres.secondesRestantes} s`, retryAfterSeconds: apres.secondesRestantes },
    }
  }
  return { status: 200, body: { ok: true, report: res.report } }
}

/** Déclenche une synchro complète Easybeer → cache (verrou single-flight). */
app.post('/api/admin/sync', requireAuth, requireAdmin, async (c) => {
  const res = await executerSyncCache()
  return c.json(res.body, res.status as 200 | 409 | 501 | 503)
})

/**
 * Endpoint pour Cloud Scheduler / cron externe. Protégé par un secret serveur,
 * sans dépendre d'une session Firebase admin interactive.
 */
app.post('/api/scheduled/sync', async (c) => {
  if (!config.schedulerSecret) return c.json({ error: 'Scheduler non configuré' }, 501)
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (token !== config.schedulerSecret) return c.json({ error: 'Non autorisé' }, 401)
  const res = await executerSyncCache()
  return c.json(res.body, res.status as 200 | 409 | 501 | 503)
})

// Synchro périodique optionnelle (SYNC_INTERVAL_MINUTES > 0). En prod, préférer
// Cloud Scheduler → POST /api/admin/sync (étape 9). Robuste : ne tape pas
// l'API pendant un ban connu (sinon on le prolonge), et le verrou évite les
// chevauchements.
if (config.syncIntervalMinutes > 0) {
  setInterval(
    async () => {
      const db = getDb()
      if (!db) return
      const ban = etatBanEasybeer()
      if (ban.banni) {
        console.log(`[sync] tick ignoré — ban Easybeer (${ban.secondesRestantes} s restantes).`)
        return
      }
      try {
        const res = await lancerSync(db)
        if ('enCours' in res) console.log('[sync] tick ignoré — synchro déjà en cours.')
      } catch (e) {
        console.error('[sync] échec du tick :', (e as Error).message)
      }
    },
    config.syncIntervalMinutes * 60_000,
  )
  console.log(`[sync] synchro périodique toutes les ${config.syncIntervalMinutes} min (ban-aware, verrouillée).`)
}

// Persistance de l'état du ban Easybeer : on mémorise l'échéance dans Firestore
// à chaque ban, et on la restaure au démarrage — ainsi un redémarrage ne
// re-tape pas l'API pendant un ban (ce qui le prolongerait).
{
  surBan((until) => {
    getDb()?.doc('cache/easybeerBan').set({ until }).catch(() => {})
  })
  const db = getDb()
  if (db) {
    db.doc('cache/easybeerBan')
      .get()
      .then((snap) => {
        const until = snap.data()?.until as number | undefined
        if (until && until > Date.now()) {
          restaurerBan(until)
          console.log(`[easybeer] ban restauré depuis Firestore (${Math.ceil((until - Date.now()) / 1000)} s restantes).`)
        }
      })
      .catch(() => {})
  }
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[server] GOA Kombucha backend sur http://localhost:${info.port}`)
  if (config.authDisabled) console.log('[server] ⚠️  AUTH_DISABLED=true (dev) — auth court-circuitée.')
})
