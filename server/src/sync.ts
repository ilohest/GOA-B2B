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
import { config } from './config.js'
import {
  EasybeerBanError,
  getClient,
  getPrix,
  listeClients,
  listeCommandesClient,
  listeCommandesRecentes,
  listeDocumentsFacturesRecentes,
  listeProduitsAutocomplete,
  listeTypesClient,
  matriceGrille,
  resoudreGrilleRacine,
  type CommandeResume,
  type DocumentCommandeResume,
  type MatriceConditionnement,
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
export function allegerClient(c: ModeleClient) {
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
    remisesCiblees: normaliserRemisesCibleesCache(c.listeRemises),
    typeLivraisonFav: c.typeLivraisonFav ?? null,
    tags: c.tags ?? null,
  }
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

function normaliserRemisesCibleesCache(remises: Record<string, unknown>[] | undefined) {
  return (remises ?? []).map((remise) => {
    const produit = sousObjet(remise, ['produit', 'modeleProduit', 'stockProduit'])
    const contenant = sousObjet(remise, ['contenant', 'modeleContenant'])
    const lot = sousObjet(remise, ['lot', 'modeleLot'])
    const stockBouteille = sousObjet(remise, ['stockBouteille', 'modeleStockBouteille'])

    return {
      idProduit: nombreDepuis(produit, ['idProduit']) ?? nombreDepuis(remise, ['idProduit']),
      idContenant: nombreDepuis(contenant, ['idContenant']) ?? nombreDepuis(remise, ['idContenant']),
      idLot: nombreDepuis(lot, ['idLot']) ?? nombreDepuis(remise, ['idLot']),
      idStockBouteille: nombreDepuis(stockBouteille, ['idStockBouteille']) ?? nombreDepuis(remise, ['idStockBouteille']),
      quantite: nombreDepuis(remise, ['quantite', 'quantiteMin', 'minimum']),
      remise: texteDepuis(remise, ['remise', 'valeur', 'montant']),
      type: texteDepuis(remise, ['type', 'typeRemise']),
    }
  })
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
    () => listeProduitsAutocomplete(),
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

/** Une ligne de grille tarifaire = un prix pour (produit × type × conditionnement). */
export interface GrilleLigne {
  /** Unité commandable résolue depuis le catalogue (null si non stockée). */
  idStockBouteille: number | null
  idProduit: number
  produit: string
  idContenant: number
  contenant: string
  idLot: number
  packaging: string
  quantite: number | null
  idClientType: number
  typeClient: string
  prixHT: number
  horsDroits: boolean
}

/**
 * Grille tarifaire complète : matrice par type de client (seuls les types AVEC
 * grille propre renvoient des tarifs — les autres héritent, cf. EASYBEER.md),
 * aplatie en lignes et enrichie de l'idStockBouteille (via le catalogue).
 */
export async function syncGrilleTarifaire(
  db: Firestore,
  types: ModeleClientType[],
  produits: ProduitAutocomplete[],
): Promise<GrilleLigne[]> {
  const cle = (p: number, c: number, l: number) => `${p}-${c}-${l}`
  const parTuple = new Map<string, number>()
  for (const u of produits) {
    if (u.idProduit != null && u.idContenant != null && u.idLot != null) {
      parTuple.set(cle(u.idProduit, u.idContenant, u.idLot), u.idStockBouteille)
    }
  }
  const libelleType = new Map<number, string>()
  for (const t of types) {
    if (t.idClientType != null) libelleType.set(t.idClientType, t.libelle ?? String(t.idClientType))
  }

  const lignes: GrilleLigne[] = []
  const vus = new Set<number>()
  for (const t of types) {
    const idType = t.idClientType
    if (idType == null || vus.has(idType)) continue
    vus.add(idType)

    const matrice = await avecRetry(`matrice type ${idType}`, () => matriceGrille(idType), (m) => m != null)
    const condParCle = new Map<string, MatriceConditionnement>()
    for (const c of matrice.conditionnements ?? []) {
      const ic = c.contenant?.idContenant
      const il = c.lot?.idLot
      if (ic != null && il != null) condParCle.set(`${ic}-${il}`, c)
    }
    for (const p of matrice.produits ?? []) {
      const idProduit = p.modeleProduit?.idProduit
      if (idProduit == null) continue
      for (const tarif of p.tarifs ?? []) {
        const ic = tarif.modeleContenant?.idContenant
        const il = tarif.modeleLot?.idLot
        if (tarif.prixHT == null || ic == null || il == null) continue
        const cond = condParCle.get(`${ic}-${il}`)
        lignes.push({
          idStockBouteille: parTuple.get(cle(idProduit, ic, il)) ?? null,
          idProduit,
          produit: p.modeleProduit?.libelle ?? p.modeleProduit?.nom ?? `Produit ${idProduit}`,
          idContenant: ic,
          contenant: cond?.contenant?.libelleAvecContenance ?? cond?.contenant?.libelle ?? `Contenant ${ic}`,
          idLot: il,
          packaging: cond?.lot?.libelle ?? `Lot ${il}`,
          quantite: cond?.lot?.quantite ?? null,
          idClientType: idType,
          typeClient: libelleType.get(idType) ?? String(idType),
          prixHT: tarif.prixHT,
          horsDroits: Boolean(tarif.horsDroits),
        })
      }
    }
  }

  await db.doc('cache/grilleTarifaire').set({ lignes, syncedAt: Date.now() })
  return lignes
}

/** Fiche + prix d'UN client → cacheClients/{idClient}. */
export async function syncClient(
  db: Firestore,
  idClient: number,
  types: ModeleClientType[],
  produits: ProduitAutocomplete[],
  idsAPricer?: Set<number>,
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

  // On ne tarife que les unités VISIBLES (le catalogue expose ~41 conditionnements ;
  // sans ce filtre, on ferait 41 × N appels prix → ban assuré). Les unités masquées
  // ne sont ni affichées ni commandables côté client, donc pas besoin de leur prix.
  const aPricer = idsAPricer ? produits.filter((p) => idsAPricer.has(p.idStockBouteille)) : produits

  if (idClientType != null) {
    for (const p of aPricer) {
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

  // Purge des unités sorties du périmètre visible : leur prix perso ne serait
  // plus jamais rafraîchi (boucle ci-dessus = visibles uniquement) et finirait
  // périmé pour toujours. Les unités visibles gardent leur prix même si la
  // passe a échoué (ban) — il sera rafraîchi au passage suivant.
  if (idsAPricer) {
    for (const id of Object.keys(prix)) {
      if (!idsAPricer.has(Number(id))) {
        delete prix[id]
        delete prixUpdatedAt[id]
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
  facture: { existe: boolean; numero: string | null } | null
  totalHT: number | null
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

/**
 * Normalise l'état Easybeer (string brute ou objet {code, libelle, couleur})
 * en forme d'affichage stable — helper UNIQUE, utilisé par la synchro et les
 * endpoints (index.ts).
 */
export function normaliserEtatCommande(etat: unknown): { code: string; libelle: string; couleur: string | null } {
  if (typeof etat === 'string') return { code: etat, libelle: etat, couleur: null }
  const e = (etat ?? {}) as { code?: string; libelle?: string; couleur?: string }
  return { code: e.code ?? '', libelle: e.libelle ?? e.code ?? '', couleur: e.couleur ?? null }
}

function resumerCommande(
  r: CommandeResume,
  facturesParCommande: Map<number, DocumentCommandeResume> = new Map(),
): CommandeResumeCache {
  const etat = normaliserEtatCommande(r.etat)
  const documents = Array.isArray(r.documents) ? (r.documents as Record<string, unknown>[]) : null
  const documentFacture = documents?.find((d) => {
    const type = d.type as { code?: string; libelle?: string } | undefined
    return d.estFacture === true || type?.code === 'FACTURE' || type?.libelle?.toLowerCase().includes('facture')
  })
  const factureListe = r.idCommande == null ? undefined : facturesParCommande.get(r.idCommande)
  const numeroFacture =
    r.numeroFacture ??
    (typeof r.reference === 'string' && r.reference.startsWith('FA') ? r.reference : null) ??
    factureListe?.code ??
    ((documentFacture?.code as string | undefined) ?? null)
  const aInfoFacture =
    factureListe != null ||
    'numeroFacture' in r ||
    'reference' in r ||
    'dateFacturation' in r ||
    'facture' in r ||
    documents != null
  return {
    idCommande: r.idCommande ?? null,
    numero: r.numero ?? null,
    client: r.client
      ? { idClient: r.client.idClient ?? null, nom: r.client.nom ?? null, numero: r.client.numero ?? null }
      : null,
    etat,
    paiement: typeof r.paiementEtat === 'string' ? r.paiementEtat : (r.paiementEtat?.libelle ?? null),
    facture: aInfoFacture
      ? {
          existe: Boolean(numeroFacture || factureListe || r.dateFacturation || r.facture || documentFacture),
          numero: numeroFacture,
        }
      : null,
    totalHT: r.totalHT ?? null,
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
  const etat = normaliserEtatCommande(r.etat)
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

/** Les commandes admin récentes, en un doc de cache. */
export async function syncCommandesRecentes(db: Firestore): Promise<CommandeResumeCache[]> {
  const depuisMs = Date.now() - config.cache.adminCommandesJours * 24 * 60 * 60 * 1000
  const { commandes } = await listeCommandesRecentes(200, depuisMs)
  let facturesParCommande = new Map<number, DocumentCommandeResume>()
  try {
    const factures = await listeDocumentsFacturesRecentes(500)
    facturesParCommande = new Map(
      factures
        .filter((f) => f.idCommande != null)
        .map((f) => [f.idCommande!, f]),
    )
  } catch {
    // La colonne FA est informative : si la liste documents est indisponible,
    // on conserve le cache commandes sans bloquer la synchro principale.
  }
  const resumees = commandes.map((cmd) => resumerCommande(cmd, facturesParCommande))
  await db.doc('cache/commandesRecentes').set({
    commandes: resumees,
    syncedAt: Date.now(),
    periodeJours: config.cache.adminCommandesJours,
  })
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

/** Grille tarifaire complète (cache). Vide si jamais synchronisée. */
export async function lireGrilleTarifaire(db: Firestore): Promise<{ lignes: GrilleLigne[]; syncedAt: number | null }> {
  const snap = await db.doc('cache/grilleTarifaire').get()
  if (!snap.exists) return { lignes: [], syncedAt: null }
  const data = snap.data() as { lignes?: GrilleLigne[]; syncedAt?: number }
  return { lignes: data.lignes ?? [], syncedAt: data.syncedAt ?? null }
}

/** idStockBouteille rendus visibles par l'admin (overrides) — pour cibler la tarification. */
async function idsVisibles(db: Firestore): Promise<Set<number>> {
  const snap = await db.collection('catalogueOverrides').get()
  const set = new Set<number>()
  for (const d of snap.docs) {
    if (d.data().visible) {
      const id = Number(d.id)
      if (Number.isFinite(id)) set.add(id)
    }
  }
  return set
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

// --- Remplissage ciblé du cache d'UN client (activation / auto-guérison) ---

// Anti-rafale : au plus une tentative par client par fenêtre. Sans ce garde,
// un client sans cache qui recharge sa page pendant un ban déclencherait un
// appel Easybeer par visite (et prolongerait le ban).
const REMPLISSAGE_MIN_INTERVAL_MS = 10 * 60 * 1000
const dernieresTentativesRemplissage = new Map<number, number>()

/**
 * Crée le cache d'UN client (fiche + prix des unités visibles) sans attendre la
 * synchro complète. Appelé à l'activation du compte, et en auto-guérison quand
 * une lecture tombe sur un cache manquant. Lit catalogue/référentiels/overrides
 * depuis le CACHE (1 appel fiche + N appels prix vers Easybeer, sérialisés).
 * Renvoie null si une tentative récente a déjà eu lieu (anti-rafale) ou si le
 * cache existe déjà.
 */
export async function remplirCacheClientCible(db: Firestore, idClient: number): Promise<CacheClientDoc | null> {
  const existant = await db.doc(`cacheClients/${idClient}`).get()
  if (existant.exists) return existant.data() as CacheClientDoc

  const derniere = dernieresTentativesRemplissage.get(idClient) ?? 0
  if (Date.now() - derniere < REMPLISSAGE_MIN_INTERVAL_MS) return null
  dernieresTentativesRemplissage.set(idClient, Date.now())

  const [produits, types, visibles] = await Promise.all([
    lireCatalogue(db).then((c) => c.produits).catch(() => [] as ProduitAutocomplete[]),
    lireReferentiels(db).catch(() => [] as ModeleClientType[]),
    idsVisibles(db),
  ])
  const doc = await syncClient(db, idClient, types, produits, visibles)
  console.log(`[sync] cache client ${idClient} créé à la volée (${Object.keys(doc.prix).length} prix).`)
  return doc
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
/**
 * Refresh SCOPÉ du catalogue admin depuis Easybeer : produits + types + grille
 * tarifaire (ce dont dépend l'écran catalogue). N'inclut PAS les prix par client
 * (ça, c'est la synchro complète). Un ban se propage (EasybeerBanError) → géré
 * par l'appelant (repli sur le cache existant + compte à rebours UI).
 */
export async function rafraichirCatalogue(db: Firestore): Promise<void> {
  const produits = await syncCatalogue(db)
  const types = await syncReferentiels(db)
  await syncGrilleTarifaire(db, types, produits)
}

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

  try {
    await syncGrilleTarifaire(db, types, produits)
  } catch (e) {
    erreurs.push(`grille tarifaire : ${(e as Error).message}`)
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

  const visibles = await idsVisibles(db)
  const clients: SyncReport['clients'] = []
  for (const idClient of await idsClientsAvecCompte(db)) {
    try {
      const doc = await syncClient(db, idClient, types, produits, visibles)
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
