<script setup lang="ts">
import { computed, ref } from 'vue'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { UserRound } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useMe } from '@/composables/useMe'
import { firebaseAuth } from '@/firebase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

const { data, isPending, isError, error } = useMe()

const lignes = computed(() => {
  const client = data.value?.client
  if (!client) return []
  return [
    { label: 'Commerce', valeur: client.nom ?? client.raisonSociale },
    { label: 'N° client', valeur: client.numero },
    { label: 'Email du compte', valeur: data.value?.user.email },
  ]
})

const motDePasseActuel = ref('')
const nouveauMotDePasse = ref('')
const confirmationMotDePasse = ref('')
const changementEnCours = ref(false)

async function changerMotDePasse() {
  const user = firebaseAuth?.currentUser
  if (!user?.email) {
    toast.error('Session introuvable. Reconnectez-vous puis réessayez.')
    return
  }
  if (nouveauMotDePasse.value.length < 8) {
    toast.error('Le nouveau mot de passe doit contenir au moins 8 caractères.')
    return
  }
  if (nouveauMotDePasse.value !== confirmationMotDePasse.value) {
    toast.error('La confirmation ne correspond pas au nouveau mot de passe.')
    return
  }

  changementEnCours.value = true
  try {
    const credential = EmailAuthProvider.credential(user.email, motDePasseActuel.value)
    await reauthenticateWithCredential(user, credential)
    await updatePassword(user, nouveauMotDePasse.value)
    motDePasseActuel.value = ''
    nouveauMotDePasse.value = ''
    confirmationMotDePasse.value = ''
    toast.success('Mot de passe mis à jour.')
  } catch (e) {
    const code = (e as { code?: string }).code
    toast.error(code === 'auth/invalid-credential' ? 'Mot de passe actuel incorrect.' : (e as Error).message)
  } finally {
    changementEnCours.value = false
  }
}
</script>

<template>
  <div class="grid gap-4">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-lg">
          <UserRound class="size-5 text-muted-foreground" />
          Mon compte
        </CardTitle>
      </CardHeader>
      <CardContent>
      <div v-if="isPending" class="grid gap-2">
        <Skeleton class="h-5 w-2/3" />
        <Skeleton class="h-4 w-1/2" />
      </div>
      <p v-else-if="isError" class="text-sm text-destructive">
        Impossible de charger votre compte : {{ (error as Error)?.message }}
      </p>
      <dl v-else-if="lignes.length" class="grid gap-3 text-sm">
        <div v-for="l in lignes" :key="l.label" class="grid gap-0.5 sm:grid-cols-[14rem_1fr]">
          <dt class="text-muted-foreground">{{ l.label }}</dt>
          <dd class="font-medium">{{ l.valeur ?? '—' }}</dd>
        </div>
      </dl>
      <p v-else class="text-sm text-muted-foreground">
        Votre compte n'est pas encore relié à une fiche client — contactez GOA.
      </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Mot de passe</CardTitle>
      </CardHeader>
      <CardContent>
        <form class="grid max-w-md gap-4" @submit.prevent="changerMotDePasse">
          <div class="grid gap-1.5">
            <Label for="mot-de-passe-actuel">Mot de passe actuel</Label>
            <Input id="mot-de-passe-actuel" v-model="motDePasseActuel" type="password" autocomplete="current-password" />
          </div>
          <div class="grid gap-1.5">
            <Label for="nouveau-mot-de-passe">Nouveau mot de passe</Label>
            <Input id="nouveau-mot-de-passe" v-model="nouveauMotDePasse" type="password" autocomplete="new-password" />
          </div>
          <div class="grid gap-1.5">
            <Label for="confirmation-mot-de-passe">Confirmer le nouveau mot de passe</Label>
            <Input
              id="confirmation-mot-de-passe"
              v-model="confirmationMotDePasse"
              type="password"
              autocomplete="new-password"
            />
          </div>
          <Button class="justify-self-start" :disabled="changementEnCours">
            {{ changementEnCours ? 'Mise à jour…' : 'Mettre à jour le mot de passe' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
