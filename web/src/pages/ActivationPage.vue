<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { z } from "zod";
import { toast } from "vue-sonner";
import { EyeIcon, EyeOffIcon } from "@lucide/vue";
import { api } from "@/lib/api";
import type { InvitationValidation } from "@/lib/types";
import { useAuth } from "@/composables/useAuth";
import BrandLogo from "@/components/BrandLogo.vue";
import AuthBrandPanel from "@/components/auth/AuthBrandPanel.vue";
import "@/components/auth/auth-premium.css";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const schema = z
  .object({
    email: z.email("Adresse email invalide"),
    password: z.string().min(6, "Mot de passe : 6 caractères minimum"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Les deux mots de passe ne correspondent pas",
  });

const route = useRoute();
const router = useRouter();
const { login, loginWithGoogle, logout } = useAuth();

const token = typeof route.query.token === "string" ? route.query.token : "";
const state = ref<"checking" | "ready" | "invalid">("checking");
const invalidMessage = ref("Ce lien d’invitation est invalide.");
const form = reactive({ email: "", password: "", confirm: "" });
const fieldErrors = reactive<{
  email?: string;
  password?: string;
  confirm?: string;
}>({});
const submitting = ref(false);
const googleLoading = ref(false);
const erreurGoogle = ref("");
const motDePasseVisible = ref(false);
const confirmationVisible = ref(false);

const MESSAGES: Record<InvitationValidation["etat"], string> = {
  valide: "",
  introuvable:
    "Ce lien d’invitation est invalide. Demandez-nous un nouveau lien.",
  expire: "Ce lien d’invitation a expiré. Demandez-nous un nouveau lien.",
  utilise:
    "Ce lien a déjà été utilisé — votre compte est actif. Connectez-vous, ou utilisez « Mot de passe oublié ».",
  revoque:
    "Ce lien a été remplacé par un plus récent. Utilisez le dernier email reçu de GOA.",
};

onMounted(async () => {
  if (!token) {
    state.value = "invalid";
    return;
  }
  try {
    const res = await api.get<InvitationValidation>(`/invitations/${token}`);
    if (res.etat === "valide") {
      state.value = "ready";
    } else {
      invalidMessage.value = MESSAGES[res.etat];
      state.value = "invalid";
    }
  } catch {
    state.value = "invalid";
  }
});

async function onSubmit() {
  fieldErrors.email = undefined;
  fieldErrors.password = undefined;
  fieldErrors.confirm = undefined;
  const parsed = schema.safeParse(form);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as "email" | "password" | "confirm";
      fieldErrors[field] ??= issue.message;
    }
    return;
  }
  submitting.value = true;
  try {
    const res = await api.post<{ ok: boolean; email: string }>(
      `/invitations/${token}/consume`,
      {
        email: parsed.data.email,
        password: parsed.data.password,
      },
    );
    // Connexion directe dans la foulée : zéro étape superflue pour le client.
    await login(res.email || parsed.data.email, parsed.data.password);
    toast.success("Votre compte est prêt !");
    router.push("/");
  } catch (e) {
    toast.error(
      (e as Error).message ||
        "Impossible d’activer le compte. Demandez un nouveau lien.",
    );
  } finally {
    submitting.value = false;
  }
}

async function onGoogle() {
  erreurGoogle.value = "";
  googleLoading.value = true;
  try {
    await loginWithGoogle();
    await api.post(`/invitations/${token}/consume-provider`);
    toast.success("Votre compte est prêt !");
    router.push("/");
  } catch (e) {
    await logout().catch(() => undefined);
    const code = (e as { code?: string }).code;
    if (code === "auth/popup-closed-by-user") {
      erreurGoogle.value = "La fenêtre Google a été fermée avant la connexion.";
    } else if (code === "auth/account-exists-with-different-credential") {
      erreurGoogle.value =
        "Cette adresse utilise déjà un mot de passe. Vous pouvez le saisir ci-dessous.";
    } else if (code === "auth/operation-not-allowed") {
      erreurGoogle.value =
        "La connexion Google doit encore être activée par GOA.";
    } else {
      erreurGoogle.value =
        (e as Error).message || "Connexion avec Google impossible. Réessayez.";
    }
  } finally {
    googleLoading.value = false;
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
        <CardTitle class="text-xl">Activez votre compte</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          v-if="state === 'checking'"
          class="grid gap-4"
          aria-label="Vérification de l'invitation"
          aria-busy="true"
        >
          <div v-for="i in 2" :key="i" class="grid gap-1.5">
            <Skeleton class="h-3.5 w-36" />
            <Skeleton class="h-9 w-full rounded-md" />
          </div>
          <Skeleton class="h-10 w-full rounded-md" />
        </div>

        <div v-else-if="state === 'invalid'" class="grid gap-4 text-center">
          <p class="text-sm text-muted-foreground">{{ invalidMessage }}</p>
          <Button variant="outline" class="auth-secondary" as-child>
            <RouterLink to="/login">Aller à la connexion</RouterLink>
          </Button>
        </div>

        <div v-else class="grid gap-4 pt-4">
          <Button
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
                ? "Activation avec Google…"
                : "Continuer avec Google"
            }}
          </Button>
          <div
            v-if="erreurGoogle"
            class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {{ erreurGoogle }}
          </div>

          <div class="relative flex items-center" aria-hidden="true">
            <span class="h-px flex-1 bg-emerald-950/10" />
            <span class="px-3 text-[0.7rem] tracking-wide text-muted-foreground/80">ou</span>
            <span class="h-px flex-1 bg-emerald-950/10" />
          </div>

          <form class="grid gap-4" novalidate @submit.prevent="onSubmit">
            <div class="grid gap-1.5">
              <Label for="email">Adresse email</Label>
              <Input
                id="email"
                v-model="form.email"
                type="email"
                autocomplete="email"
                class="auth-input"
                :aria-invalid="Boolean(fieldErrors.email)"
              />
              <p v-if="fieldErrors.email" class="text-sm text-destructive">
                {{ fieldErrors.email }}
              </p>
            </div>
            <div class="grid gap-1.5">
              <Label for="password">Nouveau mot de passe</Label>
              <div class="relative">
                <Input
                  id="password"
                  v-model="form.password"
                  :type="motDePasseVisible ? 'text' : 'password'"
                  autocomplete="new-password"
                  class="auth-input pr-10"
                  :aria-invalid="Boolean(fieldErrors.password)"
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
            <div class="grid gap-1.5">
              <Label for="confirm">Confirmez le mot de passe</Label>
              <div class="relative">
                <Input
                  id="confirm"
                  v-model="form.confirm"
                  :type="confirmationVisible ? 'text' : 'password'"
                  autocomplete="new-password"
                  class="auth-input pr-10"
                  :aria-invalid="Boolean(fieldErrors.confirm)"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                  :aria-label="
                    confirmationVisible
                      ? 'Masquer la confirmation'
                      : 'Afficher la confirmation'
                  "
                  :aria-pressed="confirmationVisible"
                  @click="confirmationVisible = !confirmationVisible"
                >
                  <EyeOffIcon v-if="confirmationVisible" class="size-4" />
                  <EyeIcon v-else class="size-4" />
                </button>
              </div>
              <p v-if="fieldErrors.confirm" class="text-sm text-destructive">
                {{ fieldErrors.confirm }}
              </p>
            </div>
            <Button
              type="submit"
              class="premium-primary h-11 w-full"
              :disabled="submitting"
            >
              {{ submitting ? "Enregistrement…" : "Activer mon compte" }}
            </Button>
          </form>
        </div>
      </CardContent>
    </div>
      </section>
      <AuthBrandPanel />
    </div>
  </main>
</template>
