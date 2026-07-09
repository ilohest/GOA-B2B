/**
 * Suite du banc d'essai (2026-07-09) :
 *  1. sur le client fictif 824612 : découverte des codes des autres modes de
 *     livraison (surtout « livraison par nos soins »)
 *  2. suppression de la tournée « ZZZ TEST TOURNEE » restée orpheline
 *  3. suppression du client fictif
 * Résultats à reporter dans EASYBEER.md.
 */
import { config } from '../src/config.js'

const ID_CLIENT_TEST = Number(process.argv[2] ?? 824612)
const auth = 'Basic ' + Buffer.from(`${config.easybeer.username}:${config.easybeer.password}`).toString('base64')
const delai = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function eb(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  await delai(1200)
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
  if ((res.status === 400 && text.includes('banned')) || res.status === 429) {
    throw new Error(`BAN pendant ${path}`)
  }
  let json: any = {}
  try {
    json = text ? JSON.parse(text.replace(/[ -]/g, ' ')) : {}
  } catch {
    json = { _raw: text.slice(0, 200) }
  }
  return { status: res.status, json }
}

try {
  // 0. Le client fictif existe-t-il toujours ?
  const fiche = await eb('GET', `/parametres/client/edition/${ID_CLIENT_TEST}`)
  const existe = fiche.json?.idClient === ID_CLIENT_TEST
  console.log(`client fictif ${ID_CLIENT_TEST} : ${existe ? 'présent' : 'déjà supprimé'}`)

  // 1. Découverte des codes restants (relire après CHAQUE écriture)
  if (existe) {
    console.log('\n--- Codes de livraison restants ---')
    // Déjà validés : TRANSPORTEUR, ENLEVEMENT. Déjà éliminés (échec silencieux) :
    // NOS_SOINS, LIVREUR, DIRECT, SERVICE, LIVRAISON_TRANSPORTEUR.
    const candidats = ['POINT_RETRAIT', 'LIVRAISON', 'PAR_NOS_SOINS', 'LIVRAISON_DIRECTE', 'AVEC_SERVICE']
    for (const candidat of candidats) {
      await eb('POST', '/parametres/client/type-livraison/attribuer', {
        idsClients: [ID_CLIENT_TEST],
        typeLivraisonFavFormulaire: [candidat],
      })
      const relu = await eb('GET', `/parametres/client/edition/${ID_CLIENT_TEST}`)
      console.log(`« ${candidat} » → typeLivraisonFav = ${JSON.stringify(relu.json?.typeLivraisonFav)}`)
    }
  }

  // 2. Tournée orpheline
  console.log('\n--- Tournées ---')
  const tournees = await eb('GET', '/parametres/client/tournee')
  const orpheline = (tournees.json as any[])?.find((t) => t.libelle?.startsWith('ZZZ TEST'))
  console.log('tournées :', (tournees.json as any[])?.map((t) => `${t.idClientTournee}:${t.libelle}`).join(' | '))
  if (orpheline) {
    await eb('POST', '/parametres/client/tournee/supprimer', {
      idClientTournee: orpheline.idClientTournee,
      detacherClients: true,
    })
    const verif = await eb('GET', '/parametres/client/tournee')
    const encore = (verif.json as any[])?.some((t) => t.libelle?.startsWith('ZZZ TEST'))
    console.log(`tournée ${orpheline.idClientTournee} supprimée → encore présente : ${encore}`)
  }

  // 3. Suppression du client fictif + vérification
  if (existe) {
    console.log('\n--- Suppression du client fictif ---')
    const suppression = await eb('GET', `/parametres/client/supprimer/${ID_CLIENT_TEST}`)
    console.log('supprimer →', suppression.status, JSON.stringify(suppression.json).slice(0, 150))
    const verif = await eb('GET', `/parametres/client/edition/${ID_CLIENT_TEST}`)
    console.log(
      'relecture →',
      verif.status,
      '| toujours présent :',
      verif.json?.idClient === ID_CLIENT_TEST,
      '| actif :',
      verif.json?.actif,
    )
  }
} catch (e) {
  console.error('⛔', (e as Error).message, '— relancer ce script plus tard pour finir le nettoyage.')
}
