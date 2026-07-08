// Types partagés avec le backend (sous-ensembles exploités côté front).

export interface ProduitAutocomplete {
  idStockBouteille: number
  libelle: string
  entrepot?: string
  quantiteDisponible?: number
  estUnitaire?: boolean
  idProduit?: number
  idContenant?: number
  idLot?: number
  tauxTVA?: { idTauxTVA?: number; taux?: number }
}

export interface ClientEasybeer {
  idClient?: number | null
  nom?: string | null
  raisonSociale?: string | null
  numero?: string | null
  emailPrincipal?: string | null
  adresse?: { complete?: string; codePostal?: string; ville?: string }
  type?: { idClientType?: number | null; libelle?: string | null } | null
  // Paramètres commerciaux (fiche allégée du cache serveur)
  minimumCommande?: number | null
  typeLivraisonFav?: string | null
  tags?: string[] | string | null
}

export interface AuthUser {
  uid: string
  email?: string
  role: 'client' | 'admin'
  status?: 'invited' | 'active'
  easybeerIdClient?: number
}

export interface AdminClientsResponse {
  liste: ClientEasybeer[]
  totalElements: number
  totalPages: number
  comptes: Record<number, { statut: 'invited' | 'active'; emails: string[] }>
}

export interface CatalogueOverride {
  visible: boolean
  displayName: string
  photoUrl: string
  rupture: boolean
}

export interface CatalogueAdminResponse {
  syncedAt: number
  produits: { produit: ProduitAutocomplete; override: CatalogueOverride }[]
}

export interface ProduitCatalogueClient {
  idStockBouteille: number
  libelle: string
  libelleEasybeer: string
  photoUrl: string | null
  rupture: boolean
  prixHT: number | null
}

export interface CatalogueClientResponse {
  produits: ProduitCatalogueClient[]
  syncedAt: number
}

export interface SyncReport {
  produits: number
  typesClient: number
  clients: { idClient: number; nom: string | null; prix: number; erreur?: string }[]
  dureeMs: number
  syncedAt: number
}

export interface InvitationResponse {
  ok: boolean
  email: string
  lien: string
  dejaActif: boolean
  client: { idClient?: number; nom?: string; numero?: string }
}

export interface MeResponse {
  user: AuthUser
  client: ClientEasybeer | null
  idGrilleTarifaire: number | null
}

export interface CommandeResponse {
  ok: boolean
  orderId: string
  easybeer: { id?: number; numero?: number; message?: string }
}

export interface OrderRecord {
  orderId: string
  easybeerIdCommande?: number
  easybeerNumero?: number
  statut: string
  commentaire?: string
  createdAt?: number
  lignes?: { idStockBouteille: number; quantite: number; prixUnitaireHT: number }[]
}
