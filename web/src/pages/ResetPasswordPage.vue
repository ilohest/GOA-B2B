<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { z } from "zod";
import { CheckCircle2, EyeIcon, EyeOffIcon, KeyRound } from "@lucide/vue";
import { firebaseAuth } from "@/firebase";
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
import { Skeleton } from "@/components/ui/skeleton";

const schema = z
  .object({
    password: z.string().min(8, "Utilisez au moins 8 caractères."),
    confirmation: z.string(),
  })
  .refine((valeurs) => valeurs.password === valeurs.confirmation, {
    path: ["confirmation"],
    message: "Les deux mots de passe ne correspondent pas.",
  });

const route = useRoute();
const actionCode =
  typeof route.query.oobCode === "string" ? route.query.oobCode : "";
const etat = ref<"verification" | "pret" | "invalide" | "succes">(
  "verification",
);
const email = ref("");
const messageInvalide = ref(
  "Ce lien de réinitialisation est invalide ou a déjà été utilisé.",
);
const form = reactive({ password: "", confirmation: "" });
const erreurs = reactive<{ password?: string; confirmation?: string }>({});
const erreurEnvoi = ref("");
const envoiEnCours = ref(false);
const motDePasseVisible = ref(false);
const confirmationVisible = ref(false);

onMounted(async () => {
  if (!actionCode || !firebaseAuth) {
    etat.value = "invalide";
    return;
  }
  try {
    email.value = await verifyPasswordResetCode(firebaseAuth, actionCode);
    etat.value = "pret";
  } catch (e) {
    const code = (e as { code?: string }).code;
    messageInvalide.value =
      code === "auth/expired-action-code"
        ? "Ce lien de réinitialisation a expiré. Demandez-en un nouveau depuis la page de connexion."
        : "Ce lien de réinitialisation est invalide ou a déjà été utilisé.";
    etat.value = "invalide";
  }
});

function effacerErreur(champ: keyof typeof erreurs) {
  erreurs[champ] = undefined;
  erreurEnvoi.value = "";
}

async function enregistrer() {
  erreurs.password = undefined;
  erreurs.confirmation = undefined;
  erreurEnvoi.value = "";
  const resultat = schema.safeParse(form);
  if (!resultat.success) {
    for (const issue of resultat.error.issues) {
      const champ = issue.path[0] as keyof typeof erreurs;
      erreurs[champ] ??= issue.message;
    }
    return;
  }
  if (!firebaseAuth) {
    erreurEnvoi.value = "Le service de connexion est indisponible.";
    return;
  }

  envoiEnCours.value = true;
  try {
    await confirmPasswordReset(
      firebaseAuth,
      actionCode,
      resultat.data.password,
    );
    etat.value = "succes";
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "auth/weak-password") {
      erreurs.password = "Choisissez un mot de passe plus robuste.";
    } else if (
      code === "auth/expired-action-code" ||
      code === "auth/invalid-action-code"
    ) {
      messageInvalide.value =
        "Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau depuis la page de connexion.";
      etat.value = "invalide";
    } else {
      erreurEnvoi.value =
        "Impossible de modifier le mot de passe. Vérifiez votre connexion puis réessayez.";
    }
  } finally {
    envoiEnCours.value = false;
  }
}
</script>

<template>
  <main class="auth-page flex min-h-dvh items-center justify-center p-4 lg:p-8">
    <div
      class="auth-shell mx-auto grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-emerald-950/10 bg-[#fcfaf5] shadow-[0_30px_90px_rgba(25,45,36,0.14)] lg:grid-cols-[minmax(24rem,0.84fr)_minmax(0,1.16fr)]"
    >
      <section
        class="auth-form-panel relative flex min-h-[38rem] items-center justify-center bg-[#fcfaf5] px-4 py-8 sm:px-6 lg:min-h-[46rem] lg:px-10 lg:py-10"
      >
        <div class="auth-form-card w-full max-w-md">
          <CardHeader class="text-center">
            <div class="auth-logo mx-auto mb-2 w-fit">
              <BrandLogo variante="complet" />
            </div>
            <CardTitle class="text-xl">
              {{
                etat === "succes"
                  ? "Mot de passe modifié"
                  : "Nouveau mot de passe"
              }}
            </CardTitle>
            <CardDescription>
              {{
                etat === "succes"
                  ? "Vous pouvez maintenant vous connecter à votre espace professionnel."
                  : "Choisissez un mot de passe sécurisé pour votre compte."
              }}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div
              v-if="etat === 'verification'"
              class="grid gap-4 pt-4"
              aria-label="Vérification du lien"
              aria-busy="true"
            >
              <div v-for="i in 2" :key="i" class="grid gap-1.5">
                <Skeleton class="h-3.5 w-36" />
                <Skeleton class="h-11 w-full rounded-xl" />
              </div>
              <Skeleton class="h-11 w-full rounded-md" />
            </div>

            <div
              v-else-if="etat === 'invalide'"
              class="grid justify-items-center gap-4 pt-4 text-center"
            >
              <span
                class="grid size-12 place-items-center rounded-full bg-amber-100 text-amber-700"
              >
                <KeyRound class="size-5" />
              </span>
              <p class="text-sm leading-relaxed text-muted-foreground">
                {{ messageInvalide }}
              </p>
              <Button variant="outline" class="auth-secondary w-full" as-child>
                <RouterLink to="/login">Retour à la connexion</RouterLink>
              </Button>
            </div>

            <div
              v-else-if="etat === 'succes'"
              class="grid justify-items-center gap-4 pt-4 text-center"
            >
              <span
                class="grid size-12 place-items-center rounded-full bg-emerald-100 text-emerald-700"
              >
                <CheckCircle2 class="size-6" />
              </span>
              <p class="text-sm text-muted-foreground">
                Votre nouveau mot de passe est actif.
              </p>
              <Button class="premium-primary w-full" as-child>
                <RouterLink to="/login">Se connecter</RouterLink>
              </Button>
            </div>

            <form
              v-else
              class="grid gap-4 pt-4"
              novalidate
              @submit.prevent="enregistrer"
            >
              <div
                class="rounded-xl border border-emerald-950/10 bg-white/55 px-3 py-2.5 text-sm"
              >
                <p class="text-xs text-muted-foreground">Compte concerné</p>
                <p class="mt-0.5 truncate font-medium">{{ email }}</p>
              </div>

              <div class="grid gap-1.5">
                <Label for="nouveau-mot-de-passe">Nouveau mot de passe</Label>
                <div class="relative">
                  <Input
                    id="nouveau-mot-de-passe"
                    v-model="form.password"
                    :type="motDePasseVisible ? 'text' : 'password'"
                    autocomplete="new-password"
                    class="auth-input pr-10"
                    :aria-invalid="Boolean(erreurs.password)"
                    autofocus
                    @input="effacerErreur('password')"
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
                <p v-if="erreurs.password" class="text-sm text-destructive">
                  {{ erreurs.password }}
                </p>
                <p v-else class="text-xs text-muted-foreground">
                  8 caractères minimum.
                </p>
              </div>

              <div class="grid gap-1.5">
                <Label for="confirmation-mot-de-passe"
                  >Confirmez le mot de passe</Label
                >
                <div class="relative">
                  <Input
                    id="confirmation-mot-de-passe"
                    v-model="form.confirmation"
                    :type="confirmationVisible ? 'text' : 'password'"
                    autocomplete="new-password"
                    class="auth-input pr-10"
                    :aria-invalid="Boolean(erreurs.confirmation)"
                    @input="effacerErreur('confirmation')"
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
                <p
                  v-if="erreurs.confirmation"
                  class="text-sm text-destructive"
                >
                  {{ erreurs.confirmation }}
                </p>
              </div>

              <p
                v-if="erreurEnvoi"
                class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {{ erreurEnvoi }}
              </p>

              <Button
                type="submit"
                class="premium-primary h-11 w-full"
                :disabled="envoiEnCours"
              >
                {{
                  envoiEnCours
                    ? "Enregistrement…"
                    : "Enregistrer le nouveau mot de passe"
                }}
              </Button>
            </form>
          </CardContent>
        </div>
      </section>
      <AuthBrandPanel />
    </div>
  </main>
</template>
