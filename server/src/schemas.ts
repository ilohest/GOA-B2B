/**
 * Schémas Zod des corps de requêtes entrants (validation aux frontières de
 * l'API). Les règles MÉTIER (visibilité, rupture, prix, minimum, multiples
 * La Poste) restent dans resoudreLignes — ici on ne valide que la forme.
 */
import { z } from 'zod'

z.config(z.locales.fr())

export const LigneCommandeSchema = z.object({
  idStockBouteille: z.number().int().positive(),
  quantite: z.number().int().positive().max(999),
})

export const CommandeBodySchema = z.object({
  commentaire: z.string().max(1000).optional(),
  lignes: z.array(LigneCommandeSchema).min(1, 'Aucune ligne de commande').max(50),
})

export const InvitationBodySchema = z.object({
  easybeerIdClient: z.number().int().positive(),
  email: z.email('Adresse email invalide').optional(),
})

export const OverridePatchSchema = z
  .object({
    visible: z.boolean().optional(),
    rupture: z.boolean().optional(),
    displayName: z.string().max(120).optional(),
    photoUrl: z
      .string()
      .max(500)
      .refine((url) => {
        const u = url.trim()
        // Chemin d'asset local (/produits/…) ou https — pas de http ni de schéma exotique.
        return u === '' || u.startsWith('/') || u.startsWith('https://')
      }, 'URL de photo invalide : chemin local (/…) ou https:// uniquement')
      .optional(),
  })
  .strict()

/** Parse un body JSON ; renvoie la donnée ou un message d'erreur lisible. */
export function parserBody<T>(schema: z.ZodType<T>, body: unknown): { data: T } | { erreur: string } {
  const res = schema.safeParse(body)
  if (res.success) return { data: res.data }
  const premier = res.error.issues[0]
  const chemin = premier.path.length ? ` (${premier.path.join('.')})` : ''
  return { erreur: `${premier.message}${chemin}` }
}
