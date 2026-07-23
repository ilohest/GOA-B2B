<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { z } from "zod";
import { toast } from "vue-sonner";
import { ChevronDownIcon, EyeIcon, EyeOffIcon, MailIcon } from "@lucide/vue";
import { useAuth } from "@/composables/useAuth";
import { api } from "@/lib/api";
import type { MeResponse } from "@/lib/types";
import BrandLogo from "@/components/BrandLogo.vue";
import { Button } from "@/components/ui/button";
import {
  Card,
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
  sendLoginLink,
  isLoginLink,
  loginWithEmailLink,
  resetPassword,
  logout,
  firebaseConfigured,
} = useAuth();

const form = reactive({ email: "", password: "" });
const fieldErrors = reactive<{ email?: string; password?: string }>({});
const submitting = ref(false);
const googleLoading = ref(false);
const sendingLink = ref(false);
const completingLink = ref(false);
const resetting = ref(false);
const motDePasseVisible = ref(false);
const passwordOpen = ref(false);
const erreurConnexion = ref("");
const compteRevoque = ref(false);
const lienEnvoyeA = ref("");
const lienEmailEnAttente = ref(false);

const redirectTo = computed(() => {
  const r = route.query.redirect;
  return typeof r === "string" && r.startsWith("/") && !r.startsWith("//")
    ? r
    : "/";
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
  erreurConnexion.value = "";
  const email = emailSchema.safeParse(form.email.trim().toLowerCase());
  if (!email.success) {
    fieldErrors.email = email.error.issues[0]?.message;
    return;
  }
  sendingLink.value = true;
  try {
    await sendLoginLink(email.data, redirectTo.value);
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

async function onResetPassword() {
  const email = z.email().safeParse(form.email);
  erreurConnexion.value = "";
  if (!email.success) {
    fieldErrors.email =
      "Saisissez votre email pour recevoir le lien de réinitialisation.";
    passwordOpen.value = true;
    return;
  }
  resetting.value = true;
  try {
    await resetPassword(email.data);
    toast.success(`Email de réinitialisation envoyé à ${email.data}.`);
  } catch {
    toast.success(
      `Si un compte existe pour ${email.data}, un email a été envoyé.`,
    );
  } finally {
    resetting.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center p-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="text-center">
        <BrandLogo variante="complet" class="mb-2" />
        <CardTitle class="text-xl">Espace professionnel</CardTitle>
        <CardDescription>Commandez simplement</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="!firebaseConfigured" class="text-sm text-destructive">
          Firebase Auth n'est pas configuré (voir <code>web/.env.local</code>).
        </p>

        <div v-else class="grid gap-4">
          <Button
            class="h-11 w-full bg-white text-foreground shadow-sm ring-1 ring-border hover:bg-muted"
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
              googleLoading ? "Connexion avec Google…" : "Continuer avec Google"
            }}
          </Button>

          <div class="relative flex items-center" aria-hidden="true">
            <span class="h-px flex-1 bg-border" />
            <span class="px-3 text-xs text-muted-foreground">ou</span>
            <span class="h-px flex-1 bg-border" />
          </div>

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

          <form
            v-else
            class="grid gap-3"
            novalidate
            @submit.prevent="
              lienEmailEnAttente
                ? terminerConnexionParLien()
                : onSendLoginLink()
            "
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
                :aria-invalid="Boolean(fieldErrors.email)"
                autofocus
                @input="effacerErreurConnexion"
              />
              <p v-if="fieldErrors.email" class="text-sm text-destructive">
                {{ fieldErrors.email }}
              </p>
            </div>
            <p v-if="lienEmailEnAttente" class="text-xs text-muted-foreground">
              Pour votre sécurité, confirmez l’adresse qui a reçu ce lien.
            </p>
            <Button
              type="submit"
              variant="outline"
              class="h-10 w-full"
              :disabled="sendingLink || completingLink"
            >
              <MailIcon />
              {{
                completingLink
                  ? "Connexion…"
                  : lienEmailEnAttente
                    ? "Finaliser ma connexion"
                    : sendingLink
                      ? "Envoi…"
                      : "Recevoir un lien de connexion"
              }}
            </Button>
          </form>

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

          <div class="border-t pt-3">
            <button
              type="button"
              class="flex w-full items-center justify-between py-1 text-sm text-muted-foreground hover:text-foreground"
              :aria-expanded="passwordOpen"
              @click="passwordOpen = !passwordOpen"
            >
              Se connecter avec un mot de passe
              <ChevronDownIcon
                class="size-4 transition-transform"
                :class="passwordOpen && 'rotate-180'"
              />
            </button>

            <form
              v-if="passwordOpen"
              class="mt-3 grid gap-3"
              novalidate
              @submit.prevent="onSubmit"
            >
              <div class="grid gap-1.5">
                <Label for="password">Mot de passe</Label>
                <div class="relative">
                  <Input
                    id="password"
                    v-model="form.password"
                    :type="motDePasseVisible ? 'text' : 'password'"
                    autocomplete="current-password"
                    class="pr-10"
                    :aria-invalid="Boolean(fieldErrors.password)"
                    @input="effacerErreurConnexion"
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
                <p v-if="fieldErrors.password" class="text-sm text-destructive">
                  {{ fieldErrors.password }}
                </p>
              </div>
              <Button type="submit" class="w-full" :disabled="submitting">{{
                submitting ? "Connexion…" : "Se connecter"
              }}</Button>
              <Button
                v-if="!compteRevoque"
                type="button"
                variant="link"
                class="h-auto justify-self-center p-0 text-sm text-muted-foreground"
                :disabled="resetting"
                @click="onResetPassword"
                >Mot de passe oublié ?</Button
              >
            </form>
          </div>
        </div>
      </CardContent>
    </Card>
  </main>
</template>
