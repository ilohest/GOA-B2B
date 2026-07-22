import { describe, expect, it } from 'vitest'
import { config, erreursConfigurationProduction } from '../src/config.js'

function configurationProductionValide(): typeof config {
  return {
    ...config,
    production: true,
    webOrigin: 'https://commande.goa-kombucha.fr',
    authDisabled: false,
    syncIntervalMinutes: 0,
    schedulerSecret: 's'.repeat(32),
    firebase: {
      ...config.firebase,
      projectId: 'goa-production',
      storageBucket: 'goa-production.firebasestorage.app',
      emulators: false,
    },
    cloudTasks: {
      ...config.cloudTasks,
      projectId: 'goa-production',
      serviceUrl: 'https://goa-b2b-api.example.run.app',
      secret: 't'.repeat(32),
    },
    smtp: { ...config.smtp, host: 'ssl0.ovh.net', user: 'contact@goa-kombucha.fr', pass: 'secret' },
  }
}

describe('garde-fous de production', () => {
  it('accepte une configuration Cloud Run complète et sécurisée', () => {
    expect(erreursConfigurationProduction(configurationProductionValide())).toEqual([])
  })

  it('refuse les émulateurs, HTTP et les traitements mémoire en production', () => {
    const valide = configurationProductionValide()
    const erreurs = erreursConfigurationProduction({
      ...valide,
      webOrigin: 'http://82.112.255.95',
      authDisabled: true,
      syncIntervalMinutes: 15,
      firebase: { ...valide.firebase, emulators: true },
    })
    expect(erreurs).toEqual(expect.arrayContaining([
      'FIREBASE_EMULATORS doit être false',
      'AUTH_DISABLED doit être false',
      'WEB_ORIGIN doit utiliser HTTPS',
      'SYNC_INTERVAL_MINUTES doit être 0 sur Cloud Run',
    ]))
  })

  it('refuse des secrets trop courts ou une file incomplète', () => {
    const valide = configurationProductionValide()
    const erreurs = erreursConfigurationProduction({
      ...valide,
      schedulerSecret: 'court',
      cloudTasks: { ...valide.cloudTasks, serviceUrl: undefined, secret: 'court' },
    })
    expect(erreurs).toEqual(expect.arrayContaining([
      'SCHEDULER_SECRET doit contenir au moins 32 caractères',
      'Cloud Tasks requiert CLOUD_TASKS_PROJECT_ID, CLOUD_RUN_SERVICE_URL et TASKS_SECRET',
    ]))
  })
})
