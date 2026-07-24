import { Buffer } from 'node:buffer'

export interface FichierZip {
  nom: string
  contenu: ArrayBuffer | Uint8Array
  date?: Date
}

const tableCrc = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Uint8Array) {
  let crc = 0xffffffff
  for (const octet of buffer) crc = tableCrc[(crc ^ octet) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dateDos(date: Date) {
  const annee = Math.min(2107, Math.max(1980, date.getFullYear()))
  const heure = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const jour = ((annee - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { heure, jour }
}

/**
 * Produit une archive ZIP sans recompression. Les PDF étant déjà compressés,
 * ce format est à la fois rapide et économe en CPU tout en restant compatible
 * avec macOS, Windows et les navigateurs.
 */
export function creerZip(fichiers: FichierZip[]): Buffer {
  const locaux: Buffer[] = []
  const centraux: Buffer[] = []
  let decalage = 0

  for (const fichier of fichiers) {
    const nom = Buffer.from(fichier.nom, 'utf8')
    const contenu = Buffer.from(
      fichier.contenu instanceof Uint8Array ? fichier.contenu : new Uint8Array(fichier.contenu),
    )
    const crc = crc32(contenu)
    const { heure, jour } = dateDos(fichier.date ?? new Date())

    const enteteLocal = Buffer.alloc(30)
    enteteLocal.writeUInt32LE(0x04034b50, 0)
    enteteLocal.writeUInt16LE(20, 4)
    enteteLocal.writeUInt16LE(0x0800, 6)
    enteteLocal.writeUInt16LE(0, 8)
    enteteLocal.writeUInt16LE(heure, 10)
    enteteLocal.writeUInt16LE(jour, 12)
    enteteLocal.writeUInt32LE(crc, 14)
    enteteLocal.writeUInt32LE(contenu.length, 18)
    enteteLocal.writeUInt32LE(contenu.length, 22)
    enteteLocal.writeUInt16LE(nom.length, 26)
    enteteLocal.writeUInt16LE(0, 28)
    locaux.push(enteteLocal, nom, contenu)

    const enteteCentral = Buffer.alloc(46)
    enteteCentral.writeUInt32LE(0x02014b50, 0)
    enteteCentral.writeUInt16LE(20, 4)
    enteteCentral.writeUInt16LE(20, 6)
    enteteCentral.writeUInt16LE(0x0800, 8)
    enteteCentral.writeUInt16LE(0, 10)
    enteteCentral.writeUInt16LE(heure, 12)
    enteteCentral.writeUInt16LE(jour, 14)
    enteteCentral.writeUInt32LE(crc, 16)
    enteteCentral.writeUInt32LE(contenu.length, 20)
    enteteCentral.writeUInt32LE(contenu.length, 24)
    enteteCentral.writeUInt16LE(nom.length, 28)
    enteteCentral.writeUInt16LE(0, 30)
    enteteCentral.writeUInt16LE(0, 32)
    enteteCentral.writeUInt16LE(0, 34)
    enteteCentral.writeUInt16LE(0, 36)
    enteteCentral.writeUInt32LE(0, 38)
    enteteCentral.writeUInt32LE(decalage, 42)
    centraux.push(enteteCentral, nom)

    decalage += enteteLocal.length + nom.length + contenu.length
  }

  const tailleCentrale = centraux.reduce((total, bloc) => total + bloc.length, 0)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(0, 4)
  fin.writeUInt16LE(0, 6)
  fin.writeUInt16LE(fichiers.length, 8)
  fin.writeUInt16LE(fichiers.length, 10)
  fin.writeUInt32LE(tailleCentrale, 12)
  fin.writeUInt32LE(decalage, 16)
  fin.writeUInt16LE(0, 20)

  return Buffer.concat([...locaux, ...centraux, fin])
}
