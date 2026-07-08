/**
 * Service d'accès à l'API Easybeer.
 *
 * Toutes les requêtes passent par le préfixe local `/api`, intercepté par le
 * proxy de dev de Vite (voir vite.config.ts) qui :
 *   1. relaie vers https://api.easybeer.fr,
 *   2. injecte l'en-tête Authorization: Basic <base64> côté serveur.
 *
 * => Aucun identifiant Easybeer n'est jamais présent dans le code front / le navigateur.
 */

const API_PREFIX = '/api'

// --- Types dérivés de la spécification OpenAPI (easybeer-api-docs.json) ---

/** Corps de requête `ModeleClientFiltre` — tous les champs sont optionnels. */
export interface ModeleClientFiltre {
  recherche?: string
  codePostal?: string
  pays?: string
  email?: string
  inclureProspect?: boolean
  supprime?: boolean
  idsClients?: number[]
  // ... (la spec expose ~50 champs de filtre, ajoutés au besoin)
}

/** Adresse imbriquée dans un client (sous-ensemble utile au POC). */
export interface ModeleAdresse {
  ligne1?: string
  ligne2?: string
  codePostal?: string
  ville?: string
  pays?: string
}

/** Type de client (`ModeleClientType`, sous-ensemble). */
export interface ModeleClientType {
  idClientType?: number
  libelle?: string
  /** Parent dans la hiérarchie ; une grille tarifaire est une RACINE (idParent vide). */
  idParent?: number
  libelleParent?: string
}

/** `ModeleClient` — sous-ensemble des champs exploités dans l'affichage. */
export interface ModeleClient {
  idClient?: number
  nom?: string
  raisonSociale?: string
  numero?: string
  emailPrincipal?: string
  telephonePrincipal?: string
  adresse?: ModeleAdresse
  actif?: boolean
  /** Grille tarifaire du client — obligatoire pour enregistrer une commande. */
  type?: ModeleClientType
}

/** Réponse paginée `ListePagineeOfModeleClient`. */
export interface ListePagineeOfModeleClient {
  liste: ModeleClient[]
  totalElements: number
  totalPages: number
}

/** Paramètres de pagination passés en query string par `/parametres/client/liste`. */
export interface PaginationParams {
  colonneTri?: string
  numeroPage?: number
  nombreParPage?: number
  mode?: string
}

/**
 * POST /parametres/client/liste
 *
 * D'après la spec, la pagination (colonneTri / nombreParPage / numeroPage)
 * voyage en QUERY STRING, et le ModeleClientFiltre dans le BODY.
 */
export async function listeClients(
  filtre: ModeleClientFiltre = {},
  pagination: PaginationParams = {},
): Promise<ListePagineeOfModeleClient> {
  const {
    colonneTri = 'nom',
    // ⚠️ La pagination Easybeer est indexée à partir de 1 : numeroPage=0
    // renvoie un HTTP 500 ("erreur inconnue"). La 1re page est donc 1.
    numeroPage = 1,
    nombreParPage = 25,
    mode,
  } = pagination

  const params = new URLSearchParams({
    colonneTri,
    numeroPage: String(numeroPage),
    nombreParPage: String(nombreParPage),
  })
  if (mode) params.set('mode', mode)

  const res = await fetch(`${API_PREFIX}/parametres/client/liste?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(filtre),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Easybeer ${res.status} ${res.statusText} sur /parametres/client/liste${detail ? ` — ${detail}` : ''}`,
    )
  }

  return (await res.json()) as ListePagineeOfModeleClient
}

// ===========================================================================
// PHASE 3 — Injection d'une commande de test
// ===========================================================================

/** Référence TVA renvoyée par l'autocomplete produit (sous-ensemble). */
export interface ModeleTauxTVA {
  idTauxTVA?: number
  libelle?: string
  taux?: number
}

/**
 * Élément renvoyé par `GET /stock/produits/autocomplete`.
 * C'est la source pour choisir un vrai produit (idStockBouteille) à commander.
 */
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

/**
 * GET /stock/produits/autocomplete
 *
 * ⚠️ Piège constaté : passer `idClient` en query renvoie un HTTP 500. On
 * appelle donc l'autocomplete SANS idClient. `accesPro=true` renvoie les
 * cartons (colisage pro) plutôt que les bouteilles à l'unité.
 */
export async function listeProduitsAutocomplete(
  accesPro = true,
): Promise<ProduitAutocomplete[]> {
  const params = new URLSearchParams({ accesPro: String(accesPro) })
  const res = await fetch(`${API_PREFIX}/stock/produits/autocomplete?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Easybeer ${res.status} ${res.statusText} sur /stock/produits/autocomplete${detail ? ` — ${detail}` : ''}`,
    )
  }
  return (await res.json()) as ProduitAutocomplete[]
}

/**
 * GET /parametres/client/type
 *
 * Liste des types de client. Les RACINES (idParent vide) sont les vraies
 * grilles tarifaires (ex. « client PRO ») ; les enfants (GMS, CHR…) sont des
 * sous-catégories CRM qui héritent de la grille de leur parent.
 */
export async function listeTypesClient(): Promise<ModeleClientType[]> {
  const res = await fetch(`${API_PREFIX}/parametres/client/type`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Easybeer ${res.status} ${res.statusText} sur /parametres/client/type${detail ? ` — ${detail}` : ''}`,
    )
  }
  return (await res.json()) as ModeleClientType[]
}

/**
 * Une ligne « bouteille » de la commande (sous-ensemble de ModeleCommandeElement).
 *
 * Constat issu d'une vraie commande : le champ `stockProduit` doit contenir
 * l'OBJET COMPLET renvoyé par l'autocomplete (pas seulement quelques ids),
 * sinon le serveur plante (500). On y recopie donc tout l'item d'autocomplete.
 */
export interface CommandeElementBouteille {
  stockBouteille: { idStockBouteille: number }
  /** Objet produit complet tel que renvoyé par /stock/produits/autocomplete. */
  stockProduit: ProduitAutocomplete
  quantite: number
  /** Prix unitaire HT hors remise (fixé en dur pour le POC). */
  prixUnitaireHTHorsRemise: number
  /** Prix du lot HT — sur une vraie ligne, égal au prix unitaire hors remise. */
  prixLotHT?: number
  designation?: string
  tauxTVA?: ModeleTauxTVA
  tarifHorsDroits?: boolean
}

/**
 * Payload de `POST /commande/enregistrer` (sous-ensemble de ModeleCommande).
 *
 * Champs requis confirmés par diagnostic sur l'API réelle :
 *   client, grilleTarifaire, commentaire, tauxTVAFraisLivraison, elementsBouteilles.
 * Les références légères (par id) suffisent : pas besoin d'envoyer les objets complets.
 */
export interface CommandePayload {
  client: { idClient: number }
  /** Grille tarifaire (RACINE) — 400 « Vous devez choisir une grille tarifaire » si absente. */
  grilleTarifaire: { idClientType: number }
  /** TVA des frais de livraison — son absence provoque un 500 « erreur inconnue ». */
  tauxTVAFraisLivraison: ModeleTauxTVA
  /** Requis (même vide interdit) — commentaire libre de la commande. */
  commentaire: string
  /** true => crée un DEVIS (réversible facilement) ; false => commande ferme. */
  estDevis?: boolean
  elementsBouteilles: CommandeElementBouteille[]
}

/**
 * Résultat de `POST /commande/enregistrer`.
 *
 * ⚠️ En cas de succès, l'API répond HTTP 200 avec `{ map: { id, numero, message } }`
 * (et NON un { idCommande } ni un ModeleResultat classique). En cas d'échec
 * métier, elle répond `{ succes:false, message, map:{} }`.
 */
export interface ResultatEnregistrement {
  /** idCommande de la commande/devis créé (= map.id). */
  id?: number
  /** Numéro affiché de la commande/devis (= map.numero). */
  numero?: number
  message?: string
  /** Réponse brute, conservée pour le debug. */
  brut: unknown
}

/**
 * POST /commande/enregistrer
 *
 * ⚠️ Écrit une VRAIE commande (ou un devis) dans l'ERP Easybeer de prod.
 * À déclencher uniquement via une action explicite de l'utilisateur.
 */
export async function enregistrerCommande(
  payload: CommandePayload,
): Promise<ResultatEnregistrement> {
  const res = await fetch(`${API_PREFIX}/commande/enregistrer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = (await res.json().catch(() => ({}))) as {
    succes?: boolean
    message?: string
    map?: { id?: number; numero?: number; message?: string }
  }
  // Échec : HTTP non-2xx, ou succes:false explicite, ou pas d'id retourné.
  const id = json?.map?.id
  if (!res.ok || json?.succes === false || id == null) {
    throw new Error(
      `Easybeer ${res.status} sur /commande/enregistrer — ${json?.message || 'échec inconnu'}`,
    )
  }
  return { id, numero: json.map?.numero, message: json.map?.message, brut: json }
}

/**
 * GET /commande/supprimer/{idCommande}
 * Nettoyage : supprime la commande/devis de test créé ci-dessus.
 */
export async function supprimerCommande(idCommande: number): Promise<void> {
  const res = await fetch(`${API_PREFIX}/commande/supprimer/${idCommande}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Easybeer ${res.status} ${res.statusText} sur /commande/supprimer/${idCommande}${detail ? ` — ${detail}` : ''}`,
    )
  }
}
