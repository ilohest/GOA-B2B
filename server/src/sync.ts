/**
 * Job de synchro Easybeer → cache Firestore (cf. BRIEF-DEV-V1 §2).
 *
 * L'API Easybeer throttle agressivement (HTTP 200 corps vide) : on n'appelle
 * JAMAIS Easybeer depuis une requête client. Ce module pull périodiquement (ou
 * sur déclenchement admin) et écrit dans Firestore ; les lectures de l'app se
 * font sur le cache.
 *
 * Structure :
 *  - cache/catalogue            { produits[], syncedAt }
 *  - cache/referentiels         { typesClient[], syncedAt }
 *  - cacheClients/{idClient}    { client (fiche allégée), idGrilleTarifaire,
 *                                 prix: { [idStockBouteille]: prixHT }, syncedAt }
 *
 * Seuls les clients ayant un compte plateforme (collection users) sont
 * synchronisés : ~n comptes × (1 fiche + 12 prix) appels, espacés pour rester
 * sous le radar du rate-limiting.
 */
import type { Firestore } from 'firebase-admin/firestore'
import {
  EasybeerBanError,
  getClient,
  getPrix,
  listeProduitsAutocomplete,
  listeTypesClient,
  resoudreGrilleRacine,
  type ModeleClient,
  type ModeleClientType,
  type ProduitAutocomplete,
} from './easybeer.js'

// NB : l'espacement des appels est garanti globalement par la file d'attente
// du client easybeer.ts — pas de délai à gérer ici.
const delai = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Réessaie un appel Easybeer quand la réponse ressemble à du throttling. */
async function avecRetry<T>(
  label: string,
  fn: () => Promise<T>,
  valide: (v: T) => boolean,
  tentatives = 3,
): Promise<T> {
  let derniereErreur: unknown
  for (let i = 1; i <= tentatives; i++) {
    try {
      const v = await fn()
      if (valide(v)) return v
      derniereErreur = new Error(`réponse vide (throttling probable)`)
    } catch (e) {
      // Ban rate-limit : inutile d'insister, on remonte tout de suite.
      if (e instanceof EasybeerBanError) throw e
      derniereErreur = e
    }
    if (i < tentatives) await delai(1000 * 2 ** (i - 1))
  }
  throw new Error(`[sync] ${label} : échec après ${tentatives} tentatives — ${(derniereErreur as Error)?.message}`)
}

/** Fiche client réduite aux champs exploités par la plateforme. */
function allegerClient(c: ModeleClient) {
  return {
    idClient: c.idClient ?? null,
    nom: c.nom ?? null,
    raisonSociale: c.raisonSociale ?? null,
    numero: c.numero ?? null,
    emailPrincipal: c.emailPrincipal ?? null,
    type: c.type ? { idClientType: c.type.idClientType ?? null, libelle: c.type.libelle ?? null } : null,
    minimumCommande: c.minimumCommande ?? c.minimumCommandeAutorise ?? null,
    fraisLivraisonHT: c.fraisLivraisonHT ?? null,
    remise: c.remise ?? null,
    remise2: c.remise2 ?? null,
    typeRemise2: c.typeRemise2 ?? null,
    typeLivraisonFav: c.typeLivraisonFav ?? null,
    tags: c.tags ?? null,
  }
}

export type ClientCache = ReturnType<typeof allegerClient>

export interface CacheClientDoc {
  client: ClientCache
  idGrilleTarifaire: number | null
  prix: Record<string, number>
  syncedAt: number
}

export interface SyncReport {
  produits: number
  typesClient: number
  clients: { idClient: number; nom: string | null; prix: number; erreur?: string }[]
  dureeMs: number
  syncedAt: number
}

/** Catalogue commun (1 appel). */
export async function syncCatalogue(db: Firestore): Promise<ProduitAutocomplete[]> {
  const produits = await avecRetry(
    'catalogue',
    () => listeProduitsAutocomplete(true),
    (p) => Array.isArray(p) && p.length > 0,
  )
  await db.doc('cache/catalogue').set({ produits, syncedAt: Date.now() })
  return produits
}

/** Référentiels (types client / grilles). */
export async function syncReferentiels(db: Firestore): Promise<ModeleClientType[]> {
  const typesClient = await avecRetry(
    'types client',
    () => listeTypesClient(),
    (t) => Array.isArray(t) && t.length > 0,
  )
  await db.doc('cache/referentiels').set({ typesClient, syncedAt: Date.now() })
  return typesClient
}

/** Fiche + prix d'UN client → cacheClients/{idClient}. */
export async function syncClient(
  db: Firestore,
  idClient: number,
  types: ModeleClientType[],
  produits: ProduitAutocomplete[],
): Promise<CacheClientDoc> {
  const fiche = await avecRetry(`client ${idClient}`, () => getClient(idClient), (f) => f != null)
  if (!fiche) throw new Error(`client ${idClient} introuvable`)

  const idClientType = fiche.type?.idClientType
  const idGrilleTarifaire = resoudreGrilleRacine(idClientType, types) ?? null

  const prix: Record<string, number> = {}
  if (idClientType != null) {
    for (const p of produits) {
      try {
        const res = await avecRetry(
          `prix ${p.idStockBouteille} client ${idClient}`,
          () => getPrix(p.idStockBouteille, idClientType, idClient),
          (r) => r != null,
        )
        if (res?.prixHT != null) prix[String(p.idStockBouteille)] = res.prixHT
      } catch {
        // Prix manquant pour cette référence : non bloquant, on continue.
      }
    }
  }

  const doc: CacheClientDoc = { client: allegerClient(fiche), idGrilleTarifaire, prix, syncedAt: Date.now() }
  await db.doc(`cacheClients/${idClient}`).set(doc)
  return doc
}

// --- Lectures du cache (avec remplissage au premier accès) ---

export async function lireCatalogue(db: Firestore): Promise<{ produits: ProduitAutocomplete[]; syncedAt: number }> {
  const snap = await db.doc('cache/catalogue').get()
  if (snap.exists) return snap.data() as { produits: ProduitAutocomplete[]; syncedAt: number }
  const produits = await syncCatalogue(db)
  return { produits, syncedAt: Date.now() }
}

export async function lireReferentiels(db: Firestore): Promise<ModeleClientType[]> {
  const snap = await db.doc('cache/referentiels').get()
  if (snap.exists) return (snap.data() as { typesClient: ModeleClientType[] }).typesClient
  return syncReferentiels(db)
}

/** Cache client, rempli à la volée au premier accès (ex. premier login après invitation). */
export async function lireCacheClient(db: Firestore, idClient: number): Promise<CacheClientDoc> {
  const snap = await db.doc(`cacheClients/${idClient}`).get()
  if (snap.exists) return snap.data() as CacheClientDoc
  const { produits } = await lireCatalogue(db)
  const types = await lireReferentiels(db)
  return syncClient(db, idClient, types, produits)
}

/** Ids des clients Easybeer liés à au moins un compte plateforme. */
async function idsClientsAvecCompte(db: Firestore): Promise<number[]> {
  const snap = await db.collection('users').where('easybeerIdClient', '!=', null).get()
  return [...new Set(snap.docs.map((d) => d.data().easybeerIdClient as number))]
}

/** Synchro complète : catalogue + référentiels + tous les clients à compte. */
export async function syncTout(db: Firestore): Promise<SyncReport> {
  const debut = Date.now()
  const produits = await syncCatalogue(db)
  const types = await syncReferentiels(db)

  const clients: SyncReport['clients'] = []
  for (const idClient of await idsClientsAvecCompte(db)) {
    try {
      const doc = await syncClient(db, idClient, types, produits)
      clients.push({ idClient, nom: doc.client.nom, prix: Object.keys(doc.prix).length })
    } catch (e) {
      clients.push({ idClient, nom: null, prix: 0, erreur: (e as Error).message })
    }
  }

  const report: SyncReport = {
    produits: produits.length,
    typesClient: types.length,
    clients,
    dureeMs: Date.now() - debut,
    syncedAt: Date.now(),
  }
  await db.doc('cache/meta').set({ dernierSync: report })
  console.log(
    `[sync] terminé en ${report.dureeMs} ms — ${report.produits} produits, ${clients.length} client(s).`,
  )
  return report
}
