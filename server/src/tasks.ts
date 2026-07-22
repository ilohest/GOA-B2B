import { CloudTasksClient, protos } from '@google-cloud/tasks'
import { timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

let client: CloudTasksClient | null = null

export function cloudTasksConfigure(): boolean {
  return Boolean(
    config.cloudTasks.projectId &&
      config.cloudTasks.location &&
      config.cloudTasks.queue &&
      config.cloudTasks.serviceUrl &&
      config.cloudTasks.secret,
  )
}

function getClient(): CloudTasksClient {
  client ??= new CloudTasksClient()
  return client
}

export async function planifierSynchronisationEasybeer(
  origine: 'admin' | 'scheduler',
): Promise<{ nom: string | null }> {
  if (!cloudTasksConfigure()) throw new Error('Cloud Tasks non configuré')
  const tasks = getClient()
  const projectId = config.cloudTasks.projectId!
  const location = config.cloudTasks.location
  const parent = tasks.queuePath(projectId, location, config.cloudTasks.queue)
  const payload = Buffer.from(JSON.stringify({ origine, requestedAt: Date.now() })).toString('base64')
  const task: protos.google.cloud.tasks.v2.ITask = {
    // Une synchro complète peut prendre plusieurs minutes à cause du
    // throttling Easybeer. Cloud Tasks autorise au maximum 30 minutes.
    dispatchDeadline: { seconds: 1800 },
    httpRequest: {
      httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
      url: `${config.cloudTasks.serviceUrl}/api/tasks/sync`,
      headers: {
        'Content-Type': 'application/json',
        'X-Goa-Task-Secret': config.cloudTasks.secret!,
      },
      body: payload,
    },
  }
  const [created] = await tasks.createTask({ parent, task })
  console.log(`[tasks] synchronisation Easybeer planifiée (${origine}) : ${created.name ?? 'sans nom'}`)
  return { nom: created.name ?? null }
}

export function requeteCloudTasksAutorisee(secret: string | undefined): boolean {
  if (!config.cloudTasks.secret || !secret) return false
  // Comparaison à longueur constante sans faire planter une requête malformée.
  const attendu = Buffer.from(config.cloudTasks.secret)
  const recu = Buffer.from(secret)
  if (attendu.length !== recu.length) return false
  return timingSafeEqual(attendu, recu)
}
