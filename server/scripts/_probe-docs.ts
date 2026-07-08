import { listeCommandesClient, detailCommande } from '../src/easybeer.js'
const liste = await listeCommandesClient(588074)
const livree = liste.find(c => (typeof c.etat === 'string' ? c.etat : c.etat?.code) === 'LIVREE') ?? liste[0]
console.log('commande sondée:', livree.idCommande, livree.numero)
const d = await detailCommande(livree.idCommande!)
const cles = Object.keys(d).filter(k => /doc|fichier|pdf|facture/i.test(k))
console.log('clés document-like:', cles)
for (const k of cles) console.log(k, '=', JSON.stringify(d[k])?.slice(0, 500))
console.log('reference:', d.reference, '| dateFacturation:', d.dateFacturation)
