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
  schedulerSecret: process.env.SCHEDULER_SECRET || undefined,

  // true (défaut, dev) => les commandes partent en DEVIS Easybeer (réversible).
  // Passer à false en prod pour créer de vraies commandes.
  commandeEstDevis: process.env.COMMANDE_EST_DEVIS !== 'false',

  cache: {
    // Pensé pour une synchro nocturne (ex. 04:00) : on laisse une marge d'une
    // journée complète, puis on bloque l'envoi plutôt que d'utiliser un prix
    // potentiellement obsolète.
    prixMaxAgeMinutes: Number(process.env.PRIX_CACHE_MAX_AGE_MINUTES ?? 2160),
    // Cache admin des commandes globales : fenêtre volontairement courte pour
    // limiter le volume utile lu/affiché pendant les tests Easybeer.
    adminCommandesJours: Number(process.env.ADMIN_COMMANDES_CACHE_DAYS ?? 30),
  },

  // En dev, tant que Firebase n'est pas configuré, on court-circuite l'auth.
  authDisabled: process.env.AUTH_DISABLED === 'true',
  devEasybeerIdClient: Number(process.env.DEV_EASYBEER_ID_CLIENT ?? 588074),

  // Serveur SMTP (OVH en prod). Sans SMTP_HOST, l'envoi est désactivé et on
  // retombe sur le lien d'invitation copiable manuellement.
  smtp: {
    host: process.env.SMTP_HOST || undefined,
    port: Number(process.env.SMTP_PORT ?? 587),
    // 587 = STARTTLS (secure:false) ; 465 = TLS implicite (secure:true).
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT ?? 587) === 465,
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.SMTP_FROM || 'GOA Kombucha <contact@goa-kombucha.fr>',
    replyTo: process.env.SMTP_REPLY_TO || undefined,
  },

  invite: {
    baseUrl: process.env.INVITE_BASE_URL ?? 'http://localhost:5173/activer',
    // Durée de validité du lien d'invitation (jours), usage unique.
    expiresInDays: Number(process.env.INVITE_EXPIRES_DAYS ?? 14),
    // URL absolue du logo GOA (PNG) pour l'email ; vide → wordmark texte.
    logoUrl: process.env.INVITE_LOGO_URL || undefined,
  },
}
