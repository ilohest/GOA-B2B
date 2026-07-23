import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { randomUUID } from 'node:crypto'
import { config, validerConfigurationProduction } from './config.js'
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
  modeLivraisonCommande,
  enregistrerCommande,
  modifierCommande,
  idStockBouteilleElementCommande,
  detailCommande,
  telechargerDocument,
  type LigneCommandeInput,
  type ProduitAutocomplete,
} from './easybeer.js'
import {
  allegerClient,
  cacheClientDoitEtreRafraichi,
  cacheEstAncien,
  CacheIndisponibleError,
  lireCacheClient,
  lireCatalogue,
  lireCommandesClient as lireCommandesClientCache,
  lireCommandesRecentes,
  lireGrilleTarifaire,
  lireListeClients,
  lireReferentiels,
  lancerSync,
  lancerRafraichissementCatalogue,
  normaliserEtatCommande,
  normaliserTarifsPersonnalises,
  rafraichirCacheClientCible,
  remplirCacheClientCible,
  SYNC_LOCK_TTL_MS,
  typesClientEnCascade,
  type CacheClientDoc,
  type CommandeClientCache,
  type SyncReport,
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
  groupesLivraisonPostaleInvalides,
  grillePrixPourClient,
  lireOverrides,
  majOverride,
  normaliserTags,
  resoudrePrixUnite,
} from './catalogue.js'
import {
  calculerRemisesCommande,
  enrichirLigneAvecRemises,
  lignesSansRemise2,
  lignesSansRemises,
  type RemisesCommandeLocales,
} from './remisesCommande.js'
import { creerInvitation, lireInvitation, consommerInvitation } from './invitations.js'
import { emailActif, envoyerInvitationEmail } from './email.js'
import { cloudTasksConfigure, planifierSynchronisationEasybeer, requeteCloudTasksAutorisee } from './tasks.js'

import { EasybeerBanError, etatBanEasybeer, surBan, restaurerBan } from './easybeer.js'

validerConfigurationProduction()

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

type CachesCatalogue = {
  catalogue: Awaited<ReturnType<typeof lireCatalogue>>
  grille: Awaited<ReturnType<typeof lireGrilleTarifaire>>
  types: Awaited<ReturnType<typeof lireReferentiels>>
  revalidationEnCours: boolean
}

/**
 * Lit le dernier snapshot cohérent disponible. Un cache absent est reconstruit
 * immédiatement ; un cache simplement ancien est servi sans délai puis rafraîchi
 * en arrière-plan (stale-while-revalidate, verrouillé et anti-rafale).
 */
async function lireCachesCatalogueResilients(
  db: NonNullable<ReturnType<typeof getDb>>,
  options: { attendreSiPlusVieuxQueMs?: number } = {},
): Promise<CachesCatalogue> {
  const lire = async (): Promise<Partial<Omit<CachesCatalogue, 'revalidationEnCours'>>> => {
    const [catalogue, grille, types] = await Promise.all([
      lireCatalogue(db).catch(() => null),
      lireGrilleTarifaire(db),
      lireReferentiels(db).catch(() => null),
    ])
    return {
      ...(catalogue ? { catalogue } : {}),
      grille,
      ...(types ? { types } : {}),
    }
  }

  let caches = await lire()
  const incomplet = !caches.catalogue || !caches.types?.length || !caches.grille?.lignes.length
  if (incomplet) {
    // Premier démarrage / cache supprimé : attendre une seule tentative permet
    // d'éviter qu'un client voie un catalogue vide alors qu'Easybeer répond.
    await lancerRafraichissementCatalogue(db, { automatique: true })
    caches = await lire()
  }
  if (!caches.catalogue || !caches.types?.length || !caches.grille?.lignes.length) {
    throw new CacheIndisponibleError(
      'catalogue_cache_incomplet',
      'Le catalogue est en cours de reconstruction — réessayez dans quelques instants.',
    )
  }

  const doitAttendreRevalidation =
    options.attendreSiPlusVieuxQueMs != null &&
    (cacheEstAncien(caches.catalogue?.syncedAt, options.attendreSiPlusVieuxQueMs) ||
      cacheEstAncien(caches.grille?.syncedAt, options.attendreSiPlusVieuxQueMs))
  if (doitAttendreRevalidation) {
    try {
      const resultat = await lancerRafraichissementCatalogue(db, { automatique: true })
      if ('rafraichi' in resultat) caches = await lire()
    } catch (err) {
      console.warn(`[sync] revalidation catalogue avant commande : ${(err as Error).message}`)
    }
  }

  const ageMaxMs = config.cache.catalogueRefreshAgeMinutes * 60_000
  const ageDurMs = config.cache.prixMaxAgeMinutes * 60_000
  const expirationDure =
    cacheEstAncien(caches.catalogue?.syncedAt, ageDurMs) || cacheEstAncien(caches.grille?.syncedAt, ageDurMs)
  if (expirationDure) {
    // Ici le prochain contrôle de commande bloquerait les prix. On attend donc
    // la tentative de réparation au lieu de compter sur une tâche post-réponse.
    try {
      const resultat = await lancerRafraichissementCatalogue(db, { automatique: true })
      if ('rafraichi' in resultat) caches = await lire()
    } catch (err) {
      console.warn(`[sync] réparation catalogue expiré : ${(err as Error).message}`)
    }
  }

  // Une revalidation ne doit jamais dégrader le snapshot complet déjà lu.
  if (!caches.catalogue || !caches.types?.length || !caches.grille?.lignes.length) {
    throw new CacheIndisponibleError('catalogue_cache_incomplet', 'Le catalogue est en cours de reconstruction.')
  }

  const revalidationEnCours =
    cacheEstAncien(caches.catalogue.syncedAt, ageMaxMs) || cacheEstAncien(caches.grille.syncedAt, ageMaxMs)
  if (revalidationEnCours) {
    lancerRafraichissementCatalogue(db, { automatique: true }).catch((err) =>
      console.warn(`[sync] auto-refresh catalogue : ${(err as Error).message}`),
    )
  }
  return { ...(caches as Omit<CachesCatalogue, 'revalidationEnCours'>), revalidationEnCours }
}

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
    if (cache.idGrilleTarifaire == null) {
      remplirCacheClientCible(db, user.easybeerIdClient).catch((err) =>
        console.warn(`[sync] réparation cache client ${user.easybeerIdClient} : ${(err as Error).message}`),
      )
    }
    return c.json({
      user,
      client: cache.client,
      idGrilleTarifaire: cache.idGrilleTarifaire,
      syncedAt: cache.syncedAt,
      cacheEnPreparation: cache.idGrilleTarifaire == null,
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
 * client connecté. La réponse vient du cache ; une revalidation contrôlée peut
 * être déclenchée si celui-ci vieillit.
 */
app.get('/api/catalogue', requireAuth, async (c) => {
  const user = c.get('user')
  const db = getDb()
  if (!db) return c.json({ produits: await listeProduitsAutocomplete() })

  const idsCommande = new Set<number>()
  const idCommandeModification = Number(c.req.query('commande'))
  if (Number.isFinite(idCommandeModification)) {
    if (user.easybeerIdClient == null) return c.json({ error: 'Compte non lié à un client Easybeer' }, 400)
    const commande = await chargerCommandeClient(idCommandeModification, user.easybeerIdClient)
    if (!commande) return c.json({ error: 'Commande introuvable' }, 404)
    for (const element of (commande.elementsBouteilles as Record<string, unknown>[] | undefined) ?? []) {
      const id = idStockBouteilleElementCommande(element)
      if (id != null) idsCommande.add(id)
    }
  }

  const [{ catalogue: catalogueCache, grille, types, revalidationEnCours }, overrides] = await Promise.all([
    lireCachesCatalogueResilients(db, {
      attendreSiPlusVieuxQueMs: config.cache.prixCommandeMaxAgeMinutes * 60_000,
    }),
    lireOverrides(db),
  ])
  const { produits, syncedAt } = catalogueCache
  // Cache client absent → catalogue quand même servi (produits sans prix =
  // « temporairement indisponible » côté client), remplissage en tâche de fond.
  let cacheClient: CacheClientDoc | null = null
  let cacheEnPreparation = false
  if (user.easybeerIdClient != null) {
    try {
      cacheClient = await lireCacheClient(db, user.easybeerIdClient)
      if (cacheClient.idGrilleTarifaire == null) {
        cacheEnPreparation = true
        remplirCacheClientCible(db, user.easybeerIdClient).catch((err) =>
          console.warn(`[sync] réparation cache client ${user.easybeerIdClient} depuis catalogue : ${(err as Error).message}`),
        )
      }
    } catch (e) {
      if (!(e instanceof CacheIndisponibleError)) throw e
      cacheEnPreparation = true
      remplirCacheClientCible(db, user.easybeerIdClient).catch(() => {})
    }
  }
  const prixMaxAgeMs = config.cache.prixMaxAgeMinutes * 60_000
  // Prix de base = grille du type du client ; le prix personnalisé (cache client)
  // prime quand il existe. → un produit rendu visible a son prix immédiatement.
  let { prix: grillePrix } = grillePrixPourClient(grille.lignes, cacheClient?.client.type?.idClientType, types)
  const unitesMeta = Object.fromEntries(
    grille.lignes
      .filter((l) => l.idStockBouteille != null)
      .map((l) => [
        l.idStockBouteille!,
        {
          produit: l.produit ?? null,
          contenant: l.contenant ?? null,
          packaging: l.packaging ?? null,
        },
      ]),
  )
  const construireCatalogueClient = () =>
    catalogueClient(produits, overrides, {
      prixClient: cacheClient?.prix ?? null,
      prixUpdatedAt: cacheClient?.prixUpdatedAt ?? null,
      grillePrix,
      grilleSyncedAt: grille.syncedAt,
      maxAgeMs: prixMaxAgeMs,
      tagsClient: cacheClient?.client.tags,
      unitesMeta,
      idsInclus: idsCommande,
    })
  let produitsClient = construireCatalogueClient()
  let revalidationDemandee = revalidationEnCours

  // Si le client verrait réellement un article sans prix frais, attendre UNE
  // réparation ciblée. Cas normal (cache encore valide) : aucune latence ajoutée.
  if (user.easybeerIdClient != null && cacheClient && produitsClient.some((p) => !p.prixEstFrais)) {
    revalidationDemandee = true
    const repare = await rafraichirCacheClientCible(db, user.easybeerIdClient).catch((err) => {
      console.warn(`[sync] réparation prix expirés client ${user.easybeerIdClient} : ${(err as Error).message}`)
      return null
    })
    if (repare) {
      cacheClient = repare
      grillePrix = grillePrixPourClient(grille.lignes, cacheClient.client.type?.idClientType, types).prix
      produitsClient = construireCatalogueClient()
      revalidationDemandee = produitsClient.some((p) => !p.prixEstFrais)
    }
  } else if (
    user.easybeerIdClient != null &&
    cacheClient &&
    cacheClientDoitEtreRafraichi(
      cacheClient,
      produitsClient.filter((p) => !p.historique).map((p) => p.idStockBouteille),
      config.cache.prixRefreshAgeMinutes * 60_000,
    )
  ) {
    revalidationDemandee = true
    rafraichirCacheClientCible(db, user.easybeerIdClient).catch((err) =>
      console.warn(`[sync] auto-refresh prix client ${user.easybeerIdClient} : ${(err as Error).message}`),
    )
  }
  const ages = produitsClient
    .map((p) => (p.prixUpdatedAt == null ? null : Date.now() - p.prixUpdatedAt))
    .filter((age): age is number => age != null)
  return c.json({
    produits: produitsClient,
    syncedAt,
    prixMaxAgeMinutes: config.cache.prixMaxAgeMinutes,
    prixPlusAncienAgeMs: ages.length ? Math.max(...ages) : null,
    cacheEnPreparation,
    revalidationEnCours: revalidationDemandee,
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

async function retirerCommandeClientCache(
  db: NonNullable<ReturnType<typeof getDb>>,
  idClient: number,
  idCommande: number,
): Promise<void> {
  const ref = db.doc(`cacheCommandesClients/${idClient}`)
  const snap = await ref.get()
  if (!snap.exists) return
  const data = snap.data() as { commandes?: CommandeClientCache[]; syncedAt?: number } | undefined
  const commandes = (data?.commandes ?? []).filter((c) => c.idCommande !== idCommande)
  await ref.set({ commandes, syncedAt: Date.now(), localUpdatedAt: Date.now() }, { merge: true })
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
      etat: etatAffichage(d.easybeerEtat ?? (d.estDevis === false ? 'ENREGISTREE' : 'DEVIS')),
      totalHT: (d.totalHT as number | undefined) ?? null,
      totalTTC: null,
      dateCreation: createdAt || null,
      modifiable: false,
    })
  }
  return [...parCommande.values()].sort((a, b) => (b.dateCreation ?? 0) - (a.dateCreation ?? 0))
}


async function enregistrerCommandeAvecFallback(input: Parameters<typeof enregistrerCommande>[0]) {
  const variantesGrille = [
    input.idGrilleTarifaire,
    input.idGrilleTarifaireFallback ?? input.idGrilleTarifaire,
  ].filter((id, index, ids) => Number.isFinite(id) && ids.indexOf(id) === index)

  let derniereErreur: unknown = null
  for (const idGrilleTarifaire of variantesGrille) {
    const tentative = { ...input, idGrilleTarifaire }
    if (idGrilleTarifaire !== input.idGrilleTarifaire) {
      console.warn(`[commande] retry avec grille racine ${idGrilleTarifaire}`)
    }
    try {
      return await enregistrerCommande(tentative)
    } catch (premiereErreur) {
      if (premiereErreur instanceof EasybeerBanError) throw premiereErreur
      // Un timeout/échec réseau peut arriver APRÈS l'enregistrement côté
      // Easybeer. Ne jamais réémettre automatiquement une création dans ce cas :
      // le résultat est ambigu et un retry pourrait créer un doublon.
      if (
        premiereErreur instanceof TypeError ||
        (premiereErreur instanceof Error && ['TimeoutError', 'AbortError'].includes(premiereErreur.name))
      ) {
        throw new Error(
          'Réponse Easybeer interrompue : la commande a peut-être été créée. Vérifiez votre historique ou contactez GOA avant de réessayer.',
          { cause: premiereErreur },
        )
      }
      derniereErreur = premiereErreur
      console.warn(`[commande] création avec remises refusée, retry sans remise2 : ${(premiereErreur as Error).message}`)
      try {
        return await enregistrerCommande({ ...tentative, lignes: lignesSansRemise2(input.lignes) })
      } catch (deuxiemeErreur) {
        if (deuxiemeErreur instanceof EasybeerBanError) throw deuxiemeErreur
        derniereErreur = deuxiemeErreur
        console.warn(`[commande] création avec remise1 refusée, retry sans remises : ${(deuxiemeErreur as Error).message}`)
        try {
          return await enregistrerCommande({ ...tentative, lignes: lignesSansRemises(input.lignes) })
        } catch (troisiemeErreur) {
          if (troisiemeErreur instanceof EasybeerBanError) throw troisiemeErreur
          derniereErreur = troisiemeErreur
        }
      }
    }
  }
  throw new Error(`Création Easybeer impossible. Dernière erreur : ${(derniereErreur as Error)?.message ?? 'échec inconnu'}`)
}

async function modifierCommandeAvecFallback(input: Parameters<typeof modifierCommande>[0]) {
  try {
    return await modifierCommande(input)
  } catch (premiereErreur) {
    if (premiereErreur instanceof EasybeerBanError) throw premiereErreur
    console.warn(`[commande] modification avec remises refusée, retry sans remise2 : ${(premiereErreur as Error).message}`)
    try {
      return await modifierCommande({ ...input, lignes: lignesSansRemise2(input.lignes) })
    } catch (deuxiemeErreur) {
      if (deuxiemeErreur instanceof EasybeerBanError) throw deuxiemeErreur
      console.warn(`[commande] modification avec remise1 refusée, retry sans remises : ${(deuxiemeErreur as Error).message}`)
      try {
        return await modifierCommande({ ...input, lignes: lignesSansRemises(input.lignes) })
      } catch (troisiemeErreur) {
        if (troisiemeErreur instanceof EasybeerBanError) throw troisiemeErreur
        throw new Error(
          `Modification Easybeer impossible. Dernière erreur : ${(troisiemeErreur as Error).message}`,
        )
      }
    }
  }
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
  quantitesOriginales: Map<number, number> | null = null,
): Promise<
  | { ok: false; erreur: string }
  | {
      ok: true
      lignes: LigneCommandeInput[]
      totalHT: number
      idGrilleTarifaire: number
      idGrilleTarifaireFallback: number
      tags: string[] | string | null
      remisesEstimees: RemisesCommandeLocales
    }
> {
  const ko = (erreur: string) => ({ ok: false as const, erreur })
  const valides = lignesInput.filter(
    (l) => Number.isInteger(l.quantite) && l.quantite > 0 && Number.isFinite(l.idStockBouteille),
  )
  if (!valides.length) return ko('Aucune ligne de commande valide')

  const [{ catalogue: catalogueCache, grille, types }, overrides] = await Promise.all([
    lireCachesCatalogueResilients(db, {
      attendreSiPlusVieuxQueMs: config.cache.prixCommandeMaxAgeMinutes * 60_000,
    }),
    lireOverrides(db),
  ])
  const { produits } = catalogueCache
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

  if (
    cacheClientDoitEtreRafraichi(
      cacheClient,
      valides.map((ligne) => ligne.idStockBouteille),
      config.cache.prixRefreshAgeMinutes * 60_000,
    )
  ) {
    const revalide = await rafraichirCacheClientCible(db, easybeerIdClient).catch((err) => {
      console.warn(`[sync] revalidation prix avant commande ${easybeerIdClient} : ${(err as Error).message}`)
      return null
    })
    if (revalide) cacheClient = revalide
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
  const maxAgeMs = config.cache.prixCommandeMaxAgeMinutes * 60_000
  const now = Date.now()

  const parId = new Map<number, ProduitAutocomplete>(produits.map((p) => [p.idStockBouteille, p]))
  const lignes: LigneCommandeInput[] = []
  for (const l of valides) {
    const produit = parId.get(l.idStockBouteille)
    const override = overrides[String(l.idStockBouteille)]
    const quantiteOriginale = quantitesOriginales?.get(l.idStockBouteille)
    const ligneHistorique = quantiteOriginale != null
    if (!produit || (!override?.visible && !ligneHistorique)) {
      return ko(`Produit ${l.idStockBouteille} indisponible au catalogue`)
    }
    if ((!override?.visible || override.rupture) && ligneHistorique && l.quantite > quantiteOriginale) {
      return ko(`La quantité de « ${override?.displayName || produit.libelle} » ne peut pas être augmentée`)
    }
    if (override?.rupture && !ligneHistorique) return ko(`« ${override.displayName || produit.libelle} » est en rupture`)
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

  // Règle transporteur La Poste : les goûts peuvent être mélangés. Le total
  // est contrôlé par groupe de contenant + packaging.
  const tags = normaliserTags(cacheClient.client.tags)
  const metaParId = new Map(
    grille.lignes
      .filter((ligne) => ligne.idStockBouteille != null)
      .map((ligne) => [ligne.idStockBouteille!, ligne]),
  )
  const groupesPostauxInvalides = groupesLivraisonPostaleInvalides(
    lignes.map((ligne) => {
      const meta = metaParId.get(ligne.produit.idStockBouteille)
      return {
        quantite: ligne.quantite,
        contenant: meta?.contenant ?? ligne.produit.libelle,
        packaging: meta?.packaging ?? `Produit ${ligne.produit.idStockBouteille}`,
      }
    }),
    tags,
  )
  if (groupesPostauxInvalides.length) {
    const groupe = groupesPostauxInvalides[0]
    return ko(
      `Livraison La Poste : le format « ${groupe.contenant} · ${groupe.packaging} » doit totaliser un multiple de ${groupe.multiple} cartons, tous goûts confondus (actuellement ${groupe.quantite}).`,
    )
  }

  // Contrôle du minimum de commande (brief §6.3), aussi appliqué côté front.
  const totalHT = lignes.reduce((somme, l) => somme + l.quantite * l.prixUnitaireHT, 0)
  const minimum = cacheClient.client.minimumCommande
  if (minimum != null && totalHT < minimum) {
    return ko(`Minimum de commande : ${minimum.toFixed(2)} € HT (panier : ${totalHT.toFixed(2)} € HT)`)
  }

  const lignesAvecRemises = lignes.map((ligne) => enrichirLigneAvecRemises(ligne, cacheClient.client))

  return {
    ok: true,
    lignes: lignesAvecRemises,
    totalHT,
    // Grille du prix réellement appliqué (ex. Distributeur pour un distributeur),
    // pas la racine — cohérence prix ↔ grille sur la commande Easybeer (vérifié
    // 2026-07-14 : les types enfants à grille propre sont acceptés, et Easybeer
    // garde le prix envoyé). Repli sur la racine si aucune grille résolue.
    idGrilleTarifaire: idTypeGrille ?? cacheClient.idGrilleTarifaire,
    idGrilleTarifaireFallback: cacheClient.idGrilleTarifaire,
    tags: cacheClient.client.tags,
    remisesEstimees: calculerRemisesCommande(lignes, cacheClient.client),
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
  etat: unknown | null
  reels: boolean
}> {
  try {
    const detail = await detailCommande(idCommande)
    const totalHT = detail.totalHT as number | undefined
    return {
      totalHT: totalHT ?? totalHTLocal,
      totalTTC: (detail.totalTTC as number | undefined) ?? null,
      remiseTotale: (detail.remiseTotale as number | undefined) ?? null,
      etat: detail.etat ?? null,
      reels: totalHT != null,
    }
  } catch {
    return { totalHT: totalHTLocal, totalTTC: null, remiseTotale: null, etat: null, reels: false }
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
  const { lignes, totalHT, idGrilleTarifaire, idGrilleTarifaireFallback, remisesEstimees } = resolution

  let resultat
  try {
    resultat = await enregistrerCommandeAvecFallback({
      idClient: user.easybeerIdClient,
      idGrilleTarifaire,
      idGrilleTarifaireFallback,
      tauxTVA: lignes[0].produit.tauxTVA ?? { idTauxTVA: 13087, libelle: '5,5 %', taux: 5.5 },
      commentaire: body.commentaire?.trim() || 'Commande via la plateforme GOA',
      estDevis: config.commandeEstDevis,
      lignes,
    })
  } catch (e) {
    if (e instanceof EasybeerBanError) throw e
    return c.json({ error: (e as Error).message }, 502)
  }

  // Totaux réels relus d'Easybeer pour l'affichage exact.
  const totaux = await totauxReelsEasybeer(resultat.id!, totalHT)
  const etatEasybeer = totaux.etat != null ? etatAffichage(totaux.etat) : etatAffichage(config.commandeEstDevis ? 'DEVIS' : 'ENREGISTREE')

  // Trace Firestore (suivi/debug — la source de vérité reste Easybeer).
  const orderId = randomUUID()
  await db.collection('orders').doc(orderId).set({
    orderId,
    uid: user.uid,
    easybeerIdClient: user.easybeerIdClient,
    easybeerIdCommande: resultat.id,
    easybeerNumero: resultat.numero ?? null,
    easybeerEtat: etatEasybeer,
    estDevis: config.commandeEstDevis,
    totalHT,
    lignes: lignes.map((l) => ({
      idStockBouteille: l.produit.idStockBouteille,
      quantite: l.quantite,
      prixUnitaireHT: l.prixUnitaireHT,
    })),
    remisesEstimees,
    commentaire: body.commentaire ?? '',
    createdAt: Date.now(),
  })

  await upsertCommandeClientCache(db, user.easybeerIdClient, {
    idCommande: resultat.id!,
    numero: resultat.numero ?? null,
    etat: etatEasybeer,
    totalHT: totaux.totalHT,
    totalTTC: totaux.totalTTC,
    dateCreation: Date.now(),
    modifiable: true,
  })
  // Le cache client vient d'être mis à jour localement. La liste admin sera
  // réconciliée à sa prochaine lecture si son TTL de 10 min est dépassé ; on
  // n'abandonne plus une promesse post-réponse, non garantie sur Cloud Run.

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
    const resultat = await lireCommandesClientCache(db, user.easybeerIdClient)
    return c.json({ ...resultat, indisponible: resultat.indisponible ?? false })
  } catch (e) {
    const commandes = await lireCommandesLocales(db, user.easybeerIdClient)
    return c.json({
      commandes,
      syncedAt: null,
      indisponible: true,
      source: commandes.length ? 'local' : 'aucune',
      erreurRefresh: (e as Error).message,
    })
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
  const resultat = await lireCommandesClientCache(db, user.easybeerIdClient, true)
  return c.json({ ...resultat, indisponible: resultat.indisponible ?? false })
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

async function lireRemisesLocalesCommande(
  db: NonNullable<ReturnType<typeof getDb>>,
  uid: string,
  idCommande: number,
): Promise<RemisesCommandeLocales | null> {
  const snap = await db.collection('orders').where('easybeerIdCommande', '==', idCommande).get()
  const docs = snap.docs
    .map((doc) => doc.data() as { uid?: string; createdAt?: number; remisesEstimees?: RemisesCommandeLocales })
    .filter((doc) => doc.uid === uid && doc.remisesEstimees)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return docs[0]?.remisesEstimees ?? null
}

async function lireFormatsCommande(db: NonNullable<ReturnType<typeof getDb>> | null) {
  const formats = new Map<number, { produit: string; contenant: string; packaging: string }>()
  if (!db) return formats
  const grille = await lireGrilleTarifaire(db).catch(() => ({ lignes: [], syncedAt: null }))
  for (const ligne of grille.lignes) {
    if (ligne.idStockBouteille == null || formats.has(ligne.idStockBouteille)) continue
    formats.set(ligne.idStockBouteille, {
      produit: ligne.produit,
      contenant: ligne.contenant,
      packaging: ligne.packaging,
    })
  }
  return formats
}

/** Construit le détail d'affichage d'une commande (lignes, totaux, documents). */
function construireDetailCommande(
  commande: Record<string, unknown>,
  idCommande: number,
  remisesLocales: RemisesCommandeLocales | null = null,
  formats = new Map<number, { produit: string; contenant: string; packaging: string }>(),
) {
  const client = sousObjet(commande, ['client'])
  const formaterLibelleRemise = (valeur: string | null) => {
    if (!valeur || valeur === '0') return null
    return /^[0-9]+([.,][0-9]+)?$/.test(valeur) ? `${valeur.replace('.', ',')} %` : valeur
  }

  const remisesLocalesParStock = new Map((remisesLocales?.ciblees ?? []).map((remise) => [remise.idStockBouteille, remise]))

  const lignes = ((commande.elementsBouteilles as Record<string, unknown>[] | undefined) ?? []).map((e) => {
    const prixUnitaireHT = (e.prixUnitaireHTHorsRemise as number | undefined) ?? null
    const quantite = (e.quantite as number | undefined) ?? 0
    const totalHT =
      (e.prixTotalHT as number | undefined) ??
      (prixUnitaireHT != null ? prixUnitaireHT * quantite : null)
    const totalAvantRemiseHT = prixUnitaireHT != null ? Math.round(prixUnitaireHT * quantite * 100) / 100 : null
    const remiseMontant =
      totalAvantRemiseHT != null && totalHT != null
        ? Math.max(0, Math.round((totalAvantRemiseHT - totalHT) * 100) / 100)
        : null
    const libellesRemise = [
      texteDepuis(e, ['remiseLibelle', 'remise', 'valeurRemise']),
    ]
      .map(formaterLibelleRemise)
      .filter((libelle): libelle is string => Boolean(libelle))
    const remiseLabel = [...new Set(libellesRemise)].join(' + ') || null
    const idStockBouteille = idStockBouteilleElementCommande(e)
    const format = idStockBouteille != null ? formats.get(idStockBouteille) : null
    const remiseLocale = idStockBouteille != null ? remisesLocalesParStock.get(idStockBouteille) : null
    const tvaLigne =
      (e.totalTVA as number | undefined) ??
      (totalHT != null ? Math.max(0, Math.round(totalHT * 0.055 * 100) / 100) : null)
    return {
      designation:
        format?.produit ??
        ((e.stockProduit as { libelle?: string } | undefined)?.libelle as string) ??
        ((e.designation as string) || 'Produit'),
      contenant: format?.contenant ?? null,
      packaging: format?.packaging ?? null,
      quantite,
      prixUnitaireHT,
      remiseLabel: remiseLabel ?? remiseLocale?.remiseLabel ?? null,
      remiseMontant: remiseMontant && remiseMontant > 0 ? remiseMontant : (remiseLocale?.montant ?? null),
      totalHT,
      tvaLigne,
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
    dateCreation:
      commande.dateCreation == null
        ? null
        : new Date(commande.dateCreation as string | number).getTime() || null,
    client: client
      ? {
          idClient: nombreDepuis(client, ['idClient']),
          nom: texteDepuis(client, ['nom', 'raisonSociale']),
          numero: texteDepuis(client, ['numero', 'reference']),
        }
      : null,
    etat: etatAffichage(commande.etat),
    totalHT: commande.totalHT ?? null,
    totalTTC: commande.totalTTC ?? null,
    remiseTotale: commande.remiseTotale ?? remisesLocales?.globaleMontant ?? null,
    remiseLabel: remisesLocales?.globaleLabel ?? null,
    modeLivraison: modeLivraisonCommande(commande),
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
  const db = getDb()
  const commande = await chargerCommandeClient(idCommande, user.easybeerIdClient)
  if (!commande) {
    if (db) await retirerCommandeClientCache(db, user.easybeerIdClient, idCommande)
    return c.json({ error: 'Commande introuvable' }, 404)
  }
  const remisesLocales = db ? await lireRemisesLocalesCommande(db, user.uid, idCommande) : null
  const formats = await lireFormatsCommande(db)
  return c.json(construireDetailCommande(commande, idCommande, remisesLocales, formats))
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
  const elements = (commande.elementsBouteilles as Record<string, unknown>[] | undefined) ?? []
  const lignes = elements.map((element) => ({
    idStockBouteille: idStockBouteilleElementCommande(element),
    quantite: nombreDepuis(element, ['quantite']) ?? 0,
    designation:
      ((element.stockProduit as { libelle?: string } | undefined)?.libelle as string) ??
      ((element.designation as string) || 'Produit'),
  }))
  // Le flux « recommander » compose une NOUVELLE commande : une ligne non
  // identifiable y est simplement écartée (le front l'affiche), alors qu'une
  // modification en place doit être refusée en bloc.
  const tolerant = c.req.query('pour') === 'recommande'
  if (!lignes.length || (!tolerant && lignes.some((ligne) => ligne.idStockBouteille == null))) {
    return c.json(
      { error: "Cette commande contient un produit qu'Easybeer ne permet pas d'identifier. Elle ne peut pas être modifiée depuis la plateforme." },
      422,
    )
  }
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
  const quantitesOriginales = new Map<number, number>()
  for (const element of (commande.elementsBouteilles as Record<string, unknown>[] | undefined) ?? []) {
    const id = idStockBouteilleElementCommande(element)
    const quantite = nombreDepuis(element, ['quantite'])
    if (id != null && quantite != null) quantitesOriginales.set(id, quantite)
  }

  const resolution = await resoudreLignes(db, user.easybeerIdClient, body.lignes, quantitesOriginales)
  if (!resolution.ok) return c.json({ error: resolution.erreur }, 400)
  const { lignes, totalHT, remisesEstimees } = resolution

  let resultat
  try {
    resultat = await modifierCommandeAvecFallback({
      idCommande,
      commentaire: body.commentaire?.trim() || 'Commande via la plateforme GOA (modifiée)',
      lignes,
    })
  } catch (e) {
    if (e instanceof EasybeerBanError) throw e
    return c.json({ error: (e as Error).message }, 502)
  }

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
    remisesEstimees,
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
  // Réconciliation en tâche de fond (cf. création) — jamais bloquant.
  // Le cache client est déjà corrigé localement ; la liste admin se
  // réconcilie à sa prochaine lecture périmée.

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
  const [{ clients, syncedAt, indisponible, revalidationEnCours, revalidationEchouee }, comptes] = await Promise.all([
    lireListeClients(db, c.req.query('refresh') === '1'),
    comptesParClient(),
  ])
  return c.json({
    clients,
    comptes,
    syncedAt,
    indisponible: indisponible ?? false,
    revalidationEnCours: revalidationEnCours ?? false,
    revalidationEchouee: revalidationEchouee ?? false,
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
  const typesClient = await listeTypesClient().catch(() => [])
  const clientAvecRemises = allegerClient(client, typesClient)
  const typesApplicables = typesClientEnCascade(client.type?.idClientType, typesClient)
    .map((type) => ({
      idClientType: type.idClientType ?? null,
      libelle: type.libelle ?? null,
      remise: type.remise ?? null,
      remisesCiblees: normaliserRemisesCiblees(type.listeRemises),
    }))
    .filter((type) => type.remise || type.remisesCiblees.length)
  if (db) {
    await db.doc(`cacheClients/${idClient}`).set({ client: clientAvecRemises, clientUpdatedAt: Date.now() }, { merge: true })

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
      remise: clientAvecRemises.remise ?? null,
      remise2: clientAvecRemises.remise2 ?? null,
      typeRemise2: clientAvecRemises.typeRemise2 ?? null,
      nbRemisesCiblees: client.listeRemises?.length ?? 0,
      remisesCiblees: normaliserRemisesCiblees(client.listeRemises),
      remisesType: typesApplicables,
      typeLivraisonFav: client.typeLivraisonFav || null,
      tournee: client.tournee?.libelle ?? null,
      tags: client.tags ?? null,
      tarifsPersonnalises: normaliserTarifsPersonnalises(client.listePrix),
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
  const idsMinimumMisAJour = new Set<number>()
  let typeLivraisonVerifie = typeLivraison == null

  if (idClientTournee != null) {
    await attribuerTournee(idClientTournee, idsClients)
  }

  if (typeLivraison != null) {
    await attribuerTypeLivraison(typeLivraison, idsClients)
    // Relecture de contrôle sur le premier client (échec silencieux documenté).
    const controle = await getClient(idsClients[0])
    const libelleAttendu = CODES_TYPE_LIVRAISON[typeLivraison]
    typeLivraisonVerifie = controle?.typeLivraisonFav === libelleAttendu
    if (!typeLivraisonVerifie) {
      erreurs.push(
        `Mode de livraison : Easybeer n'a pas enregistré « ${libelleAttendu} » — vérifier la fiche client`,
      )
    }
  }

  if (minimumCommande != null) {
    for (const idClient of idsClients) {
      try {
        await majMinimumClient(idClient, minimumCommande)
        idsMinimumMisAJour.add(idClient)
      } catch (e) {
        erreurs.push(`minimum client ${idClient} : ${(e as Error).message}`)
      }
    }
  }

  // Répercute immédiatement les valeurs confirmées dans les caches déjà créés.
  // Un document absent n'est pas créé partiellement : il sera rempli avec la
  // fiche et les prix complets lors de la prochaine consultation de la boutique.
  // Surtout, un minimum en échec ne doit jamais être écrit dans le cache.
  const db = getDb()
  if (db && (minimumCommande != null || typeLivraison != null)) {
    for (const idClient of idsClients) {
      const clientMaj = {
        ...(minimumCommande != null && idsMinimumMisAJour.has(idClient) ? { minimumCommande } : {}),
        ...(typeLivraison != null && typeLivraisonVerifie
          ? { typeLivraisonFav: CODES_TYPE_LIVRAISON[typeLivraison] }
          : {}),
      }
      if (Object.keys(clientMaj).length === 0) continue

      try {
        const ref = db.doc(`cacheClients/${idClient}`)
        if ((await ref.get()).exists) {
          await ref.set({ client: clientMaj }, { merge: true })
        }
      } catch (e) {
        // L'écriture Easybeer a déjà réussi : ne pas faire échouer toute la
        // requête (et risquer de rejouer la mutation), mais rendre l'incident visible.
        erreurs.push(`cache client ${idClient} : ${(e as Error).message}`)
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
      const resultat = await lancerRafraichissementCatalogue(db)
      if ('enCours' in resultat) {
        const data = await catalogueAdmin(db)
        return c.json({ ...data, enCours: true })
      }
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

/**
 * Les commandes récentes (30 jours par défaut), depuis le CACHE (resynchro via
 * `?refresh=1` ou le job de synchro) — plus d'appel Easybeer par visite.
 */
app.get('/api/admin/commandes', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)
  const { commandes, syncedAt, indisponible, revalidationEnCours, revalidationEchouee } =
    await lireCommandesRecentes(db, c.req.query('refresh') === '1')
  return c.json({
    commandes: commandes.map((cmd) => ({
      ...cmd,
      facture: cmd.facture ?? null,
      totalHT: cmd.totalHT ?? (cmd.totalTTC != null ? cmd.totalTTC / 1.055 : null),
    })),
    syncedAt,
    indisponible: indisponible ?? false,
    revalidationEnCours: revalidationEnCours ?? false,
    revalidationEchouee: revalidationEchouee ?? false,
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
  const formats = await lireFormatsCommande(getDb())
  return c.json(construireDetailCommande(commande, idCommande, null, formats))
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
    etat: { code: string; libelle: string; couleur: string | null }
  }[]
  const produits = (catalogueSnap.data()?.produits ?? []) as unknown[]
  const clientsSyncedAt = (clientsSnap.data()?.syncedAt as number | undefined) ?? null
  const commandesSyncedAt = (commandesSnap.data()?.syncedAt as number | undefined) ?? null
  const catalogueSyncedAt = (catalogueSnap.data()?.syncedAt as number | undefined) ?? null
  const timestampsCache = [clientsSyncedAt, commandesSyncedAt, catalogueSyncedAt]
  const cachePlusAncienAt = timestampsCache.every((timestamp): timestamp is number => typeof timestamp === 'number')
    ? Math.min(...timestampsCache)
    : null
  const meta = metaSnap.data()
  // Les rapports antérieurs à l'ajout du champ `reussi` restent lisibles :
  // on recalcule leur état à partir des erreurs enregistrées.
  const dernierRapport = meta?.dernierSync as (Omit<SyncReport, 'reussi'> & { reussi?: boolean }) | undefined
  const dernierRapportReussi = Boolean(
    dernierRapport &&
      dernierRapport.reussi !== false &&
      !dernierRapport.erreurs?.length &&
      !dernierRapport.clients?.some((client) => client.erreur),
  )
  const dernierRapportNormalise: SyncReport | null = dernierRapport
    ? { ...dernierRapport, reussi: dernierRapportReussi }
    : null
  const ancienRapportReussi = dernierRapportReussi ? (dernierRapport?.syncedAt ?? null) : null

  const depuis30j = Date.now() - 30 * 24 * 3600 * 1000
  const commandes30j = commandes.filter((cmd) => (cmd.dateCreation ?? 0) >= depuis30j && cmd.etat.code !== 'ANNULEE')
  const statutsCommandes30j = Array.from(
    commandes30j.reduce((groupes, cmd) => {
      const code = cmd.etat.code || 'INCONNU'
      const groupe = groupes.get(code)
      if (groupe) {
        groupe.nombre++
      } else {
        groupes.set(code, {
          etat: {
            code,
            libelle: cmd.etat.libelle || code,
            couleur: cmd.etat.couleur ?? null,
          },
          nombre: 1,
        })
      }
      return groupes
    }, new Map<string, { etat: { code: string; libelle: string; couleur: string | null }; nombre: number }>()),
  )
    .map(([, groupe]) => groupe)
    .sort((a, b) => b.nombre - a.nombre || a.etat.libelle.localeCompare(b.etat.libelle, 'fr'))
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
    commandes30j: {
      nombre: commandes30j.length,
      statuts: statutsCommandes30j,
      caHT: caHT30j,
      caTTC: caTTC30j,
    },
    catalogue: { produits: produits.length, visibles, ruptures },
    cache: {
      clientsAt: clientsSyncedAt,
      commandesAt: commandesSyncedAt,
      catalogueAt: catalogueSyncedAt,
      plusAncienAt: cachePlusAncienAt,
    },
    dernierSync: (meta?.dernierSyncReussiAt as number | undefined) ?? ancienRapportReussi,
    dernierRapportSync: dernierRapportNormalise,
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
          actif: lockAgeMs != null && lockAgeMs < SYNC_LOCK_TTL_MS,
          kind: (lockSnap.data()?.kind as string | undefined) ?? null,
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
  // Le déclenchement est idempotent : si un autre processus entretient déjà le
  // cache, la demande est prise en charge par celui-ci. Un 202 évite de traiter
  // cette course normale (scheduler + clic admin) comme une erreur côté client.
  if ('enCours' in res) return { status: 202, body: { enCours: true } }

  // Un ban a pu survenir PENDANT la synchro (syncTout le signale sans planter) :
  // on le remonte pour que l'UI affiche le compte à rebours plutôt qu'un faux succès.
  const apres = etatBanEasybeer()
  if (apres.banni) {
    return {
      status: 503,
      body: { error: `API Easybeer saturée pendant la synchro — réessayez dans ${apres.secondesRestantes} s`, retryAfterSeconds: apres.secondesRestantes },
    }
  }
  return { status: 200, body: { ok: res.report.reussi, report: res.report } }
}

/** Déclenche une synchro complète Easybeer → cache (verrou single-flight). */
app.post('/api/admin/sync', requireAuth, requireAdmin, async (c) => {
  const db = getDb()
  if (!db) return c.json({ error: 'Firebase non configuré' }, 501)

  const ban = etatBanEasybeer()
  if (ban.banni) {
    return c.json(
      {
        error: `API Easybeer saturée — réessayez dans ${ban.secondesRestantes} s`,
        retryAfterSeconds: ban.secondesRestantes,
      },
      503,
    )
  }

  if (cloudTasksConfigure()) {
    const task = await planifierSynchronisationEasybeer('admin')
    return c.json({ demarree: true, task: task.nom }, 202)
  }

  // Compatibilité VPS/dev. En production Cloud Run, la validation de config
  // impose Cloud Tasks et ce chemin n'est donc jamais utilisé.
  void executerSyncCache()
    .then((res) => {
      if (res.status >= 500) console.warn('[sync] tâche admin terminée en erreur :', res.body)
    })
    .catch((e) => console.error('[sync] échec de la tâche admin :', (e as Error).message))

  return c.json({ demarree: true }, 202)
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
  if (cloudTasksConfigure()) {
    const task = await planifierSynchronisationEasybeer('scheduler')
    return c.json({ demarree: true, task: task.nom }, 202)
  }
  const res = await executerSyncCache()
  return c.json(res.body, res.status as 200 | 202 | 501 | 503)
})

/** Worker privé logique de Cloud Tasks. Les retries sont pilotés par la file. */
app.post('/api/tasks/sync', async (c) => {
  if (!requeteCloudTasksAutorisee(c.req.header('X-Goa-Task-Secret'))) {
    return c.json({ error: 'Non autorisé' }, 401)
  }
  const res = await executerSyncCache()
  if (res.status === 202) return c.json({ ok: true, dejaEnCours: true }, 200)
  if (res.status !== 200) return c.json(res.body, res.status as 501 | 503)
  if (!('ok' in res.body) || res.body.ok !== true) {
    return c.json({ ...res.body, error: 'Synchronisation partielle — nouvelle tentative demandée' }, 500)
  }
  return c.json(res.body, 200)
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

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[server] GOA Kombucha backend sur http://localhost:${info.port}`)
  if (config.authDisabled) console.log('[server] ⚠️  AUTH_DISABLED=true (dev) — auth court-circuitée.')
})
