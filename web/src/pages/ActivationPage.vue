<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { z } from 'zod'
import { toast } from 'vue-sonner'
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { firebaseAuth } from '@/firebase'
import { useAuth } from '@/composables/useAuth'
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

const oobCode = typeof route.query.oobCode === 'string' ? route.query.oobCode : ''
const state = ref<'checking' | 'ready' | 'invalid'>('checking')
const email = ref('')
const form = reactive({ password: '', confirm: '' })
const fieldErrors = reactive<{ password?: string; confirm?: string }>({})
const submitting = ref(false)

onMounted(async () => {
  if (!firebaseAuth || !oobCode) {
    state.value = 'invalid'
    return
  }
  try {
    email.value = await verifyPasswordResetCode(firebaseAuth, oobCode)
    state.value = 'ready'
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
    await confirmPasswordReset(firebaseAuth!, oobCode, parsed.data.password)
    // Connexion directe dans la foulée : zéro étape superflue pour le client.
    await login(email.value, parsed.data.password)
    toast.success('Votre compte est prêt !')
    router.push('/')
  } catch {
    toast.error("Impossible d'enregistrer le mot de passe. Réessayez ou demandez un nouveau lien.")
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center p-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="text-center">
        <p class="text-sm font-semibold tracking-widest text-primary uppercase">GOA Kombucha</p>
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
          <p class="text-sm text-muted-foreground">
            Ce lien d'invitation est invalide ou a expiré. Demandez un nouveau lien à GOA, ou
            utilisez « Mot de passe oublié » si vous avez déjà activé votre compte.
          </p>
          <Button variant="outline" as-child>
            <RouterLink to="/login">Aller à la connexion</RouterLink>
          </Button>
        </div>

        <form v-else class="grid gap-4" novalidate @submit.prevent="onSubmit">
          <div class="grid gap-1.5">
            <Label for="password">Nouveau mot de passe</Label>
            <Input
              id="password"
              v-model="form.password"
              type="password"
              autocomplete="new-password"
              :aria-invalid="Boolean(fieldErrors.password)"
            />
            <p v-if="fieldErrors.password" class="text-sm text-destructive">{{ fieldErrors.password }}</p>
          </div>
          <div class="grid gap-1.5">
            <Label for="confirm">Confirmez le mot de passe</Label>
            <Input
              id="confirm"
              v-model="form.confirm"
              type="password"
              autocomplete="new-password"
              :aria-invalid="Boolean(fieldErrors.confirm)"
            />
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
