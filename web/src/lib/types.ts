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
  remise?: string | null
  remise2?: string | null
  typeRemise2?: string | null
  remisesCiblees?: RemiseCibleeClient[]
  typeLivraisonFav?: string | null
  tags?: string[] | string | null
}

export interface RemiseCibleeClient {
  idProduit?: number | null
  idContenant?: number | null
  idLot?: number | null
  idStockBouteille?: number | null
  quantite?: number | null
  remise?: string | null
  type?: string | null
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
  /** Refresh scopé qui a heurté un ban Easybeer : données du cache + compte à rebours. */
  indisponible?: boolean
  retryAfterSeconds?: number
  enCours?: boolean
}

export interface ProduitCatalogueClient {
  idStockBouteille: number
  idProduit?: number | null
  idContenant?: number | null
  idLot?: number | null
  libelle: string
  libelleEasybeer: string
  contenant: string | null
  packaging: string | null
  photoUrl: string | null
  rupture: boolean
  prixHT: number | null
  prixUpdatedAt: number | null
  prixEstFrais: boolean
  historique: boolean
  /** Incrément de quantité imposé (1 sauf clients La Poste : 3 ou 2). */
  pas: number
}

export interface CatalogueClientResponse {
  produits: ProduitCatalogueClient[]
  syncedAt: number
  prixMaxAgeMinutes: number
  prixPlusAncienAgeMs: number | null
  /** Cache client en cours de création (compte tout juste activé) — prix à venir. */
  cacheEnPreparation?: boolean
  /** Un snapshot valide est affiché pendant sa revalidation en arrière-plan. */
  revalidationEnCours?: boolean
}

/** Réponse de création/modification de commande : totaux réels d'Easybeer. */
export interface CommandeResultat {
  ok: boolean
  totalHT: number
  totalTTC: number | null
  remiseTotale: number | null
  /** true si les totaux viennent d'Easybeer, false = repli local. */
  totauxReels: boolean
  easybeer: { id?: number; numero?: number | null }
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
  reussi: boolean
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
    actif: boolean
    kind: string | null
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
  syncedAt?: number
  /** Cache client en cours de création (compte tout juste activé). */
  cacheEnPreparation?: boolean
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
    remisesCiblees: {
      produit: string | null
      contenant: string | null
      lot: string | null
      quantite: number | null
      remise: string | null
      type: string | null
      dateDebut: string | null
      dateFin: string | null
      identifiants: string[]
    }[]
    remisesType?: {
      idClientType: number | null
      libelle: string | null
      remise: string | null
      remisesCiblees: {
        produit: string | null
        contenant: string | null
        lot: string | null
        quantite: number | null
        remise: string | null
        type: string | null
        dateDebut: string | null
        dateFin: string | null
        identifiants: string[]
      }[]
    }[]
    typeLivraisonFav: string | null
    tournee: string | null
    tags: string[] | string | null
    tarifsPersonnalises: {
      id: number | null
      idProduit: number | null
      idContenant: number | null
      idLot: number | null
      produit: string | null
      contenant: string | null
      packaging: string | null
      prixHT: number
    }[]
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
  remiseLabel: string | null
  modeLivraison: string | null
  commentaire: string
  lignes: {
    designation: string
    quantite: number
    prixUnitaireHT: number | null
    remiseLabel: string | null
    remiseMontant: number | null
    tvaLigne: number | null
    totalHT: number | null
  }[]
  documents: { idCommandeDocument: number; libelle: string; code: string; nomFichier: string }[]
}

export interface CommandeEdition {
  idCommande: number
  numero: number | null
  etat: string
  modifiable: boolean
  commentaire: string
  lignes: { idStockBouteille: number; quantite: number }[]
}
