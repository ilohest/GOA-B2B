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
  listeDocumentsFacturesRecentes,
  type ProduitAutocomplete,
} from './easybeer.js'
import {
  allegerClient,
  CacheIndisponibleError,
  lireCacheClient,
  lireCatalogue,
  lireCommandesClient as lireCommandesClientCache,
  lireCommandesRecentes,
  lireGrilleTarifaire,
  lireListeClients,
  lireReferentiels,
  lancerSync,
  normaliserEtatCommande,
  rafraichirCatalogue,
  remplirCacheClientCible,
  syncCommandesClient,
  type CacheClientDoc,
  type CommandeClientCache,
} from './sync.js'
import {
  ActivationBodySchema,
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
  grillePrixPourClient,
  lireOverrides,
  majOverride,
  normaliserTags,
  pasDeCommande,
  resoudrePrixUnite,
} from './catalogue.js'
import { creerInvitation, lireInvitation, consommerInvitation } from './invitations.js'
import { emailActif, envoyerInvitationEmail } from './email.js'

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

type RemiseCibleeDetail = {
  produit: string | null
  contenant: string | null
  lot: string | null
  quantite: number | null
  remise: string | null
  type: string | null
  dateDebut: string | null
  dateFin: string | null
  identifiants: string[]
}

function sousObjet(record: Record<string, unknown>, cles: string[]) {
  for (const cle of cles) {
    const valeur = record[cle]
    if (valeur && typeof valeur === 'object') return valeur as Record<string, unknown>
  }
  return null
}

function texteDepuis(record: Record<string, unknown> | null, cles: string[]) {
  if (!record) return null
  for (const cle of cles) {
    const valeur = record[cle]
    if (typeof valeur === 'string' && valeur.trim()) return valeur.trim()
    if (typeof valeur === 'number' && Number.isFinite(valeur)) return String(valeur)
  }
  return null
}

function nombreDepuis(record: Record<string, unknown> | null, cles: string[]) {
  if (!record) return null
  for (const cle of cles) {
    const valeur = record[cle]
    if (typeof valeur === 'number' && Number.isFinite(valeur)) return valeur
    if (typeof valeur === 'string' && valeur.trim() && Number.isFinite(Number(valeur))) return Number(valeur)
  }
  return null
}

function dateIsoDepuis(record: Record<string, unknown>, cles: string[]) {
  for (const cle of cles) {
    const valeur = record[cle]
    if (typeof valeur !== 'string' && typeof valeur !== 'number') continue
    const date = new Date(valeur)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function normaliserRemisesCiblees(remises: Record<string, unknown>[] | undefined): RemiseCibleeDetail[] {
  return (remises ?? []).map((remise) => {
    const produit = sousObjet(remise, ['produit', 'modeleProduit', 'stockProduit'])
    const contenant = sousObjet(remise, ['contenant', 'modeleContenant'])
    const lot = sousObjet(remise, ['lot', 'modeleLot'])
    const stockBouteille = sousObjet(remise, ['stockBouteille', 'modeleStockBouteille'])

    const identifiants = [
      ['idProduit', nombreDepuis(produit, ['idProduit']) ?? nombreDepuis(remise, ['idProduit'])],
      ['idContenant', nombreDepuis(contenant, ['idContenant']) ?? nombreDepuis(remise, ['idContenant'])],
      ['idLot', nombreDepuis(lot, ['idLot']) ?? nombreDepuis(remise, ['idLot'])],
      ['idStockBouteille', nombreDepuis(stockBouteille, ['idStockBouteille']) ?? nombreDepuis(remise, ['idStockBouteille'])],
    ]
      .filter(([, valeur]) => valeur != null)
      .map(([label, valeur]) => `${label} ${valeur}`)

    return {
      produit: texteDepuis(produit, ['libelle', 'nom', 'designation']) ?? texteDepuis(remise, ['produit', 'libelleProduit']),
      contenant: texteDepuis(contenant, ['libelle', 'nom']) ?? texteDepuis(remise, ['contenant', 'libelleContenant']),
      lot: texteDepuis(lot, ['libelle', 'nom']) ?? texteDepuis(remise, ['lot', 'packaging', 'libelleLot']),
      quantite: nombreDepuis(remise, ['quantite', 'quantiteMin', 'minimum']),
      remise: texteDepuis(remise, ['remise', 'valeur', 'montant']),
      type: texteDepuis(remise, ['type', 'typeRemise']),
      dateDebut: dateIsoDepuis(remise, ['dateDebut', 'debut']),
      dateFin: dateIsoDepuis(remise, ['dateFin', 'fin']),
      identifiants,
    }
  })
}

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

  // Lecture CACHE — jamais Easybeer en direct depuis une requête client.
  // Cache absent (compte activé entre deux synchros) : réponse DÉGRADÉE
  // (client null) + remplissage ciblé lancé en tâche de fond (anti-rafale
  // intégré) — le prochain chargement trouvera le cache.
  try {
    const cache = await lireCacheClient(db, user.easybeerIdClient)
    return c.json({
      user,
      client: cache.client,
      idGrilleTarifaire: cache.idGrilleTarifaire,
      syncedAt: cache.syncedAt,
    })
  } catch (e) {
    if (!(e instanceof CacheIndisponibleError)) throw e
    remplirCacheClientCible(db, user.easybeerIdClient).catch((err) =>
      console.warn(`[sync] remplissage ciblé client ${user.easybeerIdClient} : ${(err as Error).message}`),
    )
    return c.json({ user, client: null, idGrilleTarifaire: null, cacheEnPreparation: true })
  }
})

/**
 * Catalogue CLIENT : produits rendus visibles par GOA (overrides) + prix du
 * client connecté. Tout vient du cache — zéro appel Easybeer.
 */
app.get('/api/catalogue', requireAuth, async (c) => {
  const user = c.get('user')
  const db = getDb()
  if (!db) return c.json({ produits: await listeProduitsAutocomplete() })

  const [{ produits, syncedAt }, overrides, grille, types] = await Promise.all([
    lireCatalogue(db),
    lireOverrides(db),
    lireGrilleTarifaire(db),
    lireReferentiels(db).catch(() => []),
  ])
  // Cache client absent → catalogue quand même servi (produits sans prix =
  // « temporairement indisponible » côté client), remplissage en tâche de fond.
  let cacheClient: CacheClientDoc | null = null
  let cacheEnPreparation = false
  if (user.easybeerIdClient != null) {
    try {
      cacheClient = await lireCacheClient(db, user.easybeerIdClient)
    } catch (e) {
      if (!(e instanceof CacheIndisponibleError)) throw e
      cacheEnPreparation = true
      remplirCacheClientCible(db, user.easybeerIdClient).catch(() => {})
    }
  }
  const prixMaxAgeMs = config.cache.prixMaxAgeMinutes * 60_000
  // Prix de base = grille du type du client ; le prix personnalisé (cache client)
  // prime quand il existe. → un produit rendu visible a son prix immédiatement.
  const { prix: grillePrix } = grillePrixPourClient(grille.lignes, cacheClient?.client.type?.idClientType, types)
  const produitsClient = catalogueClient(produits, overrides, {
    prixClient: cacheClient?.prix ?? null,
    prixUpdatedAt: cacheClient?.prixUpdatedAt ?? null,
    grillePrix,
    grilleSyncedAt: grille.syncedAt,
    maxAgeMs: prixMaxAgeMs,
    tagsClient: cacheClient?.client.tags,
  })
  const ages = produitsClient
    .map((p) => (p.prixUpdatedAt == null ? null : Date.now() - p.prixUpdatedAt))
    .filter((age): age is number => age != null)
  return c.json({
    produits: produitsClient,
    syncedAt,
    prixMaxAgeMinutes: config.cache.prixMaxAgeMinutes,
    prixPlusAncienAgeMs: ages.length ? Math.max(...ages) : null,
    cacheEnPreparation,
  })
})

// ---- Commandes ----

/** États Easybeer au-delà desquels le client ne peut plus modifier (décision §6.3). */
const ETATS_NON_MODIFIABLES = new Set(['LIVREE', 'ANNULEE'])

const codeEtat = (etat: unknown): string => normaliserEtatCommande(etat).code

/** Alias local du helper partagé (sync.ts) — même normalisation partout. */
const etatAffichage = normaliserEtatCommande

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

  const [{ produits }, overrides, grille, types] = await Promise.all([
    lireCatalogue(db),
    lireOverrides(db),
    lireGrilleTarifaire(db),
    lireReferentiels(db).catch(() => []),
  ])
  // Cache client absent (compte tout juste activé) : message actionnable
  // plutôt qu'un 503 — et remplissage lancé pour que le retry aboutisse.
  let cacheClient: CacheClientDoc
  try {
    cacheClient = await lireCacheClient(db, easybeerIdClient)
  } catch (e) {
    if (!(e instanceof CacheIndisponibleError)) throw e
    remplirCacheClientCible(db, easybeerIdClient).catch(() => {})
    return ko('Votre compte est en cours de préparation — réessayez dans une minute.')
  }
  if (cacheClient.idGrilleTarifaire == null) return ko('Grille tarifaire introuvable pour ce client')

  // Prix de base = grille du type du client ; le prix personnalisé prime (même
  // résolution que l'affichage → jamais de blocage sur un produit fraîchement
  // rendu visible mais pas encore resynchronisé par client).
  const { prix: grillePrix, idTypeGrille } = grillePrixPourClient(
    grille.lignes,
    cacheClient.client.type?.idClientType,
    types,
  )
  const maxAgeMs = config.cache.prixMaxAgeMinutes * 60_000
  const now = Date.now()

  const parId = new Map<number, ProduitAutocomplete>(produits.map((p) => [p.idStockBouteille, p]))
  const lignes: { produit: ProduitAutocomplete; quantite: number; prixUnitaireHT: number }[] = []
  for (const l of valides) {
    const produit = parId.get(l.idStockBouteille)
    const override = overrides[String(l.idStockBouteille)]
    if (!produit || !override?.visible) return ko(`Produit ${l.idStockBouteille} indisponible au catalogue`)
    if (override.rupture) return ko(`« ${override.displayName || produit.libelle} » est en rupture`)
    const { prixHT, updatedAt } = resoudrePrixUnite(l.idStockBouteille, {
      prixClient: cacheClient.prix,
      prixUpdatedAt: cacheClient.prixUpdatedAt,
      grillePrix,
      grilleSyncedAt: grille.syncedAt,
      maxAgeMs,
      now,
    })
    if (prixHT == null) {
      return ko(`Pas de tarif défini pour « ${override.displayName || produit.libelle} » — contactez GOA`)
    }
    if (updatedAt == null || now - updatedAt > maxAgeMs) {
      const ageTexte = updatedAt == null ? 'inconnu' : `${Math.ceil((now - updatedAt) / 60_000)} min`
      return ko(
        `Tarif en cours de vérification pour « ${override.displayName || produit.libelle} » (âge : ${ageTexte}). Contactez GOA avant de commander.`,
      )
    }
    lignes.push({ produit, quantite: l.quantite, prixUnitaireHT: prixHT })
  }

  // Règle transporteur La Poste (brief §6.3) : gros cartons homogènes →
  // multiples de 3 (35cl) / 2 (1L) pour les clients tagués `laposte`.
  const tags = normaliserTags(cacheClient.client.tags)
  for (const l of lignes) {
    const pas = pasDeCommande(l.produit.libelle, tags)
    if (l.quantite % pas !== 0) {
      return ko(
        `Livraison La Poste : « ${l.produit.libelle} » se commande par cartons complets, par multiple de ${pas} — quantité reçue : ${l.quantite}`,
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
    // Grille du prix réellement appliqué (ex. Distributeur pour un distributeur),
    // pas la racine — cohérence prix ↔ grille sur la commande Easybeer (vérifié
    // 2026-07-14 : les types enfants à grille propre sont acceptés, et Easybeer
    // garde le prix envoyé). Repli sur la racine si aucune grille résolue.
    idGrilleTarifaire: idTypeGrille ?? cacheClient.idGrilleTarifaire,
    tags: cacheClient.client.tags,
  }
}

/** Créer une commande dans Easybeer (recette EASYBEER.md §4). */
/**
 * Relit les totaux RÉELS calculés par Easybeer juste après création/modif
 * (remise client + TVA appliquées — que le total local calculé à partir des
 * tarifs de base ignore). Repli gracieux sur le total local si Easybeer est
 * indisponible : la commande a bien été créée, seul l'affichage du montant
 * exact est reporté à la prochaine synchro.
 */
async function totauxReelsEasybeer(
  idCommande: number,
  totalHTLocal: number,
): Promise<{
  totalHT: number
  totalTTC: number | null
  remiseTotale: number | null
  reels: boolean
}> {
  try {
    const detail = await detailCommande(idCommande)
    const totalHT = detail.totalHT as number | undefined
    return {
      totalHT: totalHT ?? totalHTLocal,
      totalTTC: (detail.totalTTC as number | undefined) ?? null,
      remiseTotale: (detail.remiseTotale as number | undefined) ?? null,
      reels: totalHT != null,
    }
  } catch {
    return { totalHT: totalHTLocal, totalTTC: null, remiseTotale: null, reels: false }
  }
}

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

  // Totaux réels relus d'Easybeer pour l'affichage exact.
  const totaux = await totauxReelsEasybeer(resultat.id!, totalHT)

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
    totalHT: totaux.totalHT,
    totalTTC: totaux.totalTTC,
    dateCreation: Date.now(),
    modifiable: true,
  })

  return c.json({
    ok: true,
    orderId,
    totalHT: totaux.totalHT,
    totalTTC: totaux.totalTTC,
    remiseTotale: totaux.remiseTotale,
    totauxReels: totaux.reels,
    easybeer: { id: resultat.id, numero: resultat.numero },
  })
})

/**
 * Historique des commandes du client depuis le cache alimenté par la synchro.
 * Si le cache n'existe pas encore, on tente un remplissage ciblé et unique pour
 * éviter un bouton client tout en conservant un fallback local si Easybeer bloque.
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
  try {
    const { commandes, syncedAt } = await lireCommandesClientCache(db, user.easybeerIdClient)
    return c.json({ commandes, syncedAt, indisponible: false })
  } catch (e) {
    if (e instanceof CacheIndisponibleError) {
      try {
        const commandes = await syncCommandesClient(db, user.easybeerIdClient)
        return c.json({ commandes, syncedAt: Date.now(), indisponible: false, source: 'easybeer' })
      } catch {
        const commandes = await lireCommandesLocales(db, user.easybeerIdClient)
        return c.json({
          commandes,
          syncedAt: null,
          indisponible: true,
          source: commandes.length ? 'local' : 'aucune',
          code: e.code,
        })
      }
    }
    throw e
  }
})

/**
 * Refresh explicite de l'historique client, utilisé après action admin/debug.
 * La page client standard n'en a pas besoin : elle tente déjà un remplissage
 * ciblé si le cache est absent.
 */
app.post('/api/commandes/sync', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.easybeerIdClient == null) return c.json({ commandes: [] })
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  const commandes = await syncCommandesClient(db, user.easybeerIdClient)
  return c.json({
    commandes,
    syncedAt: Date.now(),
    indisponible: false,
  })
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
  const lignes = ((commande.elementsBouteilles as Record<string, unknown>[] | undefined) ?? []).map((e) => {
    const prixUnitaireHT = (e.prixUnitaireHTHorsRemise as number | undefined) ?? null
    const quantite = (e.quantite as number | undefined) ?? 0
    const totalHT =
      (e.prixTotalHT as number | undefined) ??
      (prixUnitaireHT != null ? prixUnitaireHT * quantite : null)
    return {
      designation:
        ((e.stockProduit as { libelle?: string } | undefined)?.libelle as string) ??
        ((e.designation as string) || 'Produit'),
      quantite,
      prixUnitaireHT,
      totalHT,
    }
  })
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

  // Totaux réels recalculés par Easybeer après la modif.
  const totaux = await totauxReelsEasybeer(idCommande, totalHT)

  await db.collection('orders').add({
    uid: user.uid,
    easybeerIdClient: user.easybeerIdClient,
    easybeerIdCommande: idCommande,
    action: 'modification',
    totalHT: totaux.totalHT,
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
    totalHT: totaux.totalHT,
    totalTTC: totaux.totalTTC ?? (commande.totalTTC as number | undefined) ?? null,
    dateCreation: (commande.dateCreation == null ? Date.now() : new Date(commande.dateCreation as string | number).getTime()) || Date.now(),
    modifiable: true,
  })

  return c.json({
    ok: true,
    totalHT: totaux.totalHT,
    totalTTC: totaux.totalTTC,
    remiseTotale: totaux.remiseTotale,
    totauxReels: totaux.reels,
    easybeer: { id: resultat.id, numero: resultat.numero },
  })
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
 * Cœur de l'invitation (unitaire et en masse) : génère un token d'invitation
 * frais (usage unique, 14 j, cf. invitations.ts) et ENVOIE l'email si le SMTP
 * est configuré. Le lien est toujours renvoyé à l'admin (copie de secours si
 * l'envoi échoue ou est désactivé).
 */
async function inviterEtEnvoyer(
  db: NonNullable<ReturnType<typeof getDb>>,
  adminAuth: NonNullable<ReturnType<typeof getAdminAuth>>,
  adminUid: string,
  easybeerIdClient: number,
  emailOverride?: string,
): Promise<
  | {
      ok: true
      email: string
      lien: string
      envoye: boolean
      erreurEmail?: string
      expiresAt: number
      client: { idClient?: number; nom?: string; numero?: string }
    }
  | { ok: false; erreur: string; dejaActif?: boolean }
> {
  const res = await creerInvitation(db, adminAuth, adminUid, easybeerIdClient, emailOverride)
  if (!res.ok) return res
  const { invitation } = res

  let envoye = false
  let erreurEmail: string | undefined
  if (emailActif()) {
    try {
      await envoyerInvitationEmail({
        nom: invitation.client.nom || invitation.email,
        email: invitation.email,
        lien: invitation.lien,
      })
      envoye = true
    } catch (e) {
      erreurEmail = (e as Error).message
    }
  }

  return {
    ok: true,
    email: invitation.email,
    lien: invitation.lien,
    envoye,
    erreurEmail,
    expiresAt: invitation.expiresAt,
    client: invitation.client,
  }
}

/** Invitation d'UN client (génère le token + envoie l'email). */
app.post('/api/admin/invitations', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  const adminAuth = getAdminAuth()
  if (!db || !adminAuth) return c.json({ error: 'Firebase non configuré' }, 501)

  const parse = parserBody(InvitationBodySchema, await c.req.json().catch(() => null))
  if ('erreur' in parse) return c.json({ error: parse.erreur }, 400)

  const res = await inviterEtEnvoyer(db, adminAuth, c.get('user').uid, parse.data.easybeerIdClient, parse.data.email)
  // Compte déjà actif → 409 (pas de nouveau lien, cf. décision produit).
  if (!res.ok) return c.json({ error: res.erreur, dejaActif: res.dejaActif ?? false }, res.dejaActif ? 409 : 400)
  return c.json(res)
})

/**
 * Invitations en MASSE : un token par client sélectionné, email envoyé si SMTP
 * configuré. Les liens sont renvoyés à l'admin (copie de secours).
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
      const res = await inviterEtEnvoyer(db, adminAuth, adminUid, inv.easybeerIdClient, inv.email)
      resultats.push({ easybeerIdClient: inv.easybeerIdClient, ...res })
    } catch (e) {
      resultats.push({ easybeerIdClient: inv.easybeerIdClient, ok: false as const, erreur: (e as Error).message })
    }
  }
  return c.json({
    resultats,
    reussies: resultats.filter((r) => r.ok).length,
    envoyees: resultats.filter((r) => r.ok && r.envoye).length,
  })
})

// ---- Invitation : parcours PUBLIC du client invité (page /activer) ----

/** État d'un token d'invitation (au chargement de /activer). PUBLIC (pas de session). */
app.get('/api/invitations/:token', async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  return c.json(await lireInvitation(db, c.req.param('token')))
})

/** Consomme le token : pose le mot de passe et active le compte. PUBLIC. */
app.post('/api/invitations/:token/consume', async (c) => {
  const db = getDb()
  const adminAuth = getAdminAuth()
  if (!db || !adminAuth) return c.json({ error: 'Firebase non configuré' }, 501)

  const parse = parserBody(ActivationBodySchema, await c.req.json().catch(() => null))
  if ('erreur' in parse) return c.json({ error: parse.erreur }, 400)

  const res = await consommerInvitation(db, adminAuth, c.req.param('token'), parse.data.password)
  if (!res.ok) return c.json({ error: res.erreur, etat: res.etat }, 400)

  // Prépare le cache du client en tâche de fond (fiche + prix des unités
  // visibles) pour que son premier chargement de boutique ait déjà ses prix,
  // sans attendre la prochaine synchro complète.
  if (res.easybeerIdClient != null) {
    const idClient = res.easybeerIdClient
    remplirCacheClientCible(db, idClient).catch((e) =>
      console.warn(`[sync] remplissage à l'activation (client ${idClient}) : ${(e as Error).message}`),
    )
  }
  return c.json(res)
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
    await db.doc(`cacheClients/${idClient}`).set({ client: allegerClient(client), clientUpdatedAt: Date.now() }, { merge: true })

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
      remisesCiblees: normaliserRemisesCiblees(client.listeRemises),
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

/**
 * Tous les produits Easybeer + overrides, pour l'écran admin catalogue.
 * `?refresh=1` resynchronise UNIQUEMENT le catalogue (produits + types + grille),
 * pas les prix par client (ça, c'est la synchro complète du dashboard).
 */
app.get('/api/admin/catalogue', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  if (c.req.query('refresh') === '1') {
    try {
      await rafraichirCatalogue(db)
    } catch (e) {
      if (!(e instanceof EasybeerBanError)) throw e
      // Ban : on renvoie le cache existant + de quoi armer le compte à rebours UI.
      const data = await catalogueAdmin(db)
      return c.json({ ...data, indisponible: true, retryAfterSeconds: etatBanEasybeer().secondesRestantes })
    }
  }
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
 * Upload de la photo d'un produit (multipart, champ `photo`). Stockée comme
 * brouillon ; l'override n'est mis à jour qu'au clic sur « Enregistrer ».
 */
app.post('/api/admin/catalogue/:idStockBouteille/photo', requireAuth, requireAdmin, async (c) => {
  const bucket = getBucket()
  if (!bucket) return c.json({ error: 'Firebase non configuré' }, 501)
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

  const extension = TYPES_IMAGE.get(photo.type)
  const nomBrouillon = `${id}-${Date.now()}.${extension}`

  await bucket.file(`produits-drafts/${nomBrouillon}`).save(Buffer.from(await photo.arrayBuffer()), {
    contentType: photo.type,
    resumable: false,
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  })

  return c.json({ ok: true, photoUrl: `/api/photos/catalogue-drafts/${nomBrouillon}` })
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

app.get('/api/photos/catalogue-drafts/:nomBrouillon', async (c) => {
  const bucket = getBucket()
  if (!bucket) return c.json({ error: 'Stockage non configuré' }, 501)
  const nomBrouillon = c.req.param('nomBrouillon')
  if (!/^[a-zA-Z0-9.-]+$/.test(nomBrouillon)) return c.json({ error: 'Photo invalide' }, 400)

  const fichier = bucket.file(`produits-drafts/${nomBrouillon}`)
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

const CACHE_FACTURES_COMMANDES_MS = 10 * 60 * 1000

async function facturesCommandesRecentes(db: NonNullable<ReturnType<typeof getDb>>) {
  const ref = db.doc('cache/commandesFactures')
  const snap = await ref.get()
  const cached = snap.data() as
    | { factures?: Record<string, { existe: boolean; numero: string | null }>; syncedAt?: number }
    | undefined

  if (cached?.factures && cached.syncedAt && Date.now() - cached.syncedAt < CACHE_FACTURES_COMMANDES_MS) {
    return cached.factures
  }

  const factures = await listeDocumentsFacturesRecentes(500)
  const parCommande: Record<string, { existe: boolean; numero: string | null }> = {}
  for (const f of factures) {
    if (f.idCommande == null) continue
    parCommande[String(f.idCommande)] = { existe: true, numero: f.code ?? null }
  }
  await ref.set({ factures: parCommande, syncedAt: Date.now() })
  return parCommande
}

/**
 * Les commandes récentes (30 jours par défaut), depuis le CACHE (resynchro via
 * `?refresh=1` ou le job de synchro) — plus d'appel Easybeer par visite.
 */
app.get('/api/admin/commandes', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  const { commandes, syncedAt, indisponible } = await lireCommandesRecentes(db, c.req.query('refresh') === '1')
  let factures: Record<string, { existe: boolean; numero: string | null }> = {}
  try {
    factures = await facturesCommandesRecentes(db)
  } catch {
    // La colonne FA est informative : si Easybeer refuse temporairement la liste
    // documents, on affiche le cache commandes sans bloquer la page.
  }
  return c.json({
    commandes: commandes.map((cmd) => ({
      ...cmd,
      facture: (cmd.idCommande != null ? factures[String(cmd.idCommande)] : undefined) ?? cmd.facture ?? null,
      totalHT: cmd.totalHT ?? (cmd.totalTTC != null ? cmd.totalTTC / 1.055 : null),
    })),
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
    totalHT: number | null
    totalTTC: number | null
    dateCreation: number | null
    etat: { code: string }
  }[]
  const produits = (catalogueSnap.data()?.produits ?? []) as unknown[]

  const depuis30j = Date.now() - 30 * 24 * 3600 * 1000
  const commandes30j = commandes.filter((cmd) => (cmd.dateCreation ?? 0) >= depuis30j && cmd.etat.code !== 'ANNULEE')
  const caHT30j = commandes30j.reduce(
    (somme, cmd) => somme + (cmd.totalHT ?? (cmd.totalTTC != null ? cmd.totalTTC / 1.055 : 0)),
    0,
  )
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
    commandes30j: { nombre: commandes30j.length, caHT: caHT30j, caTTC: caTTC30j },
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

  // Un ban a pu survenir PENDANT la synchro (syncTout le signale sans planter) :
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
