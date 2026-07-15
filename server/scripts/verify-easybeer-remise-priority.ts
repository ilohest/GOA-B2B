/**
 * Vérifie la priorité réelle des remises dans Easybeer, sans passer par la
 * logique de la plateforme.
 *
 * Usage depuis la racine :
 *   DOTENV_CONFIG_PATH=.env.local npx --prefix server tsx server/scripts/verify-easybeer-remise-priority.ts
 */
import { config } from '../src/config.js'
import { detailCommande, enregistrerCommande, getClient, listeProduitsAutocomplete, listeTypesClient, supprimerCommande } from '../src/easybeer.js'

const ID_CLIENT = 825435 // CL000246 — ZZZ TEST PLATEFORME REMISES
const ID_STOCK_COLA_CARTON_18 = 133238
const ID_STOCK_FRAMBOISE_CARTON_18 = 116441

const auth = 'Basic ' + Buffer.from(`${config.easybeer.username}:${config.easybeer.password}`).toString('base64')

async function easybeer<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.easybeer.target}${path}`, {
    method,
    headers: {
      Authorization: auth,
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
    json = { _raw: text.slice(0, 400) }
  }
  if (!res.ok) {
    throw new Error(`Easybeer ${res.status} ${path} — ${JSON.stringify(json).slice(0, 400)}`)
  }
  return json as T
}

function afficherRemises(label: string, remises: Record<string, unknown>[] | undefined) {
  console.log(`\n${label}`)
  for (const remise of remises ?? []) {
    const produit = (remise.produit ?? remise.modeleProduit ?? remise.stockProduit ?? {}) as Record<string, unknown>
    const contenant = (remise.contenant ?? remise.modeleContenant ?? {}) as Record<string, unknown>
    const lot = (remise.lot ?? remise.modeleLot ?? {}) as Record<string, unknown>
    console.log({
      remise: remise.remise ?? remise.valeur ?? remise.montant,
      quantite: remise.quantite ?? remise.quantiteMin ?? remise.minimum,
      produit: produit.libelle ?? produit.nom ?? produit.idProduit,
      contenant: contenant.libelleAvecContenance ?? contenant.libelle ?? contenant.idContenant,
      lot: lot.libelle ?? lot.idLot,
    })
  }
}

async function resolverRemise(idClient: number, produit: { idProduit?: number; idContenant?: number; idLot?: number; idStockBouteille: number }, quantite: number) {
  const body = {
    idClient,
    idProduit: produit.idProduit,
    idContenant: produit.idContenant,
    idLot: produit.idLot,
    idStockProduit: produit.idStockBouteille,
    idStockBouteille: produit.idStockBouteille,
    quantite,
  }
  return easybeer<Record<string, unknown>>('POST', '/parametres/remise', body)
}

async function creerDevisSansRemiseLigne(produits: Awaited<ReturnType<typeof listeProduitsAutocomplete>>) {
  const cola = produits.find((p) => p.idStockBouteille === ID_STOCK_COLA_CARTON_18)
  const framboise = produits.find((p) => p.idStockBouteille === ID_STOCK_FRAMBOISE_CARTON_18)
  if (!cola || !framboise) throw new Error('Produits de test introuvables')
  const res = await enregistrerCommande({
    idClient: ID_CLIENT,
    idGrilleTarifaire: 20680,
    tauxTVA: cola.tauxTVA ?? { idTauxTVA: 13087, libelle: '5,5 %', taux: 5.5 },
    commentaire: 'VERIF priorité remises Easybeer — à supprimer',
    estDevis: true,
    lignes: [
      { produit: cola, quantite: 24, prixUnitaireHT: 35.1 },
      { produit: framboise, quantite: 12, prixUnitaireHT: 35.1 },
    ],
  })
  const id = Number(res.id)
  if (!Number.isFinite(id)) throw new Error(`Création devis sans id : ${JSON.stringify(res)}`)
  try {
    const detail = await detailCommande(id)
    return { id, detail }
  } finally {
    await supprimerCommande(id).catch((e) => console.warn(`Suppression devis ${id} échouée : ${(e as Error).message}`))
  }
}

async function main() {
  const [client, types, produits] = await Promise.all([
    getClient(ID_CLIENT),
    listeTypesClient(),
    listeProduitsAutocomplete(),
  ])
  if (!client) throw new Error(`Client ${ID_CLIENT} introuvable`)
  const cola = produits.find((p) => p.idStockBouteille === ID_STOCK_COLA_CARTON_18)
  if (!cola) throw new Error(`Produit ${ID_STOCK_COLA_CARTON_18} introuvable`)
  const typeClient = types.find((t) => t.idClientType === client.type?.idClientType)

  console.log('Client Easybeer lu en direct')
  console.log({
    idClient: client.idClient,
    numero: client.numero,
    nom: client.nom ?? client.raisonSociale,
    type: client.type?.libelle,
    remiseCommandeClient: client.remise ?? null,
    remiseCommandeSegment: typeClient?.remise ?? null,
  })
  afficherRemises('Remises produit sur fiche client', client.listeRemises)
  afficherRemises('Remises produit sur type/segment client', typeClient?.listeRemises)

  console.log('\nRésolveur Easybeer POST /parametres/remise')
  for (const quantite of [1, 3, 9, 10, 24]) {
    const reponse = await resolverRemise(ID_CLIENT, cola, quantite)
    console.log(`Cola carton 18 x ${quantite}`, reponse)
  }

  console.log('\nTest devis Easybeer sans remise envoyée par la plateforme')
  const devis = await creerDevisSansRemiseLigne(produits)
  console.log({
    idCommande: devis.id,
    numero: devis.detail.numero,
    totalHT: devis.detail.totalHT,
    remiseTotale: devis.detail.remiseTotale,
    lignes: ((devis.detail.elementsBouteilles as Record<string, unknown>[] | undefined) ?? []).map((ligne) => ({
      libelle: ((ligne.stockBouteille as Record<string, unknown> | undefined)?.libelle ?? ligne.designation),
      quantite: ligne.quantite,
      remise: ligne.remise ?? null,
      valeurRemise: ligne.valeurRemise ?? null,
      totalHT: ligne.prixTotalHT ?? ligne.totalHT,
    })),
  })
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
