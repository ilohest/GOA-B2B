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

async function eb<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: BASIC_AUTH,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { _raw: text.slice(0, 300) }
  }
  return { status: res.status, json: json as T }
}

// --- Types (sous-ensembles exploités) ---

export interface ModeleTauxTVA {
  idTauxTVA?: number
  libelle?: string
  taux?: number
}

export interface ModeleAdresse {
  ligne1?: string
  ligne2?: string
  codePostal?: string
  ville?: string
  pays?: string
}

export interface ModeleClientType {
  idClientType?: number
  libelle?: string
  idParent?: number
  libelleParent?: string
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

/** GET /stock/produits/autocomplete — SANS idClient (sinon 500). */
export async function listeProduitsAutocomplete(accesPro = true): Promise<ProduitAutocomplete[]> {
  const params = new URLSearchParams({ accesPro: String(accesPro), afficherTarif: 'true' })
  const { status, json } = await eb<ProduitAutocomplete[]>(
    'GET',
    `/stock/produits/autocomplete?${params.toString()}`,
  )
  if (status !== 200) throw new Error(`Easybeer ${status} sur /stock/produits/autocomplete`)
  return json
}

// --- Commande ---

export interface LigneCommandeInput {
  produit: ProduitAutocomplete
  quantite: number
  prixUnitaireHT: number
}

export interface EnregistrerCommandeInput {
  idClient: number
  idGrilleTarifaire: number
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

/**
 * POST /commande/enregistrer — recette VÉRIFIÉE (cf. EASYBEER.md).
 * Références légères par id ; tauxTVAFraisLivraison requis ; succès => { map: { id, numero } }.
 */
export async function enregistrerCommande(input: EnregistrerCommandeInput): Promise<ResultatEnregistrement> {
  const payload = {
    client: { idClient: input.idClient },
    grilleTarifaire: { idClientType: input.idGrilleTarifaire },
    tauxTVAFraisLivraison: input.tauxTVA,
    commentaire: input.commentaire || 'Commande plateforme GOA',
    estDevis: input.estDevis,
    elementsBouteilles: input.lignes.map((l) => ({
      stockBouteille: { idStockBouteille: l.produit.idStockBouteille },
      stockProduit: l.produit,
      quantite: l.quantite,
      prixUnitaireHTHorsRemise: l.prixUnitaireHT,
      prixLotHT: l.prixUnitaireHT,
      designation: l.produit.libelle,
      tauxTVA: l.produit.tauxTVA ?? input.tauxTVA,
      tarifHorsDroits: true,
    })),
  }
  const { status, json } = await eb<{
    succes?: boolean
    message?: string
    map?: { id?: number; numero?: number; message?: string }
  }>('POST', '/commande/enregistrer', payload)

  const id = json?.map?.id
  if (status !== 200 || json?.succes === false || id == null) {
    throw new Error(`Easybeer ${status} sur /commande/enregistrer — ${json?.message || 'échec inconnu'}`)
  }
  return { id, numero: json.map?.numero, message: json.map?.message, brut: json }
}

/** GET /commande/supprimer/{id} — nettoyage d'un devis/commande de test. */
export async function supprimerCommande(idCommande: number): Promise<void> {
  const { status } = await eb('GET', `/commande/supprimer/${idCommande}`)
  if (status !== 200) throw new Error(`Easybeer ${status} sur /commande/supprimer/${idCommande}`)
}

/** GET /commande/edition/{id} — détail complet (lignes dans elementsBouteilles[]). */
export async function detailCommande(idCommande: number): Promise<Record<string, unknown>> {
  const { status, json } = await eb<Record<string, unknown>>('GET', `/commande/edition/${idCommande}`)
  if (status !== 200) throw new Error(`Easybeer ${status} sur /commande/edition/${idCommande}`)
  return json
}
