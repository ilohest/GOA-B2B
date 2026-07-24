<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { z } from "zod";
import { toast } from "vue-sonner";
import { EyeIcon, EyeOffIcon, MailIcon, Pencil } from "@lucide/vue";
import { useAuth } from "@/composables/useAuth";
import { api } from "@/lib/api";
import type { MeResponse } from "@/lib/types";
import BrandLogo from "@/components/BrandLogo.vue";
import AuthBrandPanel from "@/components/auth/AuthBrandPanel.vue";
import "@/components/auth/auth-premium.css";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  email: z.email("Adresse email invalide"),
  password: z.string().min(6, "Mot de passe : 6 caractères minimum"),
});
const emailSchema = z.email("Saisissez une adresse email valide.");
const EMAIL_STORAGE_KEY = "goa-email-pour-connexion";

const route = useRoute();
const router = useRouter();
const {
  login,
  loginWithGoogle,
  isLoginLink,
  loginWithEmailLink,
  logout,
  firebaseConfigured,
} = useAuth();

const form = reactive({ email: "", password: "" });
const fieldErrors = reactive<{ email?: string; password?: string }>({});
const submitting = ref(false);
const googleLoading = ref(false);
const sendingLink = ref(false);
const completingLink = ref(false);
const motDePasseVisible = ref(false);
const erreurConnexion = ref("");
const compteRevoque = ref(false);
const lienEnvoyeA = ref("");
const lienEmailEnAttente = ref(false);
const emailValide = ref(false);

const redirectTo = computed(() => {
  const r = route.query.redirect;
  return typeof r === "string" && r.startsWith("/") && !r.startsWith("//")
    ? r
    : "/";
});

const descriptionConnexion = computed(() => {
  if (lienEnvoyeA.value) return "Connexion sans mot de passe";
  if (lienEmailEnAttente.value) return "Confirmez votre adresse e-mail";
  return emailValide.value
    ? "Choisissez votre méthode de connexion"
    : "Saisissez votre e-mail pour continuer";
});

onMounted(async () => {
  if (route.query.expired != null)
    toast.info("Votre session a expiré — reconnectez-vous.");
  if (!firebaseConfigured || !isLoginLink()) return;

  const emailMemorise = window.localStorage.getItem(EMAIL_STORAGE_KEY) ?? "";
  if (!emailMemorise) {
    lienEmailEnAttente.value = true;
    return;
  }
  form.email = emailMemorise;
  await terminerConnexionParLien();
});

function messageFirebase(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email ou mot de passe incorrect.";
    case "auth/user-disabled":
      return "Votre compte a été révoqué. Vous ne pouvez plus accéder à la plateforme.";
    case "auth/popup-closed-by-user":
      return "La fenêtre Google a été fermée avant la connexion.";
    case "auth/popup-blocked":
      return "La fenêtre Google a été bloquée par votre navigateur. Autorisez les fenêtres pop-up puis réessayez.";
    case "auth/account-exists-with-different-credential":
      return "Cette adresse utilise déjà une autre méthode. Essayez le lien reçu par email ou votre mot de passe.";
    case "auth/operation-not-allowed":
      return "Cette méthode de connexion doit encore être activée par GOA.";
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return "Ce lien de connexion a expiré ou a déjà été utilisé. Demandez-en un nouveau.";
    case "goa/account-not-invited":
      return "Cette adresse n'est pas encore rattachée à un compte client GOA. Contactez-nous pour recevoir une invitation.";
    case "auth/too-many-requests":
      return "Trop de tentatives — réessayez dans quelques minutes.";
    case "auth/network-request-failed":
      return "Connexion impossible. Vérifiez votre accès à Internet puis réessayez.";
    default:
      return "Connexion impossible. Réessayez.";
  }
}

function codeErreur(e: unknown): string {
  return (e as { code?: string }).code ?? "";
}

function afficherErreur(e: unknown) {
  const code = codeErreur(e);
  compteRevoque.value = code === "auth/user-disabled";
  erreurConnexion.value = messageFirebase(code);
}

function effacerErreurConnexion() {
  erreurConnexion.value = "";
  compteRevoque.value = false;
  fieldErrors.email = undefined;
}

function effacerErreurMotDePasse() {
  erreurConnexion.value = "";
  compteRevoque.value = false;
  fieldErrors.password = undefined;
}

function validerEmail() {
  fieldErrors.email = undefined;
  erreurConnexion.value = "";
  const email = emailSchema.safeParse(form.email.trim().toLowerCase());
  if (!email.success) {
    fieldErrors.email = email.error.issues[0]?.message;
    return;
  }
  form.email = email.data;
  emailValide.value = true;
}

function modifierEmail() {
  emailValide.value = false;
  form.password = "";
  motDePasseVisible.value = false;
  fieldErrors.email = undefined;
  fieldErrors.password = undefined;
  erreurConnexion.value = "";
  compteRevoque.value = false;
}

function focusMotDePasse() {
  if (emailValide.value) document.getElementById("password")?.focus();
}

async function verifierCompteAutorise() {
  const profil = await api.get<MeResponse>("/me");
  if (profil.user.role === "client" && profil.user.easybeerIdClient == null) {
    await logout();
    const erreur = new Error("Compte non invité") as Error & { code: string };
    erreur.code = "goa/account-not-invited";
    throw erreur;
  }
}

async function redirigerApresConnexion() {
  await verifierCompteAutorise();
  await router.push(redirectTo.value);
}

async function onGoogle() {
  erreurConnexion.value = "";
  googleLoading.value = true;
  try {
    await loginWithGoogle();
    await redirigerApresConnexion();
  } catch (e) {
    afficherErreur(e);
  } finally {
    googleLoading.value = false;
  }
}

async function onSendLoginLink() {
  fieldErrors.email = undefined;
  fieldErrors.password = undefined;
  erreurConnexion.value = "";
  const email = emailSchema.safeParse(form.email.trim().toLowerCase());
  if (!email.success) {
    fieldErrors.email = email.error.issues[0]?.message;
    return;
  }
  sendingLink.value = true;
  try {
    // Le backend renvoie une réponse générique (aucune énumération) : on affiche
    // toujours l'écran « consultez votre email », que le compte existe ou non.
    await api.post("/auth/login-link", {
      email: email.data,
      redirect: redirectTo.value,
    });
    window.localStorage.setItem(EMAIL_STORAGE_KEY, email.data);
    lienEnvoyeA.value = email.data;
    toast.success("Lien de connexion envoyé.");
  } catch (e) {
    afficherErreur(e);
  } finally {
    sendingLink.value = false;
  }
}

async function terminerConnexionParLien() {
  fieldErrors.email = undefined;
  erreurConnexion.value = "";
  const email = emailSchema.safeParse(form.email.trim().toLowerCase());
  if (!email.success) {
    fieldErrors.email =
      "Confirmez l’adresse email à laquelle le lien a été envoyé.";
    return;
  }
  completingLink.value = true;
  try {
    await loginWithEmailLink(email.data);
    window.localStorage.removeItem(EMAIL_STORAGE_KEY);
    await redirigerApresConnexion();
  } catch (e) {
    afficherErreur(e);
  } finally {
    completingLink.value = false;
  }
}

async function onSubmit() {
  fieldErrors.email = undefined;
  fieldErrors.password = undefined;
  erreurConnexion.value = "";
  compteRevoque.value = false;
  const parsed = schema.safeParse(form);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as "email" | "password";
      fieldErrors[field] ??= issue.message;
    }
    return;
  }
  submitting.value = true;
  try {
    await login(parsed.data.email, parsed.data.password);
    await router.push(redirectTo.value);
  } catch (e) {
    afficherErreur(e);
  } finally {
    submitting.value = false;
  }
}

</script>

<template>
  <main class="auth-page flex min-h-dvh items-center justify-center p-4 lg:p-8">
    <div
      class="auth-shell mx-auto grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-emerald-950/10 bg-[#fcfaf5] shadow-[0_30px_90px_rgba(25,45,36,0.14)] lg:grid-cols-[minmax(24rem,0.84fr)_minmax(0,1.16fr)]"
    >
      <section class="auth-form-panel relative flex min-h-[38rem] items-center justify-center bg-[#fcfaf5] px-4 py-8 sm:px-6 lg:min-h-[46rem] lg:px-10 lg:py-10">
        <div class="auth-form-card w-full max-w-md">
      <CardHeader class="text-center">
        <div class="auth-logo mx-auto mb-2 w-fit">
          <BrandLogo variante="complet" />
        </div>
        <CardTitle class="text-xl">Espace professionnel</CardTitle>
        <CardDescription :class="emailValide ? 'mb-3 lg:mb-4' : ''">
          {{ descriptionConnexion }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="!firebaseConfigured" class="text-sm text-destructive">
          Firebase Auth n'est pas configuré (voir <code>web/.env.local</code>).
        </p>

        <div v-else class="grid gap-4">
          <!-- Une fois le lien envoyé, les autres méthodes disparaissent. -->
          <div
            v-if="lienEnvoyeA"
            class="rounded-lg border border-primary/20 bg-brand-50 p-4 text-center"
          >
            <MailIcon class="mx-auto mb-2 size-5 text-primary" />
            <p class="text-sm font-medium">Consultez votre boîte email</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Cliquez sur le lien envoyé à {{ lienEnvoyeA }}. Aucun mot de passe
              nécessaire.
            </p>
            <Button
              variant="link"
              class="mt-2 h-auto p-0 text-xs"
              @click="lienEnvoyeA = ''"
              >Renvoyer un lien</Button
            >
          </div>

          <!-- Si le lien est ouvert ailleurs, l'adresse doit être confirmée. -->
          <form
            v-else-if="lienEmailEnAttente"
            class="grid gap-3"
            novalidate
            @submit.prevent="terminerConnexionParLien"
          >
            <div class="grid gap-1.5">
              <Label for="email">Votre adresse email</Label>
              <Input
                id="email"
                v-model="form.email"
                type="email"
                autocomplete="email"
                inputmode="email"
                placeholder="vous@exemple.fr"
                class="auth-input"
                :aria-invalid="Boolean(fieldErrors.email)"
                autofocus
                @input="effacerErreurConnexion"
              />
              <p v-if="fieldErrors.email" class="text-sm text-destructive">
                {{ fieldErrors.email }}
              </p>
            </div>
            <p class="text-xs text-muted-foreground">
              Pour votre sécurité, confirmez l’adresse qui a reçu ce lien.
            </p>
            <Button
              type="submit"
              class="premium-primary h-11 w-full"
              :disabled="completingLink"
            >
              <MailIcon />
              {{ completingLink ? "Connexion…" : "Finaliser ma connexion" }}
            </Button>
          </form>

          <Transition
            v-else
            name="auth-step"
            mode="out-in"
            @after-enter="focusMotDePasse"
          >
            <!-- Étape 1 : l'utilisateur s'identifie uniquement avec son e-mail. -->
            <div v-if="!emailValide" key="email" class="grid gap-4 pt-4">
            <Button
              type="button"
              class="h-11 w-full border border-emerald-950/10 bg-white/70 text-foreground shadow-sm backdrop-blur-sm hover:bg-white"
              :disabled="googleLoading"
              @click="onGoogle"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5">
                <path
                  fill="#4285F4"
                  d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z"
                />
                <path
                  fill="#34A853"
                  d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.05v2.62A10 10 0 0 0 12 22Z"
                />
                <path
                  fill="#FBBC05"
                  d="M6.39 13.86A6.02 6.02 0 0 1 6.07 12c0-.65.11-1.28.32-1.86V7.52H3.05A10 10 0 0 0 2 12c0 1.61.39 3.14 1.05 4.48l3.34-2.62Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 6.01c1.47 0 2.79.51 3.82 1.5l2.88-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.95 5.52l3.34 2.62C7.18 7.77 9.39 6.01 12 6.01Z"
                />
              </svg>
              {{
                googleLoading
                  ? "Connexion avec Google…"
                  : "Continuer avec Google"
              }}
            </Button>

            <div class="relative flex items-center" aria-hidden="true">
              <span class="h-px flex-1 bg-emerald-950/10" />
              <span class="px-3 text-[0.7rem] tracking-wide text-muted-foreground/80">ou</span>
              <span class="h-px flex-1 bg-emerald-950/10" />
            </div>

            <form class="grid gap-3" novalidate @submit.prevent="validerEmail">
              <div class="grid gap-1.5">
                <Label for="email">Votre adresse email</Label>
                <Input
                  id="email"
                  v-model="form.email"
                  type="email"
                  autocomplete="email"
                  inputmode="email"
                  placeholder="vous@exemple.fr"
                  class="auth-input"
                  :aria-invalid="Boolean(fieldErrors.email)"
                  autofocus
                  @input="effacerErreurConnexion"
                />
                <p v-if="fieldErrors.email" class="text-sm text-destructive">
                  {{ fieldErrors.email }}
                </p>
              </div>
              <Button type="submit" class="premium-primary h-11 w-full">Continuer</Button>
            </form>

            <p class="text-center text-xs text-muted-foreground">
              Vous choisirez ensuite entre votre mot de passe ou un lien par
              e-mail.
            </p>
            </div>

            <!-- Étape 2 : choix de la méthode pour l'adresse validée. -->
            <div v-else key="methodes" class="grid gap-4">
            <div
              class="flex items-center justify-between gap-3 rounded-xl border border-emerald-950/10 bg-white/55 px-3 py-2.5 shadow-inner shadow-black/[0.02]"
            >
              <span class="min-w-0 truncate text-sm font-medium">
                {{ form.email }}
              </span>
              <button
                type="button"
                class="grid size-7 shrink-0 place-items-center rounded-full text-emerald-800 transition-colors hover:bg-emerald-950/5 hover:text-emerald-950"
                aria-label="Modifier l’adresse email"
                @click="modifierEmail"
              >
                <Pencil class="size-3.5" aria-hidden="true" />
              </button>
            </div>

            <form class="grid gap-3" novalidate @submit.prevent="onSubmit">
              <div class="grid gap-1.5">
                <Label for="password">Mot de passe</Label>
                <div class="relative">
                  <Input
                    id="password"
                    v-model="form.password"
                    :type="motDePasseVisible ? 'text' : 'password'"
                    autocomplete="current-password"
                    class="auth-input pr-10"
                    :aria-invalid="Boolean(fieldErrors.password)"
                    @input="effacerErreurMotDePasse"
                  />
                  <button
                    type="button"
                    class="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                    :aria-label="
                      motDePasseVisible
                        ? 'Masquer le mot de passe'
                        : 'Afficher le mot de passe'
                    "
                    :aria-pressed="motDePasseVisible"
                    @click="motDePasseVisible = !motDePasseVisible"
                  >
                    <EyeOffIcon v-if="motDePasseVisible" class="size-4" />
                    <EyeIcon v-else class="size-4" />
                  </button>
                </div>
                <p
                  v-if="fieldErrors.password"
                  class="text-sm text-destructive"
                >
                  {{ fieldErrors.password }}
                </p>
              </div>
              <Button
                type="submit"
                class="premium-primary h-11 w-full"
                :disabled="submitting"
              >
                {{ submitting ? "Connexion…" : "Se connecter" }}
              </Button>
            </form>

            <div class="relative flex items-center" aria-hidden="true">
              <span class="h-px flex-1 bg-emerald-950/10" />
              <span class="px-3 text-[0.7rem] tracking-wide text-muted-foreground/80">ou</span>
              <span class="h-px flex-1 bg-emerald-950/10" />
            </div>

            <Button
              type="button"
              variant="outline"
              class="auth-secondary h-11 w-full"
              :disabled="sendingLink"
              @click="onSendLoginLink"
            >
              <MailIcon />
              {{ sendingLink ? "Envoi…" : "Recevoir un lien de connexion" }}
            </Button>
            </div>
          </Transition>

          <div
            v-if="erreurConnexion"
            class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            <p class="font-medium">{{ erreurConnexion }}</p>
            <p v-if="compteRevoque" class="mt-1 text-xs text-destructive/80">
              Contactez la Brasserie de GOA pour demander la réactivation de
              votre accès.
            </p>
          </div>
        </div>
      </CardContent>
        </div>
      </section>

      <AuthBrandPanel />
    </div>
  </main>
</template>

<style scoped>
.auth-step-enter-active,
.auth-step-leave-active {
  transition:
    opacity 180ms ease,
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform;
}

.auth-step-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.auth-step-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .auth-step-enter-active,
  .auth-step-leave-active {
    transition: none;
  }
}
</style>
