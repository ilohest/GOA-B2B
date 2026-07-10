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
  listeClients,
  listeCommandesClient,
  listeCommandesRecentes,
  listeProduitsAutocomplete,
  listeTypesClient,
  resoudreGrilleRacine,
  type CommandeResume,
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
  /** Timestamp par prix réussi. Indispensable quand une synchro est partielle. */
  prixUpdatedAt: Record<string, number>
  syncedAt: number
}

export interface SyncReport {
  produits: number
  typesClient: number
  listeClients: number
  commandesRecentes: number
  clients: { idClient: number; nom: string | null; prix: number; erreur?: string }[]
  erreurs?: string[]
  dureeMs: number
  syncedAt: number
}

export class CacheIndisponibleError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'CacheIndisponibleError'
  }
}

export function prixEstFrais(
  cache: Pick<CacheClientDoc, 'prixUpdatedAt'>,
  idStockBouteille: number,
  maxAgeMs: number,
  now = Date.now(),
): boolean {
  const updatedAt = cache.prixUpdatedAt[String(idStockBouteille)]
  return typeof updatedAt === 'number' && now - updatedAt <= maxAgeMs
}

export function agePrixMs(cache: Pick<CacheClientDoc, 'prixUpdatedAt'>, idStockBouteille: number, now = Date.now()) {
  const updatedAt = cache.prixUpdatedAt[String(idStockBouteille)]
  return typeof updatedAt === 'number' ? Math.max(0, now - updatedAt) : null
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

  // On PART des prix déjà en cache (MERGE) : un ban en cours de synchro ne doit
  // pas effacer des prix déjà connus — au contraire, chaque passage complète les
  // manquants. Cf. rate-limiting : une synchro peut être partielle.
  const existant = (await db.doc(`cacheClients/${idClient}`).get()).data() as CacheClientDoc | undefined
  const prix: Record<string, number> = { ...(existant?.prix ?? {}) }
  const prixUpdatedAt: Record<string, number> = {
    ...(existant?.prixUpdatedAt ??
      Object.fromEntries(Object.keys(existant?.prix ?? {}).map((id) => [id, existant?.syncedAt ?? 0]))),
  }

  if (idClientType != null) {
    for (const p of produits) {
      try {
        const res = await avecRetry(
          `prix ${p.idStockBouteille} client ${idClient}`,
          () => getPrix(p.idStockBouteille, idClientType, idClient),
          (r) => r != null,
        )
        if (res?.prixHT != null) {
          const id = String(p.idStockBouteille)
          prix[id] = res.prixHT
          prixUpdatedAt[id] = Date.now()
        }
      } catch (e) {
        // Ban en cours → inutile de marteler les produits suivants : on garde
        // ce qu'on a (prix déjà en cache préservés) et on abandonne cette passe.
        if (e instanceof EasybeerBanError) break
        // Autre erreur ponctuelle : on garde l'éventuel prix déjà en cache.
      }
    }
  }

  const doc: CacheClientDoc = { client: allegerClient(fiche), idGrilleTarifaire, prix, prixUpdatedAt, syncedAt: Date.now() }
  await db.doc(`cacheClients/${idClient}`).set(doc)
  return doc
}

// --- Listes admin (clients + commandes récentes), servies depuis le cache ---

/** Résumé client stocké dans cache/clientsListe (l'écran admin lit ça, pas Easybeer). */
export interface ClientResume {
  idClient: number | null
  nom: string | null
  raisonSociale: string | null
  numero: string | null
  emailPrincipal: string | null
  categorie: string | null
  actif: boolean
}

function resumerClient(c: ModeleClient): ClientResume {
  return {
    idClient: c.idClient ?? null,
    nom: c.nom ?? null,
    raisonSociale: c.raisonSociale ?? null,
    numero: c.numero ?? null,
    emailPrincipal: c.emailPrincipal ?? null,
    categorie: c.type?.libelle ?? null,
    actif: c.actif ?? true,
  }
}

/** Tous les clients Easybeer (~250 → 2 appels), en un doc de cache. */
export async function syncListeClients(db: Firestore): Promise<ClientResume[]> {
  const parPage = 200
  let clients: ClientResume[] = []
  for (let page = 1; page <= 10; page++) {
    const res = await avecRetry(
      `clients page ${page}`,
      () => listeClients({}, { numeroPage: page, nombreParPage: parPage }),
      (r) => Array.isArray(r?.liste),
    )
    clients = [...clients, ...res.liste.map(resumerClient)]
    if (res.liste.length < parPage) break
  }
  await db.doc('cache/clientsListe').set({ clients, syncedAt: Date.now() })
  return clients
}

export interface CommandeResumeCache {
  idCommande: number | null
  numero: number | null
  client: { idClient: number | null; nom: string | null; numero: string | null } | null
  etat: { code: string; libelle: string; couleur: string | null }
  paiement: string | null
  totalTTC: number | null
  dateCreation: number | null
}

export interface CommandeClientCache {
  idCommande: number
  numero: number | null
  etat: { code: string; libelle: string; couleur: string | null }
  totalTTC: number | null
  totalHT: number | null
  dateCreation: number | null
  modifiable: boolean
}

function resumerCommande(r: CommandeResume): CommandeResumeCache {
  const etat =
    typeof r.etat === 'string'
      ? { code: r.etat, libelle: r.etat, couleur: null }
      : { code: r.etat?.code ?? '', libelle: r.etat?.libelle ?? r.etat?.code ?? '', couleur: r.etat?.couleur ?? null }
  return {
    idCommande: r.idCommande ?? null,
    numero: r.numero ?? null,
    client: r.client
      ? { idClient: r.client.idClient ?? null, nom: r.client.nom ?? null, numero: r.client.numero ?? null }
      : null,
    etat,
    paiement: typeof r.paiementEtat === 'string' ? r.paiementEtat : (r.paiementEtat?.libelle ?? null),
    totalTTC: r.totalTTC ?? null,
    dateCreation: r.dateCreation == null ? null : new Date(r.dateCreation).getTime() || null,
  }
}

const ETATS_NON_MODIFIABLES_CACHE = new Set(['LIVREE', 'ANNULEE'])

function codeEtatCommande(etat: CommandeResume['etat']): string {
  return typeof etat === 'string' ? etat : (etat?.code ?? '')
}

function resumerCommandeClient(r: CommandeResume): CommandeClientCache | null {
  if (r.idCommande == null) return null
  const etat =
    typeof r.etat === 'string'
      ? { code: r.etat, libelle: r.etat, couleur: null }
      : { code: r.etat?.code ?? '', libelle: r.etat?.libelle ?? r.etat?.code ?? '', couleur: r.etat?.couleur ?? null }
  const dateCreation = r.dateCreation == null ? null : new Date(r.dateCreation).getTime() || null
  return {
    idCommande: r.idCommande,
    numero: r.numero ?? null,
    etat,
    totalTTC: r.totalTTC ?? null,
    totalHT: r.totalHT ?? null,
    dateCreation,
    modifiable: r.estModifiable ?? !ETATS_NON_MODIFIABLES_CACHE.has(codeEtatCommande(r.etat)),
  }
}

/** Les ~200 commandes les plus récentes, en un doc de cache. */
export async function syncCommandesRecentes(db: Firestore): Promise<CommandeResumeCache[]> {
  const { commandes } = await listeCommandesRecentes(200)
  const resumees = commandes.map(resumerCommande)
  await db.doc('cache/commandesRecentes').set({ commandes: resumees, syncedAt: Date.now() })
  return resumees
}

export async function syncCommandesClient(db: Firestore, idClient: number): Promise<CommandeClientCache[]> {
  const brutes = await listeCommandesClient(idClient)
  const commandes = brutes
    .map(resumerCommandeClient)
    .filter((cmd): cmd is CommandeClientCache => cmd != null)
    .sort((a, b) => (b.dateCreation ?? 0) - (a.dateCreation ?? 0))
  await db.doc(`cacheCommandesClients/${idClient}`).set({ commandes, syncedAt: Date.now() })
  return commandes
}

// --- Lectures des caches admin/client ---

/**
 * ⚠️ Une lecture NORMALE (sans `forcerRefresh`) ne touche JAMAIS Easybeer :
 * elle renvoie le cache, ou `indisponible` si le cache est vide. C'est capital
 * pour le rate-limiting — chaque appel pendant un ban le prolonge, donc une
 * simple visite de page ne doit rien déclencher. Seul un `refresh` EXPLICITE
 * (bouton Synchroniser) appelle Easybeer, et un ban s'y propage (503 → compte
 * à rebours côté UI).
 */
async function lireCacheOuRemplir(
  db: Firestore,
  chemin: string,
  cle: 'clients' | 'commandes',
  remplir: (db: Firestore) => Promise<unknown[]>,
  forcerRefresh: boolean,
): Promise<{ items: unknown[]; syncedAt: number | null; indisponible?: boolean }> {
  const snap = await db.doc(chemin).get()
  const cache = snap.exists ? (snap.data() as Record<string, unknown>) : null

  if (!forcerRefresh) {
    // Lecture normale : cache uniquement, aucun appel Easybeer.
    if (cache) return { items: (cache[cle] as unknown[]) ?? [], syncedAt: (cache.syncedAt as number) ?? null }
    return { items: [], syncedAt: null, indisponible: true }
  }

  // Refresh explicite : on tente Easybeer. En cas de ban, repli sur le cache
  // existant si possible, sinon on laisse remonter l'erreur (503 + compte à rebours).
  try {
    const items = await remplir(db)
    return { items, syncedAt: Date.now() }
  } catch (e) {
    if (e instanceof EasybeerBanError && cache) {
      return { items: (cache[cle] as unknown[]) ?? [], syncedAt: (cache.syncedAt as number) ?? null }
    }
    throw e
  }
}

export async function lireListeClients(
  db: Firestore,
  forcerRefresh = false,
): Promise<{ clients: ClientResume[]; syncedAt: number | null; indisponible?: boolean }> {
  const res = await lireCacheOuRemplir(db, 'cache/clientsListe', 'clients', syncListeClients, forcerRefresh)
  return { clients: res.items as ClientResume[], syncedAt: res.syncedAt, indisponible: res.indisponible }
}

export async function lireCommandesRecentes(
  db: Firestore,
  forcerRefresh = false,
): Promise<{ commandes: CommandeResumeCache[]; syncedAt: number | null; indisponible?: boolean }> {
  const res = await lireCacheOuRemplir(
    db,
    'cache/commandesRecentes',
    'commandes',
    syncCommandesRecentes,
    forcerRefresh,
  )
  return { commandes: res.items as CommandeResumeCache[], syncedAt: res.syncedAt, indisponible: res.indisponible }
}

export async function lireCommandesClient(
  db: Firestore,
  idClient: number,
): Promise<{ commandes: CommandeClientCache[]; syncedAt: number | null }> {
  const snap = await db.doc(`cacheCommandesClients/${idClient}`).get()
  if (!snap.exists) {
    throw new CacheIndisponibleError('commandes_client_cache_manquant', `Historique client ${idClient} non synchronisé`)
  }
  const data = snap.data() as { commandes?: CommandeClientCache[]; syncedAt?: number }
  return { commandes: data.commandes ?? [], syncedAt: data.syncedAt ?? null }
}

// --- Lectures du cache (catalogue / référentiels / clients) ---

export async function lireCatalogue(db: Firestore): Promise<{ produits: ProduitAutocomplete[]; syncedAt: number }> {
  const snap = await db.doc('cache/catalogue').get()
  if (snap.exists) return snap.data() as { produits: ProduitAutocomplete[]; syncedAt: number }
  throw new CacheIndisponibleError('catalogue_manquant', 'Catalogue non synchronisé')
}

export async function lireReferentiels(db: Firestore): Promise<ModeleClientType[]> {
  const snap = await db.doc('cache/referentiels').get()
  if (snap.exists) return (snap.data() as { typesClient: ModeleClientType[] }).typesClient
  throw new CacheIndisponibleError('referentiels_manquants', 'Référentiels Easybeer non synchronisés')
}

/** Cache client strict : une lecture applicative normale ne déclenche jamais Easybeer. */
export async function lireCacheClient(db: Firestore, idClient: number): Promise<CacheClientDoc> {
  const snap = await db.doc(`cacheClients/${idClient}`).get()
  if (!snap.exists) {
    throw new CacheIndisponibleError('client_cache_manquant', `Cache client ${idClient} non synchronisé`)
  }
  const data = snap.data() as CacheClientDoc
  return {
    ...data,
    prixUpdatedAt:
      data.prixUpdatedAt ??
      Object.fromEntries(Object.keys(data.prix ?? {}).map((id) => [id, data.syncedAt ?? 0])),
  }
}

/** Ids des clients Easybeer liés à au moins un compte plateforme. */
async function idsClientsAvecCompte(db: Firestore): Promise<number[]> {
  const snap = await db.collection('users').where('easybeerIdClient', '!=', null).get()
  return [...new Set(snap.docs.map((d) => d.data().easybeerIdClient as number))]
}

/**
 * Synchro complète : catalogue + référentiels + listes admin (clients,
 * commandes récentes) + fiche/prix de chaque client à compte.
 *
 * Robuste par construction : chaque section est isolée (try/catch), un échec
 * (ban) n'abandonne pas les suivantes et n'écrase JAMAIS un cache par du vide —
 * catalogue/référentiels retombent sur leur version en cache pour que la
 * synchro des prix clients puisse continuer. Les erreurs sont consignées au
 * rapport. Pour éviter les synchros concurrentes, passer par `lancerSync`.
 */
export async function syncTout(db: Firestore): Promise<SyncReport> {
  const debut = Date.now()
  const erreurs: string[] = []

  // Catalogue + référentiels : repli sur le cache si la synchro échoue, pour
  // que la suite (prix clients) dispose quand même de la liste produits/types.
  let produits: ProduitAutocomplete[]
  try {
    produits = await syncCatalogue(db)
  } catch (e) {
    erreurs.push(`catalogue : ${(e as Error).message}`)
    try {
      produits = (await lireCatalogue(db)).produits
    } catch (cacheError) {
      erreurs.push(`catalogue cache : ${(cacheError as Error).message}`)
      produits = []
    }
  }
  let types: ModeleClientType[]
  try {
    types = await syncReferentiels(db)
  } catch (e) {
    erreurs.push(`référentiels : ${(e as Error).message}`)
    try {
      types = await lireReferentiels(db)
    } catch (cacheError) {
      erreurs.push(`référentiels cache : ${(cacheError as Error).message}`)
      types = []
    }
  }

  let listeClientsNb = 0
  try {
    listeClientsNb = (await syncListeClients(db)).length
  } catch (e) {
    erreurs.push(`liste clients : ${(e as Error).message}`)
  }
  let commandesNb = 0
  try {
    commandesNb = (await syncCommandesRecentes(db)).length
  } catch (e) {
    erreurs.push(`commandes récentes : ${(e as Error).message}`)
  }

  const clients: SyncReport['clients'] = []
  for (const idClient of await idsClientsAvecCompte(db)) {
    try {
      const doc = await syncClient(db, idClient, types, produits)
      try {
        await syncCommandesClient(db, idClient)
      } catch (e) {
        erreurs.push(`commandes client ${idClient} : ${(e as Error).message}`)
      }
      clients.push({ idClient, nom: doc.client.nom, prix: Object.keys(doc.prix).length })
    } catch (e) {
      clients.push({ idClient, nom: null, prix: 0, erreur: (e as Error).message })
    }
  }

  const report: SyncReport = {
    produits: produits.length,
    typesClient: types.length,
    listeClients: listeClientsNb,
    commandesRecentes: commandesNb,
    clients,
    ...(erreurs.length ? { erreurs } : {}),
    dureeMs: Date.now() - debut,
    syncedAt: Date.now(),
  }
  await db.doc('cache/meta').set({ dernierSync: report })
  console.log(
    `[sync] terminé en ${report.dureeMs} ms — ${report.produits} produits, ${clients.length} client(s)` +
      (erreurs.length ? `, ${erreurs.length} section(s) en erreur` : '') +
      '.',
  )
  return report
}

// --- Verrou single-flight : une seule synchro complète à la fois ---

const VERROU_TTL_MS = 15 * 60 * 1000 // au-delà, un verrou est considéré périmé (sync crashée)

/**
 * Lance `syncTout` sous verrou Firestore : si une synchro tourne déjà (job
 * périodique + clic admin simultanés, voire plusieurs instances Cloud Run),
 * on n'en démarre pas une seconde. Renvoie `{ enCours: true }` dans ce cas.
 */
export async function lancerSync(db: Firestore): Promise<{ report: SyncReport } | { enCours: true }> {
  const verrou = db.doc('cache/lock')
  const acquis = await db.runTransaction(async (tx) => {
    const debut = (await tx.get(verrou)).data()?.startedAt as number | undefined
    if (debut && Date.now() - debut < VERROU_TTL_MS) return false
    tx.set(verrou, { startedAt: Date.now() })
    return true
  })
  if (!acquis) return { enCours: true }

  try {
    return { report: await syncTout(db) }
  } finally {
    await verrou.set({ startedAt: null, finishedAt: Date.now() }).catch(() => {})
  }
}
