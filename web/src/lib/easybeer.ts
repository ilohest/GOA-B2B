/**
 * Liens profonds vers l'interface web Easybeer, construits sur l'URL de base
 * fournie par le serveur (config `EASYBEER_APP_URL`). Centralisé ici pour que
 * tous les boutons « Ouvrir dans Easybeer » pointent vers la bonne ressource.
 */
const base = (url: string | undefined): string => (url ?? 'https://app.easybeer.fr').replace(/\/+$/, '')

export const easybeerLien = {
  /** Liste des commandes. */
  commandes: (url?: string) => `${base(url)}/commandes`,
  /** Détail d'une commande (l'id de l'URL = idCommande). */
  commandeDetail: (url: string | undefined, idCommande: number) => `${base(url)}/commandes/detail/${idCommande}`,
  /** Liste / paramètres des clients. */
  clients: (url?: string) => `${base(url)}/parametres/clients`,
  /** Grille tarifaire. */
  grilleTarifaire: (url?: string) => `${base(url)}/parametres/grille-tarifaire`,
}
