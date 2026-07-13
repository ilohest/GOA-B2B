<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { z } from 'zod'
import { toast } from 'vue-sonner'
import { EyeIcon, EyeOffIcon } from '@lucide/vue'
import { useAuth } from '@/composables/useAuth'
import BrandLogo from '@/components/BrandLogo.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const schema = z.object({
  email: z.email('Adresse email invalide'),
  password: z.string().min(6, 'Mot de passe : 6 caractères minimum'),
})

const route = useRoute()
const router = useRouter()
const { login, resetPassword, firebaseConfigured } = useAuth()

const form = reactive({ email: '', password: '' })
const fieldErrors = reactive<{ email?: string; password?: string }>({})
const submitting = ref(false)
const resetting = ref(false)
const motDePasseVisible = ref(false)
const erreurConnexion = ref('')

const redirectTo = computed(() => {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') ? r : '/'
})

// Message discret quand la session a expiré (redirection auto depuis l'app).
onMounted(() => {
  if (route.query.expired != null) {
    toast.info('Votre session a expiré — reconnectez-vous.')
  }
})

function messageFirebase(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email ou mot de passe incorrect.'
    case 'auth/too-many-requests':
      return 'Trop de tentatives — réessayez dans quelques minutes.'
    case 'auth/network-request-failed':
      return 'Connexion impossible. Vérifiez votre réseau (ou que les émulateurs tournent, en dev).'
    default:
      return 'Connexion impossible. Réessayez.'
  }
}

async function onSubmit() {
  fieldErrors.email = undefined
  fieldErrors.password = undefined
  erreurConnexion.value = ''
  const parsed = schema.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as 'email' | 'password'
      fieldErrors[field] ??= issue.message
    }
    return
  }
  submitting.value = true
  try {
    await login(parsed.data.email, parsed.data.password)
    router.push(redirectTo.value)
  } catch (e) {
    erreurConnexion.value = messageFirebase((e as { code?: string }).code ?? '')
  } finally {
    submitting.value = false
  }
}

async function onResetPassword() {
  const email = z.email().safeParse(form.email)
  erreurConnexion.value = ''
  if (!email.success) {
    fieldErrors.email = 'Saisissez votre email pour recevoir le lien de réinitialisation.'
    return
  }
  resetting.value = true
  try {
    await resetPassword(email.data)
    toast.success(`Email de réinitialisation envoyé à ${email.data}.`)
  } catch {
    // Ne pas révéler si l'email existe ou non.
    toast.success(`Si un compte existe pour ${email.data}, un email a été envoyé.`)
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center p-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="text-center">
        <BrandLogo variante="complet" class="mb-2" />
        <CardTitle class="text-xl">Espace professionnel</CardTitle>
        <CardDescription>Connectez-vous pour passer commande</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="!firebaseConfigured" class="text-sm text-destructive">
          Firebase Auth n'est pas configuré (voir <code>web/.env.local</code>).
        </p>
        <form v-else class="grid gap-4" novalidate @submit.prevent="onSubmit">
          <div class="grid gap-1.5">
            <Label for="email">Email</Label>
            <Input
              id="email"
              v-model="form.email"
              type="email"
              autocomplete="email"
              inputmode="email"
              placeholder="vous@exemple.fr"
              :aria-invalid="Boolean(fieldErrors.email)"
              @input="erreurConnexion = ''"
            />
            <p v-if="fieldErrors.email" class="text-sm text-destructive">{{ fieldErrors.email }}</p>
          </div>
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
                @input="erreurConnexion = ''"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                :aria-label="motDePasseVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'"
                :aria-pressed="motDePasseVisible"
                @click="motDePasseVisible = !motDePasseVisible"
              >
                <EyeOffIcon v-if="motDePasseVisible" class="size-4" />
                <EyeIcon v-else class="size-4" />
              </button>
            </div>
            <p v-if="fieldErrors.password" class="text-sm text-destructive">{{ fieldErrors.password }}</p>
          </div>
          <div
            v-if="erreurConnexion"
            class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            <p class="font-medium">{{ erreurConnexion }}</p>
            <p class="mt-1 text-xs text-destructive/80">
              Vérifiez votre saisie ou utilisez “Mot de passe oublié ?”.
            </p>
          </div>
          <Button type="submit" class="w-full" :disabled="submitting">
            {{ submitting ? 'Connexion…' : 'Se connecter' }}
          </Button>
          <Button
            type="button"
            variant="link"
            class="h-auto justify-self-center p-0 text-sm text-muted-foreground"
            :disabled="resetting"
            @click="onResetPassword"
          >
            Mot de passe oublié ?
          </Button>
        </form>
      </CardContent>
    </Card>
  </main>
</template>
