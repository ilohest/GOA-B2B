<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { z } from 'zod'
import { toast } from 'vue-sonner'
import { EyeIcon, EyeOffIcon } from '@lucide/vue'
import { api } from '@/lib/api'
import type { InvitationValidation } from '@/lib/types'
import { useAuth } from '@/composables/useAuth'
import BrandLogo from '@/components/BrandLogo.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

const schema = z
  .object({
    password: z.string().min(6, 'Mot de passe : 6 caractères minimum'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Les deux mots de passe ne correspondent pas',
  })

const route = useRoute()
const router = useRouter()
const { login } = useAuth()

const token = typeof route.query.token === 'string' ? route.query.token : ''
const state = ref<'checking' | 'ready' | 'invalid'>('checking')
const invalidMessage = ref('Ce lien d’invitation est invalide.')
const email = ref('')
const form = reactive({ password: '', confirm: '' })
const fieldErrors = reactive<{ password?: string; confirm?: string }>({})
const submitting = ref(false)
const motDePasseVisible = ref(false)
const confirmationVisible = ref(false)

const MESSAGES: Record<InvitationValidation['etat'], string> = {
  valide: '',
  introuvable: 'Ce lien d’invitation est invalide. Demandez-nous un nouveau lien.',
  expire: 'Ce lien d’invitation a expiré. Demandez-nous un nouveau lien.',
  utilise:
    'Ce lien a déjà été utilisé — votre compte est actif. Connectez-vous, ou utilisez « Mot de passe oublié ».',
  revoque: 'Ce lien a été remplacé par un plus récent. Utilisez le dernier email reçu de GOA.',
}

onMounted(async () => {
  if (!token) {
    state.value = 'invalid'
    return
  }
  try {
    const res = await api.get<InvitationValidation>(`/invitations/${token}`)
    if (res.etat === 'valide') {
      email.value = res.email ?? ''
      state.value = 'ready'
    } else {
      invalidMessage.value = MESSAGES[res.etat]
      state.value = 'invalid'
    }
  } catch {
    state.value = 'invalid'
  }
})

async function onSubmit() {
  fieldErrors.password = undefined
  fieldErrors.confirm = undefined
  const parsed = schema.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as 'password' | 'confirm'
      fieldErrors[field] ??= issue.message
    }
    return
  }
  submitting.value = true
  try {
    const res = await api.post<{ ok: boolean; email: string }>(`/invitations/${token}/consume`, {
      password: parsed.data.password,
    })
    // Connexion directe dans la foulée : zéro étape superflue pour le client.
    await login(res.email || email.value, parsed.data.password)
    toast.success('Votre compte est prêt !')
    router.push('/')
  } catch (e) {
    toast.error((e as Error).message || 'Impossible d’activer le compte. Demandez un nouveau lien.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center p-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="text-center">
        <BrandLogo variante="complet" class="mb-2" />
        <CardTitle class="text-xl">Créez votre mot de passe</CardTitle>
        <CardDescription v-if="state === 'ready'">
          Compte : <span class="font-medium text-foreground">{{ email }}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="state === 'checking'" class="grid gap-3">
          <Skeleton class="h-9 w-full" />
          <Skeleton class="h-9 w-full" />
        </div>

        <div v-else-if="state === 'invalid'" class="grid gap-4 text-center">
          <p class="text-sm text-muted-foreground">{{ invalidMessage }}</p>
          <Button variant="outline" as-child>
            <RouterLink to="/login">Aller à la connexion</RouterLink>
          </Button>
        </div>

        <form v-else class="grid gap-4" novalidate @submit.prevent="onSubmit">
          <div class="grid gap-1.5">
            <Label for="password">Nouveau mot de passe</Label>
            <div class="relative">
              <Input
                id="password"
                v-model="form.password"
                :type="motDePasseVisible ? 'text' : 'password'"
                autocomplete="new-password"
                class="pr-10"
                :aria-invalid="Boolean(fieldErrors.password)"
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
          <div class="grid gap-1.5">
            <Label for="confirm">Confirmez le mot de passe</Label>
            <div class="relative">
              <Input
                id="confirm"
                v-model="form.confirm"
                :type="confirmationVisible ? 'text' : 'password'"
                autocomplete="new-password"
                class="pr-10"
                :aria-invalid="Boolean(fieldErrors.confirm)"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                :aria-label="confirmationVisible ? 'Masquer la confirmation' : 'Afficher la confirmation'"
                :aria-pressed="confirmationVisible"
                @click="confirmationVisible = !confirmationVisible"
              >
                <EyeOffIcon v-if="confirmationVisible" class="size-4" />
                <EyeIcon v-else class="size-4" />
              </button>
            </div>
            <p v-if="fieldErrors.confirm" class="text-sm text-destructive">{{ fieldErrors.confirm }}</p>
          </div>
          <Button type="submit" class="w-full" :disabled="submitting">
            {{ submitting ? 'Enregistrement…' : 'Activer mon compte' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </main>
</template>
