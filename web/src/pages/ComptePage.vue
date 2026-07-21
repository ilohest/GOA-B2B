<script setup lang="ts">
import { computed, ref } from 'vue'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { EyeIcon, EyeOffIcon, UserRound } from '@lucide/vue'
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
const motDePasseActuelVisible = ref(false)
const nouveauMotDePasseVisible = ref(false)
const confirmationMotDePasseVisible = ref(false)
const messageMotDePasse = ref<{ type: 'erreur' | 'succes'; texte: string } | null>(null)
const erreursMotDePasse = ref<{
  actuel?: string
  nouveau?: string
  confirmation?: string
}>({})

function messageErreurMotDePasse(code?: string) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Mot de passe actuel incorrect.'
    case 'auth/weak-password':
      return 'Le nouveau mot de passe est trop faible.'
    case 'auth/requires-recent-login':
      return 'Reconnectez-vous puis réessayez de modifier votre mot de passe.'
    case 'auth/network-request-failed':
      return 'Connexion impossible. Vérifiez votre réseau puis réessayez.'
    default:
      return 'Impossible de mettre à jour le mot de passe. Réessayez.'
  }
}

async function changerMotDePasse() {
  changementEnCours.value = true
  messageMotDePasse.value = null
  erreursMotDePasse.value = {}

  const user = firebaseAuth?.currentUser
  if (!user?.email) {
    messageMotDePasse.value = {
      type: 'erreur',
      texte: 'Session introuvable. Reconnectez-vous puis réessayez.',
    }
    changementEnCours.value = false
    return
  }
  if (!motDePasseActuel.value) {
    erreursMotDePasse.value.actuel = 'Saisissez votre mot de passe actuel.'
  }
  if (nouveauMotDePasse.value.length < 8) {
    erreursMotDePasse.value.nouveau = '8 caractères minimum.'
  }
  if (nouveauMotDePasse.value !== confirmationMotDePasse.value) {
    erreursMotDePasse.value.confirmation = 'La confirmation ne correspond pas.'
  }
  if (Object.keys(erreursMotDePasse.value).length) {
    messageMotDePasse.value = {
      type: 'erreur',
      texte: 'Vérifiez les champs indiqués.',
    }
    changementEnCours.value = false
    return
  }

  try {
    const credential = EmailAuthProvider.credential(user.email, motDePasseActuel.value)
    await reauthenticateWithCredential(user, credential)
    await updatePassword(user, nouveauMotDePasse.value)
    motDePasseActuel.value = ''
    nouveauMotDePasse.value = ''
    confirmationMotDePasse.value = ''
    messageMotDePasse.value = { type: 'succes', texte: 'Mot de passe mis à jour.' }
    toast.success('Mot de passe mis à jour', {
      description: 'Votre nouveau mot de passe est actif.',
      duration: 5000,
    })
  } catch (e) {
    const code = (e as { code?: string }).code
    const texte = messageErreurMotDePasse(code)
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
      erreursMotDePasse.value.actuel = 'Mot de passe actuel incorrect.'
    }
    messageMotDePasse.value = { type: 'erreur', texte }
    toast.error(texte)
  } finally {
    changementEnCours.value = false
  }
}

function effacerRetourMotDePasse(champ: keyof typeof erreursMotDePasse.value) {
  const { [champ]: _retire, ...reste } = erreursMotDePasse.value
  erreursMotDePasse.value = reste
  if (messageMotDePasse.value?.type === 'succes') messageMotDePasse.value = null
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
      <div
        v-if="isPending"
        class="grid gap-3"
        aria-label="Chargement du compte"
        aria-busy="true"
      >
        <div
          v-for="i in 7"
          :key="i"
          class="grid gap-1.5 sm:grid-cols-[14rem_1fr] sm:items-center"
        >
          <Skeleton class="h-3.5" :class="i % 2 ? 'w-28' : 'w-36'" />
          <Skeleton class="h-4" :class="i % 3 ? 'w-48 max-w-full' : 'w-3/4'" />
        </div>
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
            <div class="relative">
              <Input
                id="mot-de-passe-actuel"
                v-model="motDePasseActuel"
                :type="motDePasseActuelVisible ? 'text' : 'password'"
                autocomplete="current-password"
                class="pr-10"
                :aria-invalid="Boolean(erreursMotDePasse.actuel)"
                @input="effacerRetourMotDePasse('actuel')"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                :aria-label="motDePasseActuelVisible ? 'Masquer le mot de passe actuel' : 'Afficher le mot de passe actuel'"
                :aria-pressed="motDePasseActuelVisible"
                @click="motDePasseActuelVisible = !motDePasseActuelVisible"
              >
                <EyeOffIcon v-if="motDePasseActuelVisible" class="size-4" />
                <EyeIcon v-else class="size-4" />
              </button>
            </div>
            <p v-if="erreursMotDePasse.actuel" class="text-sm text-destructive">{{ erreursMotDePasse.actuel }}</p>
          </div>
          <div class="grid gap-1.5">
            <Label for="nouveau-mot-de-passe">Nouveau mot de passe</Label>
            <div class="relative">
              <Input
                id="nouveau-mot-de-passe"
                v-model="nouveauMotDePasse"
                :type="nouveauMotDePasseVisible ? 'text' : 'password'"
                autocomplete="new-password"
                class="pr-10"
                :aria-invalid="Boolean(erreursMotDePasse.nouveau)"
                @input="effacerRetourMotDePasse('nouveau')"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                :aria-label="nouveauMotDePasseVisible ? 'Masquer le nouveau mot de passe' : 'Afficher le nouveau mot de passe'"
                :aria-pressed="nouveauMotDePasseVisible"
                @click="nouveauMotDePasseVisible = !nouveauMotDePasseVisible"
              >
                <EyeOffIcon v-if="nouveauMotDePasseVisible" class="size-4" />
                <EyeIcon v-else class="size-4" />
              </button>
            </div>
            <p v-if="erreursMotDePasse.nouveau" class="text-sm text-destructive">{{ erreursMotDePasse.nouveau }}</p>
          </div>
          <div class="grid gap-1.5">
            <Label for="confirmation-mot-de-passe">Confirmer le nouveau mot de passe</Label>
            <div class="relative">
              <Input
                id="confirmation-mot-de-passe"
                v-model="confirmationMotDePasse"
                :type="confirmationMotDePasseVisible ? 'text' : 'password'"
                autocomplete="new-password"
                class="pr-10"
                :aria-invalid="Boolean(erreursMotDePasse.confirmation)"
                @input="effacerRetourMotDePasse('confirmation')"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                :aria-label="confirmationMotDePasseVisible ? 'Masquer la confirmation' : 'Afficher la confirmation'"
                :aria-pressed="confirmationMotDePasseVisible"
                @click="confirmationMotDePasseVisible = !confirmationMotDePasseVisible"
              >
                <EyeOffIcon v-if="confirmationMotDePasseVisible" class="size-4" />
                <EyeIcon v-else class="size-4" />
              </button>
            </div>
            <p v-if="erreursMotDePasse.confirmation" class="text-sm text-destructive">
              {{ erreursMotDePasse.confirmation }}
            </p>
          </div>
          <p
            v-if="messageMotDePasse"
            class="rounded-lg border px-3 py-2 text-sm"
            :class="
              messageMotDePasse.type === 'succes'
                ? 'border-primary/20 bg-primary/5 text-primary'
                : 'border-destructive/20 bg-destructive/5 text-destructive'
            "
            role="status"
          >
            {{ messageMotDePasse.texte }}
          </p>
          <Button type="submit" class="justify-self-start" :disabled="changementEnCours">
            {{ changementEnCours ? 'Mise à jour…' : 'Mettre à jour le mot de passe' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
