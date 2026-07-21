import 'dotenv/config'

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function nombreConfig(name: string, value: string | undefined, fallback: number, min = 0): number {
  const nombre = value == null || value === '' ? fallback : Number(value)
  if (!Number.isFinite(nombre) || nombre < min) {
    throw new Error(`Variable d'environnement invalide : ${name} doit être un nombre >= ${min}`)
  }
  return nombre
}

const prixMaxAgeMinutes = nombreConfig('PRIX_CACHE_MAX_AGE_MINUTES', process.env.PRIX_CACHE_MAX_AGE_MINUTES, 2160, 1)
const catalogueRefreshAgeMinutes = nombreConfig(
  'CATALOGUE_AUTO_REFRESH_MINUTES',
  process.env.CATALOGUE_AUTO_REFRESH_MINUTES,
  30,
  1,
)
const prixRefreshAgeMinutes = nombreConfig('PRIX_AUTO_REFRESH_MINUTES', process.env.PRIX_AUTO_REFRESH_MINUTES, 360, 1)
if (catalogueRefreshAgeMinutes >= prixMaxAgeMinutes || prixRefreshAgeMinutes >= prixMaxAgeMinutes) {
  throw new Error('Les seuils de refresh proactif doivent être inférieurs à PRIX_CACHE_MAX_AGE_MINUTES')
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
    timeoutMs: nombreConfig('EASYBEER_TIMEOUT_MS', process.env.EASYBEER_TIMEOUT_MS, 20_000, 1000),
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
    // Garde-fou dur, avec une marge nette après les refreshs proactifs. Au-delà,
    // on tente une réparation puis on bloque l'envoi plutôt que d'utiliser un
    // prix potentiellement obsolète.
    prixMaxAgeMinutes,
    // Rafraîchissement proactif : on renouvelle les données bien AVANT le
    // garde-fou dur de 36 h. Le catalogue/grille est peu coûteux et peut être
    // rafraîchi plusieurs fois par jour ; les prix personnalisés ne le sont que
    // pour le client qui consulte la boutique.
    catalogueRefreshAgeMinutes,
    prixRefreshAgeMinutes,
    // Après un échec/ban, une visite client ne doit pas relancer une rafale.
    autoRefreshCooldownMinutes: nombreConfig(
      'CACHE_AUTO_REFRESH_COOLDOWN_MINUTES',
      process.env.CACHE_AUTO_REFRESH_COOLDOWN_MINUTES,
      10,
      1,
    ),
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
