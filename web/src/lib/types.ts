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

/** Résumé client servi depuis le cache serveur. */
export interface ClientResume {
  idClient: number | null
  nom: string | null
  raisonSociale: string | null
  numero: string | null
  emailPrincipal: string | null
  categorie: string | null
  actif: boolean
}

export interface AdminClientsResponse {
  clients: ClientResume[]
  comptes: Record<number, { statut: 'invited' | 'active'; emails: string[] }>
  syncedAt: number | null
  indisponible?: boolean
  retryAfterSeconds?: number
}

export interface AdminDashboardResponse {
  clients: { total: number; avecCompte: number; actifs: number }
  commandes30j: { nombre: number; caHT: number; caTTC: number }
  catalogue: { produits: number; visibles: number; ruptures: number }
  dernierSync: number | null
}

export interface CatalogueOverride {
  visible: boolean
  displayName: string
  photoUrl: string
  rupture: boolean
}

export interface CatalogueAdminTarif {
  idClientType: number
  typeClient: string
  prixHT: number
}

/** Une unité commandable (idStockBouteille) + ses tarifs par type de client. */
export interface CatalogueAdminUnite {
  idStockBouteille: number
  produit: string
  contenant: string
  packaging: string
  quantite: number | null
  libelleEasybeer: string | null
  override: CatalogueOverride
  tarifs: CatalogueAdminTarif[]
}

export interface CatalogueAdminResponse {
  syncedAt: number | null
  unites: CatalogueAdminUnite[]
}

export interface ProduitCatalogueClient {
  idStockBouteille: number
  libelle: string
  libelleEasybeer: string
  photoUrl: string | null
  rupture: boolean
  prixHT: number | null
  prixUpdatedAt: number | null
  prixEstFrais: boolean
  /** Incrément de quantité imposé (1 sauf clients La Poste : 3 ou 2). */
  pas: number
}

export interface CatalogueClientResponse {
  produits: ProduitCatalogueClient[]
  syncedAt: number
  prixMaxAgeMinutes: number
  prixPlusAncienAgeMs: number | null
}

export interface SyncReport {
  produits: number
  typesClient: number
  clients: { idClient: number; nom: string | null; prix: number; erreur?: string }[]
  dureeMs: number
  syncedAt: number
}

export interface SyncStatusResponse {
  now: number
  nowIso: string
  banMemoire: { banni: boolean; secondesRestantes: number }
  banPersiste: null | {
    until: number
    untilIso: string
    secondesRestantes: number
    actif: boolean
  }
  verrou: null | {
    startedAt: number
    startedAtIso: string
    ageMs: number | null
    ageMinutes: number | null
  }
  dernierSync: SyncReport | null
  syncIntervalMinutes: number
}

export interface InvitationResponse {
  ok: boolean
  email: string
  lien: string
  /** true si l'email a bien été envoyé via SMTP (sinon : lien à copier). */
  envoye: boolean
  erreurEmail?: string
  expiresAt: number
  client: { idClient?: number; nom?: string; numero?: string }
}

export interface InvitationValidation {
  etat: 'valide' | 'introuvable' | 'expire' | 'utilise' | 'revoque'
  email?: string
  nom?: string
}

export interface MeResponse {
  user: AuthUser
  client: ClientEasybeer | null
  idGrilleTarifaire: number | null
}

export interface EtatCommande {
  code: string
  libelle: string
  couleur: string | null
}

export interface CommandeResume {
  idCommande: number
  numero: number | null
  totalTTC: number | null
  totalHT: number | null
  /** Epoch millis (normalisé côté serveur). */
  dateCreation: number | null
  etat: EtatCommande
  modifiable: boolean
}

export interface CommandesClientResponse {
  commandes: CommandeResume[]
  syncedAt?: number | null
  indisponible?: boolean
  source?: 'local' | 'aucune'
  code?: string
}

export interface AdminCommandeResume {
  idCommande: number
  numero: number | null
  client: { idClient: number | null; nom: string | null; numero: string | null } | null
  etat: EtatCommande
  paiement: string | null
  facture: { existe: boolean; numero: string | null } | null
  totalHT: number | null
  totalTTC: number | null
  dateCreation: number | null
}

export interface AdminCommandesResponse {
  commandes: AdminCommandeResume[]
  syncedAt: number | null
  indisponible?: boolean
  retryAfterSeconds?: number
  easybeerAppUrl: string
}

export interface AdminClientDetail {
  client: {
    idClient: number
    nom: string | null
    raisonSociale: string | null
    numero: string | null
    emailPrincipal: string | null
    telephonePrincipal: string | null
    adresseFacturation: string | null
    adresseLivraison: string | null
    categorie: string | null
    minimumCommande: number | null
    fraisLivraisonHT: number | null
    remise: string | null
    remise2: string | null
    typeRemise2: string | null
    nbRemisesCiblees: number
    typeLivraisonFav: string | null
    tournee: string | null
    tags: string[] | string | null
  }
  commandes: {
    idCommande: number
    numero: number | null
    etat: EtatCommande
    totalTTC: number | null
    dateCreation: number | null
  }[]
  comptes: { email: string; status: string }[]
  easybeerAppUrl: string
}

export interface Tournee {
  idClientTournee?: number
  libelle?: string
  minimumCommande?: number
}

export interface InvitationBulkResultat {
  easybeerIdClient: number
  ok: boolean
  email?: string
  lien?: string
  envoye?: boolean
  erreurEmail?: string
  client?: { idClient?: number; nom?: string; numero?: string }
  erreur?: string
}

export interface CommandeDetail {
  idCommande: number
  numero: number | null
  reference: string | null
  etat?: EtatCommande
  totalHT: number | null
  totalTTC: number | null
  remiseTotale: number | null
  totalConsigne: number | null
  commentaire: string
  lignes: { designation: string; quantite: number; prixUnitaireHT: number | null }[]
  documents: { idCommandeDocument: number; libelle: string; code: string; nomFichier: string }[]
}

export interface CommandeEdition {
  idCommande: number
  numero: number | null
  etat: string
  modifiable: boolean
  commentaire: string
  lignes: { idStockBouteille: number | null; quantite: number }[]
}
