import type { Firestore } from 'firebase-admin/firestore'
import { config } from './config.js'
import {
  lancerRafraichissementCatalogue,
  lireCommandesRecentes,
  lireListeClients,
  rapprocherComptesSupprimesEasybeer,
} from './sync.js'

export type EtatCachesPartages = {
  clientsAt: number | null
  commandesAt: number | null
  catalogueAt: number | null
  referentielsAt: number | null
  grilleAt: number | null
}

export type CachesAActualiser = {
  clients: boolean
  commandes: boolean
  catalogue: boolean
}

export function determinerCachesAActualiser(
  etat: EtatCachesPartages,
  maintenant = Date.now(),
): CachesAActualiser {
  const ancien = (date: number | null, minutes: number) =>
    date == null || maintenant - date > minutes * 60_000

  return {
    clients: ancien(etat.clientsAt, config.cache.clientsRefreshAgeMinutes),
    commandes: ancien(etat.commandesAt, config.cache.commandesRefreshAgeMinutes),
    catalogue:
      ancien(etat.catalogueAt, config.cache.catalogueRefreshAgeMinutes) ||
      ancien(etat.referentielsAt, config.cache.catalogueRefreshAgeMinutes) ||
      ancien(etat.grilleAt, config.cache.catalogueRefreshAgeMinutes),
  }
}

async function lireSyncedAt(db: Firestore, chemin: string): Promise<number | null> {
  const snap = await db.doc(chemin).get()
  const valeur = snap.data()?.syncedAt
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null
}

export async function lireEtatCachesPartages(db: Firestore): Promise<EtatCachesPartages> {
  const [clientsAt, commandesAt, catalogueAt, referentielsAt, grilleAt] = await Promise.all([
    lireSyncedAt(db, 'cache/clientsListe'),
    lireSyncedAt(db, 'cache/commandesRecentes'),
    lireSyncedAt(db, 'cache/catalogue'),
    lireSyncedAt(db, 'cache/referentiels'),
    lireSyncedAt(db, 'cache/grilleTarifaire'),
  ])
  return { clientsAt, commandesAt, catalogueAt, referentielsAt, grilleAt }
}

/**
 * Entretien conditionnel exécuté dans une requête Cloud Tasks longue durée.
 * Les refreshs sont séquentiels car Easybeer et le verrou distribué n'acceptent
 * volontairement qu'une synchronisation à la fois.
 */
export async function entretenirCachesPartages(db: Firestore) {
  const avant = await lireEtatCachesPartages(db)
  const demandes = determinerCachesAActualiser(avant)
  const actualises: Array<keyof CachesAActualiser> = []
  const dejaEnCours: Array<keyof CachesAActualiser> = []

  if (demandes.commandes) {
    const resultat = await lireCommandesRecentes(db, true)
    if (resultat.revalidationEnCours) dejaEnCours.push('commandes')
    else if (resultat.revalidationEchouee) throw new Error('Échec du rafraîchissement des commandes')
    else actualises.push('commandes')
  }
  if (demandes.clients) {
    const resultat = await lireListeClients(db, true)
    if (resultat.revalidationEnCours) dejaEnCours.push('clients')
    else if (resultat.revalidationEchouee) throw new Error('Échec du rafraîchissement des clients')
    else {
      await rapprocherComptesSupprimesEasybeer(db, resultat.clients)
      actualises.push('clients')
    }
  }
  if (demandes.catalogue) {
    const resultat = await lancerRafraichissementCatalogue(db)
    if ('enCours' in resultat) dejaEnCours.push('catalogue')
    else actualises.push('catalogue')
  }

  return {
    ok: true,
    demandes,
    actualises,
    dejaEnCours,
    avant,
    apres: actualises.length ? await lireEtatCachesPartages(db) : avant,
  }
}
