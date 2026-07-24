<script setup lang="ts">
import { computed, ref } from 'vue'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import {
  BadgePercent,
  CalendarDays,
  EyeIcon,
  EyeOffIcon,
  ShoppingCart,
  UserRound,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useMe } from '@/composables/useMe'
import { firebaseAuth } from '@/firebase'
import {
  etatAvantage,
  formatRemiseCommerciale,
  remisesProduitVisibles,
} from '@/lib/conditionsCommerciales'
import { dateFr, prixFr } from '@/lib/format'
import type { RemiseCibleeClient } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
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

const client = computed(() => data.value?.client)
const remiseCommande = computed(() => formatRemiseCommerciale(client.value?.remise))
const remisesProduit = computed(() => remisesProduitVisibles(client.value))
const aDesConditionsCommerciales = computed(
  () =>
    client.value?.minimumCommande != null ||
    remiseCommande.value != null ||
    remisesProduit.value.length > 0,
)

function statutAvantage(remise: RemiseCibleeClient) {
  switch (etatAvantage(remise)) {
    case 'a-venir':
      return { libelle: 'À venir', classes: 'border-blue-200 bg-blue-50 text-blue-700' }
    case 'expire-bientot':
      return {
        libelle: 'Expire bientôt',
        classes: 'border-amber-200 bg-amber-50 text-amber-800',
      }
    default:
      return {
        libelle: 'Active',
        classes: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      }
  }
}

function dateRemise(date: string | null | undefined) {
  if (!date) return null
  const valeur = new Date(date).getTime()
  return Number.isNaN(valeur) ? null : dateFr(valeur)
}

function periodeRemise(remise: RemiseCibleeClient) {
  const debut = dateRemise(remise.dateDebut)
  const fin = dateRemise(remise.dateFin)
  if (debut && fin) return `Du ${debut} au ${fin}`
  if (debut) return `À partir du ${debut}`
  if (fin) return `Jusqu’au ${fin}`
  return null
}

function conditionQuantite(quantite: number | null | undefined) {
  if (quantite == null || quantite <= 0) return null
  return `À partir de ${quantite} ${quantite === 1 ? 'carton' : 'cartons'}`
}

function libellePortee(scope: string | null | undefined) {
  return scope === 'segment' ? 'Catégorie professionnelle' : 'Condition individuelle'
}

function valeurPortee(scope: string | null | undefined, libelle: string | null | undefined) {
  return scope === 'segment' ? libelle || 'Votre catégorie' : 'Votre établissement'
}

function classesCarteRemise(scope: string | null | undefined) {
  return scope === 'segment'
    ? 'border-sky-200/80 bg-sky-50/45'
    : 'border-emerald-200/80 bg-emerald-50/45'
}

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

    <Card id="conditions-commerciales" class="scroll-mt-24">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-lg">
          <BadgePercent class="size-5 text-primary" />
          Vos conditions commerciales
        </CardTitle>
        <p class="text-sm text-muted-foreground">
          Les conditions rattachées à votre établissement sont appliquées automatiquement dans la
          boutique et lors de la validation de vos commandes.
        </p>
      </CardHeader>
      <CardContent>
        <div
          v-if="isPending"
          class="grid gap-3 sm:grid-cols-3"
          aria-label="Chargement des conditions commerciales"
          aria-busy="true"
        >
          <Skeleton v-for="i in 3" :key="i" class="h-24 rounded-xl" />
        </div>

        <p v-else-if="isError" class="text-sm text-destructive">
          Impossible de charger vos conditions commerciales.
        </p>

        <div v-else-if="aDesConditionsCommerciales" class="grid gap-6">
          <div v-if="client?.minimumCommande != null" class="rounded-xl border bg-muted/20 p-4">
            <ShoppingCart class="size-4 text-primary" />
            <p class="mt-3 text-xs font-medium text-muted-foreground">Minimum de commande</p>
            <p class="mt-1 text-xl font-semibold tabular-nums">
              {{ prixFr(client.minimumCommande) }}
              <span class="text-sm font-medium text-muted-foreground">HT</span>
            </p>
          </div>

          <section v-if="remiseCommande" class="grid gap-2.5">
            <div>
              <h3 class="font-semibold">Remise sur la commande</h3>
              <p class="mt-0.5 text-sm text-muted-foreground">
                Appliquée à l’ensemble de la commande, sauf lorsqu’un produit bénéficie de sa propre
                remise.
              </p>
            </div>
            <article
              class="rounded-xl border p-4"
              :class="classesCarteRemise(client?.remiseScope)"
            >
              <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div class="min-w-0">
                  <p
                    class="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                  >
                    {{ libellePortee(client?.remiseScope) }}
                  </p>
                  <p class="mt-1 font-medium">
                    {{
                      valeurPortee(
                        client?.remiseScope,
                        client?.remiseScopeLibelle || client?.type?.libelle,
                      )
                    }}
                  </p>
                </div>
                <Badge class="text-sm tabular-nums">{{ remiseCommande }}</Badge>
              </div>
            </article>
          </section>

          <section v-if="remisesProduit.length" class="grid gap-2.5">
            <div>
              <h3 class="font-semibold">Remises sur les produits</h3>
              <p class="mt-0.5 text-sm text-muted-foreground">
                Limitées aux produits, formats et quantités indiqués.
              </p>
            </div>
            <div class="grid gap-3 lg:grid-cols-2">
              <article
                v-for="(remise, index) in remisesProduit"
                :key="`${remise.scope ?? 'client'}-${remise.idStockBouteille ?? remise.idProduit ?? index}`"
                class="rounded-xl border p-4"
                :class="classesCarteRemise(remise.scope)"
              >
                <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div class="min-w-0">
                    <p
                      class="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                    >
                      {{ libellePortee(remise.scope) }}
                    </p>
                    <p class="mt-1 font-medium">
                      {{ valeurPortee(remise.scope, remise.scopeLibelle) }}
                    </p>
                  </div>
                  <Badge class="text-sm tabular-nums">
                    {{ formatRemiseCommerciale(remise.remise) }}
                  </Badge>
                </div>

                <h4 class="mt-3 font-semibold leading-snug">
                  {{ remise.produit || 'Produit ou format ciblé' }}
                </h4>

                <div v-if="remise.contenant || remise.packaging" class="mt-3 flex flex-wrap gap-1.5">
                  <Badge v-if="remise.contenant" variant="outline">{{ remise.contenant }}</Badge>
                  <Badge v-if="remise.packaging" variant="outline">{{ remise.packaging }}</Badge>
                </div>

                <div
                  v-if="
                    etatAvantage(remise) !== 'actif' || conditionQuantite(remise.quantite)
                  "
                  class="mt-4 flex flex-wrap items-center gap-2 border-t pt-3"
                >
                  <Badge
                    v-if="etatAvantage(remise) !== 'actif'"
                    variant="outline"
                    :class="statutAvantage(remise).classes"
                  >
                    {{ statutAvantage(remise).libelle }}
                  </Badge>
                  <span v-if="conditionQuantite(remise.quantite)" class="text-sm font-medium">
                    {{ conditionQuantite(remise.quantite) }}
                  </span>
                </div>

                <p
                  v-if="periodeRemise(remise)"
                  class="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                >
                  <CalendarDays class="size-4 shrink-0 text-primary" />
                  <span>{{ periodeRemise(remise) }}</span>
                </p>
              </article>
            </div>
          </section>
        </div>

        <div v-else class="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          Aucune condition commerciale particulière n’est actuellement rattachée à votre compte.
        </div>
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
