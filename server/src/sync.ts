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

  if (idClientType != null) {
    for (const p of produits) {
      try {
        const res = await avecRetry(
          `prix ${p.idStockBouteille} client ${idClient}`,
          () => getPrix(p.idStockBouteille, idClientType, idClient),
          (r) => r != null,
        )
        if (res?.prixHT != null) prix[String(p.idStockBouteille)] = res.prixHT
      } catch (e) {
        // Ban en cours → inutile de marteler les produits suivants : on garde
        // ce qu'on a (prix déjà en cache préservés) et on abandonne cette passe.
        if (e instanceof EasybeerBanError) break
        // Autre erreur ponctuelle : on garde l'éventuel prix déjà en cache.
      }
    }
  }

  const doc: CacheClientDoc = { client: allegerClient(fiche), idGrilleTarifaire, prix, syncedAt: Date.now() }
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

/** Les ~200 commandes les plus récentes, en un doc de cache. */
export async function syncCommandesRecentes(db: Firestore): Promise<CommandeResumeCache[]> {
  const { commandes } = await listeCommandesRecentes(200)
  const resumees = commandes.map(resumerCommande)
  await db.doc('cache/commandesRecentes').set({ commandes: resumees, syncedAt: Date.now() })
  return resumees
}

// --- Lectures du cache (avec remplissage au premier accès) ---

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

// --- Lectures du cache (catalogue / référentiels / clients) ---

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

/**
 * Synchro complète : catalogue + référentiels + listes admin (clients,
 * commandes récentes) + fiche/prix de chaque client à compte.
 */
export async function syncTout(db: Firestore): Promise<SyncReport> {
  const debut = Date.now()
  const erreurs: string[] = []
  const produits = await syncCatalogue(db)
  const types = await syncReferentiels(db)

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
    `[sync] terminé en ${report.dureeMs} ms — ${report.produits} produits, ${clients.length} client(s).`,
  )
  return report
}
