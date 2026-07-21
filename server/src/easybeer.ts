/**
 * Client Easybeer (côté serveur).
 *
 * Porté depuis le POC + recettes vérifiées dans EASYBEER.md. Toutes les requêtes
 * portent le Basic Auth (secrets serveur, jamais exposés au navigateur).
 *
 * Pièges encodés ici (cf. EASYBEER.md) :
 *  - pagination 1-indexée (numeroPage >= 1)
 *  - autocomplete produits SANS idClient (sinon 500)
 *  - grille tarifaire = RACINE du type client (remonter idParent)
 *  - /commande/enregistrer : tauxTVAFraisLivraison requis ; succès = { map: { id } }
 */
import { config } from './config.js'

const BASE = config.easybeer.target
const BASIC_AUTH =
  'Basic ' + Buffer.from(`${config.easybeer.username}:${config.easybeer.password}`).toString('base64')

/**
 * Rate-limiting Easybeer (vérifié 2026-07-08) : 10 req/s max, dépassement =
 * BAN de ~3-4 min avec réponse HTTP 400 explicite ("You are currently banned.
 * Try again in N seconds"). Parade : TOUS les appels sortants passent par une
 * file unique avec espacement minimal — aucun code appelant ne peut créer de
 * rafale, même sous trafic concurrent.
 */
// 1000 ms (1 req/s) : volontairement conservateur. Easybeer annonce 10 req/s,
// mais des runs plus rapides ont déclenché des bans sur fenêtre glissante.
const MIN_INTERVAL_MS = 1000
let fileAttente: Promise<unknown> = Promise.resolve()
let dernierAppel = 0

export class EasybeerBanError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`API Easybeer temporairement bannie (rate-limit) — réessayer dans ${retryAfterSeconds} s`)
    this.name = 'EasybeerBanError'
  }
}

/**
 * Disjoncteur : pendant un ban, TOUTE requête vers l'API prolonge le ban
 * (vérifié 2026-07-09 : durées annoncées qui repartent à la hausse). Dès
 * qu'un ban est détecté, on échoue localement jusqu'à l'échéance (+ marge)
 * sans plus toucher l'API.
 */
let banniJusqua = 0
const MARGE_BAN_MS = 10_000

// Hook de persistance : notifié à chaque (dé)clenchement de ban pour que le
// serveur puisse mémoriser l'échéance (Firestore) et la restaurer au démarrage,
// évitant de re-taper l'API — donc de réarmer le ban — juste après un redémarrage.
let surBanCallback: ((until: number) => void) | null = null
export function surBan(cb: (until: number) => void): void {
  surBanCallback = cb
}
function poserBan(until: number): void {
  banniJusqua = until
  surBanCallback?.(until)
}

/** Restaure une échéance de ban persistée (au démarrage du serveur). */
export function restaurerBan(until: number): void {
  if (until > banniJusqua) banniJusqua = until
}

/** État du disjoncteur (lecture instantanée, aucun appel réseau). */
export function etatBanEasybeer(): { banni: boolean; secondesRestantes: number } {
  const restant = banniJusqua - Date.now()
  return restant > 0 ? { banni: true, secondesRestantes: Math.ceil(restant / 1000) } : { banni: false, secondesRestantes: 0 }
}

/** Sérialise un appel Easybeer dans la file globale (espacement garanti). */
function passerParLaFile<T>(fn: () => Promise<T>): Promise<T> {
  const execution = fileAttente.then(async () => {
    if (Date.now() < banniJusqua) {
      throw new EasybeerBanError(Math.ceil((banniJusqua - Date.now()) / 1000))
    }
    const attente = dernierAppel + MIN_INTERVAL_MS - Date.now()
    if (attente > 0) await new Promise((r) => setTimeout(r, attente))
    dernierAppel = Date.now()
    try {
      return await fn()
    } catch (e) {
      if (e instanceof EasybeerBanError) {
        poserBan(Date.now() + e.retryAfterSeconds * 1000 + MARGE_BAN_MS)
      }
      throw e
    }
  })
  // La file survit aux erreurs (l'échec est propagé à l'appelant seulement).
  fileAttente = execution.catch(() => {})
  return execution
}

async function eb<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return passerParLaFile(async () => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: AbortSignal.timeout(config.easybeer.timeoutMs),
      headers: {
        Authorization: BASIC_AUTH,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()

    // Rate-limit : 400 avec texte « banned » OU 429 standard (vu 2026-07-09).
    if (res.status === 400 && text.toLowerCase().includes('banned')) {
      const secondes = Number(/Try again in (\d+) seconds/.exec(text)?.[1] ?? 60)
      throw new EasybeerBanError(secondes)
    }
    if (res.status === 429) {
      throw new EasybeerBanError(Number(res.headers.get('retry-after') ?? 60))
    }

    let json: unknown
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      // Certaines réponses (commentaires de commande) contiennent des
      // caractères de contrôle qui cassent le JSON strict — parsing tolérant.
      try {
        json = JSON.parse(text.replace(/[\u0000-\u001F]/g, ' '))
      } catch {
        json = { _raw: text.slice(0, 300) }
      }
    }
    return { status: res.status, json: json as T }
  })
}

// --- Types (sous-ensembles exploités) ---

export interface ModeleTauxTVA {
  idTauxTVA?: number
  libelle?: string
  taux?: number
}

const TAUX_TVA_KOMBUCHA: ModeleTauxTVA = {
  idTauxTVA: 13087,
  libelle: '5,5 %',
  taux: 5.5,
}

function tauxTVAValide(taux: ModeleTauxTVA | null | undefined): ModeleTauxTVA {
  return taux?.idTauxTVA ? taux : TAUX_TVA_KOMBUCHA
}

export interface ModeleAdresse {
  ligne1?: string
  ligne2?: string
  ligne3?: string
  codePostal?: string
  ville?: string
  pays?: string
  complete?: string
}

export interface ModeleClientTournee {
  idClientTournee?: number
  libelle?: string
  minimumCommande?: number
}

export interface ModeleClientType {
  idClientType?: number
  libelle?: string
  idParent?: number
  libelleParent?: string
  remise?: string
  remise2?: string
  typeRemise2?: string
  listeRemises?: Record<string, unknown>[]
}

export interface ModeleClient {
  idClient?: number
  nom?: string
  raisonSociale?: string
  numero?: string
  emailPrincipal?: string
  telephonePrincipal?: string
  adresse?: ModeleAdresse
  actif?: boolean
  type?: ModeleClientType
  // Paramètres commerciaux (fiche complète via /parametres/client/edition —
  // champs omis quand nuls, cf. EASYBEER.md §3).
  minimumCommande?: number
  minimumCommandeAutorise?: number
  fraisLivraisonHT?: number
  remise?: string
  remise2?: string
  typeRemise2?: string
  typeLivraisonFav?: string
  tags?: string[] | string
  tournee?: { idClientTournee?: number; libelle?: string; minimumCommande?: number } | null
  listeRemises?: Record<string, unknown>[]
  adresseLivraisonDefaut?: ModeleAdresse & { complete?: string }
}

export interface ListePagineeOfModeleClient {
  liste: ModeleClient[]
  totalElements: number
  totalPages: number
}

export interface ProduitAutocomplete {
  idStockBouteille: number
  libelle: string
  entrepot?: string
  quantiteDisponible?: number
  estUnitaire?: boolean
  idProduit?: number
  idContenant?: number
  idLot?: number
  tauxTVA?: ModeleTauxTVA
}

export interface PaginationParams {
  colonneTri?: string
  numeroPage?: number
  nombreParPage?: number
  mode?: string
}

// --- Clients ---

/** POST /parametres/client/liste — pagination 1-indexée. */
export async function listeClients(
  filtre: Record<string, unknown> = {},
  pagination: PaginationParams = {},
): Promise<ListePagineeOfModeleClient> {
  const { colonneTri = 'nom', numeroPage = 1, nombreParPage = 50, mode } = pagination
  const params = new URLSearchParams({
    colonneTri,
    numeroPage: String(numeroPage),
    nombreParPage: String(nombreParPage),
  })
  if (mode) params.set('mode', mode)
  const { status, json } = await eb<ListePagineeOfModeleClient>(
    'POST',
    `/parametres/client/liste?${params.toString()}`,
    filtre,
  )
  if (status !== 200) throw new Error(`Easybeer ${status} sur /parametres/client/liste`)
  return json
}

/**
 * GET /parametres/client/edition/{id} — fiche client complète.
 * ⚠️ NE PAS passer par client/liste avec le filtre `idsClients` : il est
 * silencieusement IGNORÉ par l'API (renvoie tous les clients) — cf. EASYBEER.md.
 */
export async function getClient(idClient: number): Promise<ModeleClient | null> {
  const { status, json } = await eb<ModeleClient>('GET', `/parametres/client/edition/${idClient}`)
  if (status === 404) return null
  if (status !== 200) throw new Error(`Easybeer ${status} sur /parametres/client/edition/${idClient}`)
  return json?.idClient != null ? json : null
}

/** GET /parametres/client/tournee — tournées (zones de livraison directe). */
export async function listeTournees(): Promise<ModeleClientTournee[]> {
  const { status, json } = await eb<ModeleClientTournee[]>('GET', '/parametres/client/tournee')
  if (status !== 200) throw new Error(`Easybeer ${status} sur /parametres/client/tournee`)
  return Array.isArray(json) ? json : []
}

/**
 * POST /parametres/client/tournee/attribuer — attribution BULK d'une tournée
 * (✅ validé en réel 2026-07-08, cf. EASYBEER.md).
 */
export async function attribuerTournee(idClientTournee: number, idsClients: number[]): Promise<void> {
  const { status, json } = await eb<{ succes?: boolean; message?: string }>(
    'POST',
    '/parametres/client/tournee/attribuer',
    { idClientTournee, idsClients },
  )
  if (status !== 200 || json?.succes === false) {
    throw new Error(`Easybeer ${status} sur tournee/attribuer — ${json?.message ?? 'échec'}`)
  }
}

/**
 * Codes du « type de livraison préféré » VALIDÉS par écriture+relecture sur
 * client fictif (2026-07-09). ⚠️ Un code inconnu répond 200 mais ne stocke
 * RIEN (échec silencieux) → toujours relire après écriture.
 */
export const CODES_TYPE_LIVRAISON: Record<string, string> = {
  TRANSPORTEUR: 'Livraison par transporteur',
  ENLEVEMENT: 'Enlèvement par le client',
  POINT_RETRAIT: 'Point de retrait / Point relais',
}

/** POST /parametres/client/type-livraison/attribuer — bulk, échec silencieux possible. */
export async function attribuerTypeLivraison(code: string, idsClients: number[]): Promise<void> {
  const { status, json } = await eb<{ succes?: boolean; message?: string }>(
    'POST',
    '/parametres/client/type-livraison/attribuer',
    { idsClients, typeLivraisonFavFormulaire: [code] },
  )
  if (status !== 200 || json?.succes === false) {
    throw new Error(`Easybeer ${status} sur type-livraison/attribuer — ${json?.message ?? 'échec'}`)
  }
}

/**
 * Écrit le minimum de commande d'UN client : relecture de la fiche complète →
 * modification → re-POST (upsert, recette validée sur client fictif 2026-07-09).
 */
export async function majMinimumClient(idClient: number, minimum: number): Promise<void> {
  const fiche = await getClient(idClient)
  if (!fiche) throw new Error(`client ${idClient} introuvable`)
  const payload = { ...fiche, minimumCommande: minimum, minimumCommandeAutorise: minimum }
  const { status, json } = await eb<{ succes?: boolean; message?: string; id?: number }>(
    'POST',
    '/parametres/client/enregistrer',
    payload,
  )
  if (status !== 200 || json?.succes === false) {
    throw new Error(`Easybeer ${status} sur client/enregistrer (minimum) — ${json?.message ?? 'échec'}`)
  }
}

// --- Types / grilles ---

/** GET /parametres/client/type — types de client (racines = grilles tarifaires). */
export async function listeTypesClient(): Promise<ModeleClientType[]> {
  const { status, json } = await eb<ModeleClientType[]>('GET', '/parametres/client/type')
  if (status !== 200) throw new Error(`Easybeer ${status} sur /parametres/client/type`)
  return json
}

/** Résout le type d'un client vers sa RACINE (idParent vide) = sa grille tarifaire. */
export function resoudreGrilleRacine(
  idClientType: number | undefined,
  types: ModeleClientType[],
): number | undefined {
  if (idClientType == null) return undefined
  const parId = new Map(types.map((t) => [t.idClientType, t]))
  let courant = parId.get(idClientType)
  const vus = new Set<number>()
  while (courant?.idParent && !vus.has(courant.idClientType!)) {
    vus.add(courant.idClientType!)
    courant = parId.get(courant.idParent)
  }
  return courant?.idClientType ?? idClientType
}

// --- Catalogue ---

/**
 * GET /stock/produits/autocomplete — SANS idClient (sinon 500).
 * ⚠️ `accesPro=true` MASQUE la plupart des conditionnements (ne renvoie que
 * Carton 6×1L et Carton 18×0,35L). Par défaut on NE filtre PAS → tous les lots
 * (Unité, Carton 6/9/12/18, Fût) avec leur idStockBouteille (cf. EASYBEER.md).
 */
export async function listeProduitsAutocomplete(accesPro = false): Promise<ProduitAutocomplete[]> {
  const params = new URLSearchParams({ afficherTarif: 'true' })
  if (accesPro) params.set('accesPro', 'true')
  const { status, json } = await eb<ProduitAutocomplete[]>(
    'GET',
    `/stock/produits/autocomplete?${params.toString()}`,
  )
  if (status !== 200) throw new Error(`Easybeer ${status} sur /stock/produits/autocomplete`)
  return json
}

// --- Grille tarifaire (matrice par type de client) ---

export interface MatriceConditionnement {
  contenant?: { idContenant?: number; libelle?: string; libelleAvecContenance?: string; contenance?: number }
  lot?: { idLot?: number; libelle?: string; quantite?: number }
}
export interface MatriceTarif {
  id?: number
  modeleContenant?: { idContenant?: number }
  modeleLot?: { idLot?: number }
  modeleClientType?: { idClientType?: number }
  prixHT?: number
  horsDroits?: boolean
}
export interface MatriceProduit {
  modeleProduit?: { idProduit?: number; libelle?: string; nom?: string }
  tarifs?: MatriceTarif[]
}
export interface ModeleMatriceTarif {
  conditionnements?: MatriceConditionnement[]
  produits?: MatriceProduit[]
}

/**
 * GET /parametres/grille-tarifaire/matrice?idClientType=… — grille d'UN type de
 * client. Renvoie {} pour un type sans grille propre (héritée). `POST …/liste`
 * est inutilisable (500 systématique) → toujours passer par la matrice.
 */
export async function matriceGrille(idClientType: number): Promise<ModeleMatriceTarif> {
  const { status, json } = await eb<ModeleMatriceTarif>(
    'GET',
    `/parametres/grille-tarifaire/matrice?idClientType=${idClientType}`,
  )
  if (status !== 200) throw new Error(`Easybeer ${status} sur /parametres/grille-tarifaire/matrice`)
  return json ?? {}
}

// --- Tarifs ---

export interface PrixProduit {
  idProduitPrix?: number
  prixHT?: number
  horsDroits?: boolean
}

/**
 * GET /parametres/prix/{idStockBouteille}/{idClientType}/{idClient} —
 * prix d'UN produit pour LE client connecté (type + id réels : les prix varient
 * par grille ET par tarifs custom client, cf. EASYBEER.md).
 * Grille sans tarif défini → objet sans `prixHT` (pas une erreur).
 */
export async function getPrix(
  idStockBouteille: number,
  idClientType: number,
  idClient: number,
): Promise<PrixProduit | null> {
  const { status, json } = await eb<PrixProduit>(
    'GET',
    `/parametres/prix/${idStockBouteille}/${idClientType}/${idClient}`,
  )
  if (status !== 200) throw new Error(`Easybeer ${status} sur /parametres/prix/${idStockBouteille}`)
  // Corps vide (throttling) → null pour déclencher un retry côté sync.
  if (json == null || Object.keys(json).length === 0) return null
  return json
}

// --- Commande ---

export interface LigneCommandeInput {
  produit: ProduitAutocomplete
  quantite: number
  prixUnitaireHT: number
  remise?: string | null
  remise2?: string | null
  typeRemise2?: string | null
  remiseLibelle?: string | null
  remise2Libelle?: string | null
  valeurRemise?: number | null
  prixUnitaireHTRemise?: number | null
  prixTotalHT?: number | null
}

export interface EnregistrerCommandeInput {
  idClient: number
  idGrilleTarifaire: number
  idGrilleTarifaireFallback?: number | null
  tauxTVA: ModeleTauxTVA
  commentaire: string
  estDevis: boolean
  lignes: LigneCommandeInput[]
}

export interface ResultatEnregistrement {
  id?: number
  numero?: number
  message?: string
  brut: unknown
}

function champsRemiseLigne(l: LigneCommandeInput) {
  return {
    ...(l.remise ? { remise: l.remise } : {}),
  }
}

/**
 * POST /commande/enregistrer — recette VÉRIFIÉE (cf. EASYBEER.md).
 * Références légères par id ; tauxTVAFraisLivraison requis ; succès => { map: { id, numero } }.
 */
export async function enregistrerCommande(input: EnregistrerCommandeInput): Promise<ResultatEnregistrement> {
  const tauxTVACommande = tauxTVAValide(input.tauxTVA)
  const payload = {
    client: { idClient: input.idClient },
    grilleTarifaire: { idClientType: input.idGrilleTarifaire },
    tauxTVAFraisLivraison: tauxTVACommande,
    commentaire: input.commentaire || 'Commande plateforme GOA',
    estDevis: input.estDevis,
    elementsBouteilles: input.lignes.map((l) => ({
      stockBouteille: { idStockBouteille: l.produit.idStockBouteille },
      stockProduit: l.produit,
      quantite: l.quantite,
      prixUnitaireHTHorsRemise: l.prixUnitaireHT,
      prixLotHT: l.prixUnitaireHT,
      ...champsRemiseLigne(l),
      designation: l.produit.libelle,
      tauxTVA: tauxTVAValide(l.produit.tauxTVA ?? tauxTVACommande),
      tarifHorsDroits: false,
    })),
  }
  const { status, json } = await eb<{
    succes?: boolean
    message?: string
    map?: { id?: number; numero?: number; message?: string }
  }>('POST', '/commande/enregistrer', payload)

  const id = json?.map?.id
  if (status !== 200 || json?.succes === false || id == null) {
    console.warn('[easybeer] /commande/enregistrer refusé', {
      status,
      idClient: input.idClient,
      idGrilleTarifaire: input.idGrilleTarifaire,
      idTauxTVA: tauxTVACommande.idTauxTVA,
      nbLignes: input.lignes.length,
      premiereLigne: input.lignes[0]
        ? {
            idStockBouteille: input.lignes[0].produit.idStockBouteille,
            quantite: input.lignes[0].quantite,
            prixUnitaireHT: input.lignes[0].prixUnitaireHT,
            idTauxTVA: tauxTVAValide(input.lignes[0].produit.tauxTVA ?? tauxTVACommande).idTauxTVA,
          }
        : null,
      message: json?.message || json?.map?.message || null,
    })
    throw new Error(`Easybeer ${status} sur /commande/enregistrer — ${json?.message || json?.map?.message || 'échec inconnu'}`)
  }
  return { id, numero: json.map?.numero, message: json.map?.message, brut: json }
}

/**
 * Modification de commande EN PLACE (upsert vérifié, EASYBEER.md §4) :
 * on relit l'objet complet via /commande/edition/{id}, on remplace lignes et
 * commentaire, puis on re-POST /commande/enregistrer avec le même idCommande
 * → même id, même numéro, pas de doublon.
 *
 * Les lignes existantes sont mises à jour en conservant leur objet d'origine
 * (ids d'éléments Easybeer préservés) ; les lignes retirées sont supprimées du
 * tableau ; les nouvelles sont construites comme à la création.
 */
export async function modifierCommande(input: {
  idCommande: number
  commentaire: string
  lignes: LigneCommandeInput[]
}): Promise<ResultatEnregistrement> {
  const { status, json: commande } = await eb<Record<string, unknown>>(
    'GET',
    `/commande/edition/${input.idCommande}`,
  )
  if (status !== 200) throw new Error(`Easybeer ${status} sur /commande/edition/${input.idCommande}`)

  const tauxTVACommande = tauxTVAValide((commande.tauxTVAFraisLivraison as ModeleTauxTVA | undefined) ?? input.lignes[0]?.produit.tauxTVA)
  commande.tauxTVAFraisLivraison = tauxTVACommande

  const existants = (commande.elementsBouteilles as Record<string, unknown>[] | undefined) ?? []
  const parIdStock = new Map(
    existants.map((e) => [(e.stockBouteille as { idStockBouteille?: number })?.idStockBouteille, e]),
  )

  commande.elementsBouteilles = input.lignes.map((l) => {
    const existant = parIdStock.get(l.produit.idStockBouteille)
    if (existant) {
      return {
        ...existant,
        quantite: l.quantite,
        prixUnitaireHTHorsRemise: l.prixUnitaireHT,
        prixLotHT: l.prixUnitaireHT,
        ...champsRemiseLigne(l),
        tauxTVA: tauxTVAValide((existant.tauxTVA as ModeleTauxTVA | undefined) ?? l.produit.tauxTVA ?? tauxTVACommande),
        tarifHorsDroits: false,
      }
    }
    return {
      stockBouteille: { idStockBouteille: l.produit.idStockBouteille },
      stockProduit: l.produit,
      quantite: l.quantite,
      prixUnitaireHTHorsRemise: l.prixUnitaireHT,
      prixLotHT: l.prixUnitaireHT,
      ...champsRemiseLigne(l),
      designation: l.produit.libelle,
      tauxTVA: tauxTVAValide(l.produit.tauxTVA ?? tauxTVACommande),
      tarifHorsDroits: false,
    }
  })
  commande.commentaire = input.commentaire

  const { status: statusEnr, json } = await eb<{
    succes?: boolean
    message?: string
    map?: { id?: number; numero?: number; message?: string }
  }>('POST', '/commande/enregistrer', commande)

  const id = json?.map?.id
  if (statusEnr !== 200 || json?.succes === false || id == null) {
    console.warn('[easybeer] /commande/enregistrer upsert refusé', {
      status: statusEnr,
      idCommande: input.idCommande,
      idTauxTVA: tauxTVACommande.idTauxTVA,
      nbLignes: input.lignes.length,
      message: json?.message || json?.map?.message || null,
    })
    throw new Error(`Easybeer ${statusEnr} sur /commande/enregistrer (upsert) — ${json?.message || json?.map?.message || 'échec inconnu'}`)
  }
  return { id, numero: json.map?.numero, message: json.map?.message, brut: json }
}

/** GET /commande/supprimer/{id} — nettoyage d'un devis/commande de test. */
export async function supprimerCommande(idCommande: number): Promise<void> {
  const { status } = await eb('GET', `/commande/supprimer/${idCommande}`)
  if (status !== 200) throw new Error(`Easybeer ${status} sur /commande/supprimer/${idCommande}`)
}

export interface CommandeResume {
  idCommande?: number
  numero?: number
  client?: { idClient?: number; nom?: string; numero?: string }
  etat?: { code?: string; libelle?: string; couleur?: string } | string
  paiementEtat?: { code?: string; libelle?: string } | string
  reference?: string
  dateFacturation?: string | number
  facture?: unknown
  numeroFacture?: string
  documents?: unknown[]
  totalTTC?: number
  totalHT?: number
  dateCreation?: string | number
  /** Flag natif Easybeer (résumé de liste). */
  estModifiable?: boolean
}

export interface ListeCommandesPage {
  liste: CommandeResume[]
  totalElements: number
  totalPages: number
}

export interface DocumentCommandeResume {
  idCommande?: number
  idCommandeDocument?: number
  code?: string
  numeroCommande?: number
  estFacture?: boolean
  annule?: boolean
  type?: { code?: string; libelle?: string }
}

export interface ListeDocumentsPage {
  liste: DocumentCommandeResume[]
  totalElements: number
  totalPages: number
}

/** Une page brute de /commande/liste (tous clients, tri numero CROISSANT — seul tri fiable). */
async function pageCommandes(numeroPage: number, nombreParPage: number): Promise<ListeCommandesPage> {
  const params = new URLSearchParams({
    colonneTri: 'numero',
    numeroPage: String(numeroPage),
    nombreParPage: String(nombreParPage),
  })
  const { status, json } = await eb<ListeCommandesPage>('POST', `/commande/liste/DEVIS?${params.toString()}`, {
    inclureArchive: true,
  })
  if (status !== 200) throw new Error(`Easybeer ${status} sur /commande/liste (admin)`)
  return { liste: json?.liste ?? [], totalElements: json?.totalElements ?? 0, totalPages: json?.totalPages ?? 1 }
}

async function pageDocumentsFactures(numeroPage: number, nombreParPage: number): Promise<ListeDocumentsPage> {
  const params = new URLSearchParams({
    colonneTri: 'dateCreation',
    numeroPage: String(numeroPage),
    nombreParPage: String(nombreParPage),
  })
  const { status, json } = await eb<ListeDocumentsPage>('POST', `/document/liste?${params.toString()}`, {
    filtre: { types: ['FACTURE'], etatEnvoi: 'TOUS' },
  })
  if (status !== 200) throw new Error(`Easybeer ${status} sur /document/liste (factures)`)
  return { liste: json?.liste ?? [], totalElements: json?.totalElements ?? 0, totalPages: json?.totalPages ?? 1 }
}

export async function listeDocumentsFacturesRecentes(limite = 500): Promise<DocumentCommandeResume[]> {
  const parPage = 100
  const pagesMax = Math.ceil(limite / parPage)
  let documents: DocumentCommandeResume[] = []
  for (let page = 1; page <= pagesMax; page++) {
    const p = await pageDocumentsFactures(page, parPage)
    documents = [...documents, ...p.liste]
    if (p.liste.length < parPage) break
  }
  return documents.filter((d) => !d.annule && d.idCommande != null)
}

/**
 * Les N commandes les plus récentes, tous clients (usage admin).
 * Contraintes API (vérifiées 2026-07-09) : seul tri fiable = `numero`
 * CROISSANT (`mode`/`dateCreation` inopérants) et `totalElements`/`totalPages`
 * sont FAUX sur cet endpoint → scan séquentiel jusqu'à une page incomplète,
 * puis on garde la fin et on inverse. `depuisMs` filtre ensuite côté serveur :
 * Easybeer ne fournit pas de filtre date fiable pour la liste globale.
 */
export async function listeCommandesRecentes(
  limite = 100,
  depuisMs: number | null = null,
): Promise<{ commandes: CommandeResume[]; totalElements: number }> {
  const parPage = 100
  const PAGES_MAX = 40 // garde-fou
  let toutes: CommandeResume[] = []
  for (let page = 1; page <= PAGES_MAX; page++) {
    const p = await pageCommandes(page, parPage)
    toutes = [...toutes, ...p.liste]
    if (p.liste.length < parPage) break
  }
  const filtrees = filtrerCommandesDepuis(toutes, depuisMs)
  return { commandes: filtrees.slice(-limite).reverse(), totalElements: toutes.length }
}

export function filtrerCommandesDepuis(commandes: CommandeResume[], depuisMs: number | null): CommandeResume[] {
  if (depuisMs == null) return commandes
  return commandes.filter((cmd) => {
    const ts = cmd.dateCreation == null ? 0 : new Date(cmd.dateCreation).getTime() || 0
    return ts >= depuisMs
  })
}

/**
 * POST /commande/liste/{etat} — historique COMPLET d'un client (recette
 * EASYBEER.md validée) : body { idClient, inclureArchive: true } OBLIGATOIRE
 * (sans inclureArchive → 200 corps vide) ; l'{etat} du path est ignoré quand
 * idClient est présent → 1 seul appel pour tout l'historique.
 */
export async function listeCommandesClient(idClient: number): Promise<CommandeResume[]> {
  const params = new URLSearchParams({ colonneTri: 'numero', numeroPage: '1', nombreParPage: '200' })
  const { status, json } = await eb<{ liste?: CommandeResume[] }>(
    'POST',
    `/commande/liste/DEVIS?${params.toString()}`,
    { idClient, inclureArchive: true },
  )
  if (status !== 200) throw new Error(`Easybeer ${status} sur /commande/liste`)
  return json?.liste ?? []
}

/**
 * GET /commande/detail/{id} — LECTURE d'une commande, quel que soit son état
 * (⚠️ /commande/edition renvoie 400 sur les commandes non modifiables —
 * il est réservé au flux de modification, cf. EASYBEER.md).
 * Contient lignes (elementsBouteilles[]) ET documents[] (BC, factures, avoirs).
 */
export async function detailCommande(idCommande: number): Promise<Record<string, unknown>> {
  const { status, json } = await eb<Record<string, unknown>>('GET', `/commande/detail/${idCommande}`)
  if (status !== 200) throw new Error(`Easybeer ${status} sur /commande/detail/${idCommande}`)
  return json
}

/** GET /commande/document/telecharger/{id} — flux binaire du PDF. */
export async function telechargerDocument(
  idCommandeDocument: number,
): Promise<{ corps: ArrayBuffer; contentType: string }> {
  return passerParLaFile(async () => {
    const res = await fetch(`${BASE}/commande/document/telecharger/${idCommandeDocument}`, {
      headers: { Authorization: BASIC_AUTH },
    })
    if (!res.ok) throw new Error(`Easybeer ${res.status} sur /commande/document/telecharger/${idCommandeDocument}`)
    return { corps: await res.arrayBuffer(), contentType: res.headers.get('content-type') ?? 'application/pdf' }
  })
}
