import { OAuth2Client } from 'google-auth-library'
import { config } from './config.js'

const client = new OAuth2Client()

/**
 * Vérifie le jeton OIDC émis par Google pour le compte de service dédié au
 * Scheduler. L'audience est volontairement l'URL racine Cloud Run, identique à
 * celle configurée sur le job par le script de déploiement.
 */
export async function requeteSchedulerAutorisee(authorization: string | undefined): Promise<boolean> {
  const serviceAccount = config.schedulerServiceAccountEmail
  const audience = config.cloudTasks.serviceUrl
  if (!serviceAccount || !audience || !authorization?.startsWith('Bearer ')) return false

  const idToken = authorization.slice('Bearer '.length).trim()
  if (!idToken) return false

  try {
    const ticket = await client.verifyIdToken({ idToken, audience })
    const payload = ticket.getPayload()
    return payload?.email_verified === true && payload.email === serviceAccount
  } catch {
    return false
  }
}
