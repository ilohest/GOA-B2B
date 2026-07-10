import 'dotenv/config'

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 8788),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',

  easybeer: {
    target: process.env.EASYBEER_API_TARGET ?? 'https://api.easybeer.fr',
    // Interface web Easybeer (liens « ouvrir dans Easybeer » côté admin).
    appUrl: process.env.EASYBEER_APP_URL ?? 'https://app.easybeer.fr',
    username: required('EASYBEER_USERNAME', process.env.EASYBEER_USERNAME),
    password: required('EASYBEER_PASSWORD', process.env.EASYBEER_PASSWORD),
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || undefined,
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined,
    // Dev : émulateurs locaux (Auth + Firestore) au lieu d'un vrai projet.
    emulators: process.env.FIREBASE_EMULATORS === 'true',
    emulatorAuthHost: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099',
    emulatorFirestoreHost: process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080',
    emulatorStorageHost: process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? 'localhost:9199',
  },

  // Synchro périodique Easybeer → cache (0 = désactivée ; en prod, Cloud Scheduler).
  syncIntervalMinutes: Number(process.env.SYNC_INTERVAL_MINUTES ?? 0),

  // true (défaut, dev) => les commandes partent en DEVIS Easybeer (réversible).
  // Passer à false en prod pour créer de vraies commandes.
  commandeEstDevis: process.env.COMMANDE_EST_DEVIS !== 'false',

  cache: {
    // Au-delà, on affiche encore le catalogue mais on bloque l'envoi d'une
    // commande : Easybeer reste la source de vérité des prix.
    prixMaxAgeMinutes: Number(process.env.PRIX_CACHE_MAX_AGE_MINUTES ?? 60),
  },

  // En dev, tant que Firebase n'est pas configuré, on court-circuite l'auth.
  authDisabled: process.env.AUTH_DISABLED === 'true',
  devEasybeerIdClient: Number(process.env.DEV_EASYBEER_ID_CLIENT ?? 588074),

  invite: {
    baseUrl: process.env.INVITE_BASE_URL ?? 'http://localhost:5173/activer',
    smtpUrl: process.env.SMTP_URL || undefined,
  },
}
