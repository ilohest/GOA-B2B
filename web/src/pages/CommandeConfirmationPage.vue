<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Loader2, LockKeyhole, ShieldCheck, TriangleAlert } from '@lucide/vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CommandeResultat } from '@/lib/types'
import { prixFr } from '@/lib/format'
import { useCommandeCourante } from '@/composables/useCommandeCourante'
import PanierRecap from '@/components/catalogue/PanierRecap.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()
const modeApercu = computed(() => route.name === 'admin-boutique-confirmation')
const {
  data,
  catalogue,
  comptePreparation,
  lignes,
  lignesDetail,
  modification,
  commentaire,
  nbCartons,
  vider,
  totalHT,
  minimum,
  sousMinimum,
  remisesDetail,
  remiseMontant,
  commandeBloqueeParPrix,
  erreursConditionnementPostal,
  commandeBloqueeParConditionnement,
} = useCommandeCourante(modeApercu)

watchEffect(() => {
  if (data.value?.user.role === 'admin' && !modeApercu.value) router.replace('/admin')
  if (data.value?.user.role === 'client' && modeApercu.value) router.replace('/')
})

const retourBoutique = computed(() =>
  modeApercu.value ? { name: 'admin-boutique-apercu' } : { name: 'boutique' },
)
const erreurEnvoi = ref<{ titre: string; message: string; aide?: string } | null>(null)

function erreurCommandeLisible(message: string) {
  const normalise = message.toLowerCase()
  if (normalise.includes('grille tarifaire introuvable')) {
    return { titre: "Nous n'avons pas pu finaliser la commande", message: '' }
  }
  if (normalise.includes('compte est en cours de préparation')) {
    return {
      titre: 'Compte en préparation',
      message: 'Vos tarifs sont encore en cours de chargement.',
      aide: 'Réessayez dans une minute.',
    }
  }
  if (normalise.includes('minimum de commande')) {
    return { titre: 'Minimum de commande non atteint', message }
  }
  return {
    titre: 'Commande non envoyée',
    message,
    aide: 'Vérifiez votre panier ou contactez GOA si le problème persiste.',
  }
}

const envoi = useMutation({
  mutationFn: () => {
    if (modeApercu.value) {
      throw new Error('Aucune commande ne peut être envoyée depuis le mode aperçu.')
    }
    if (!lignes.value.length) throw new Error('Votre panier est vide.')
    if (lignesDetail.value.length !== lignes.value.length) {
      throw new Error(
        "Un produit du panier n'est plus disponible au catalogue. Retirez-le puis réessayez.",
      )
    }
    if (commandeBloqueeParPrix.value) {
      throw new Error('Un ou plusieurs tarifs doivent être vérifiés avant l’envoi.')
    }
    if (comptePreparation.value) throw new Error('Votre compte est en cours de préparation.')
    if (sousMinimum.value && minimum.value != null) {
      throw new Error(`Minimum de commande : ${prixFr(minimum.value)} HT.`)
    }
    if (commandeBloqueeParConditionnement.value) {
      throw new Error(erreursConditionnementPostal.value[0])
    }
    const body = { commentaire: commentaire.value, lignes: lignes.value }
    return modification.value
      ? api.put<CommandeResultat>(`/commandes/${modification.value.idCommande}`, body)
      : api.post<CommandeResultat>('/commandes', body)
  },
  onSuccess: (resultat) => {
    sessionStorage.setItem(
      'goa-commande-confirmation',
      JSON.stringify({
        numero: resultat.easybeer.numero ?? modification.value?.numero ?? null,
        totalHT: resultat.totalHT,
        totalTTC: resultat.totalTTC,
        remiseTotale: resultat.remiseTotale,
        totauxReels: resultat.totauxReels,
        modification: modification.value != null,
      }),
    )
    vider()
    queryClient.invalidateQueries({ queryKey: ['commandes'] })
    router.push('/commandes')
  },
  onError: (erreur) => {
    erreurEnvoi.value = erreurCommandeLisible((erreur as Error).message)
    toast.error(erreurEnvoi.value.titre, {
      description: erreurEnvoi.value.message,
      duration: 7000,
    })
  },
})

const validationBloquee = computed(
  () =>
    modeApercu.value ||
    commandeBloqueeParPrix.value ||
    commandeBloqueeParConditionnement.value ||
    comptePreparation.value ||
    sousMinimum.value ||
    nbCartons.value === 0,
)
</script>

<template>
  <div class="mx-auto grid w-full max-w-4xl gap-4 pb-8">
    <div class="flex items-center justify-between gap-3">
      <Button variant="ghost" class="-ml-3" @click="router.push(retourBoutique)">
        <ArrowLeft class="size-4" />
        Retour à la boutique
      </Button>
      <span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Étape 2 sur 2</span>
    </div>

    <div
      v-if="modeApercu"
      class="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"
    >
      <LockKeyhole class="mt-0.5 size-4 shrink-0 text-blue-600" />
      <p>
        <span class="font-semibold">Mode aperçu</span>
        — cette page reproduit la confirmation client, mais aucune commande ne peut être envoyée.
      </p>
    </div>

    <Card class="overflow-hidden">
      <CardHeader class="border-b bg-muted/25">
        <div class="flex items-start gap-3">
          <span class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck class="size-5" />
          </span>
          <div class="grid gap-1">
            <CardTitle class="text-xl">
              {{ modification ? `Confirmer la modification #${modification.numero ?? modification.idCommande}` : 'Confirmer votre commande' }}
            </CardTitle>
            <CardDescription>
              {{ modification ? 'Cette version annulera et remplacera la précédente.' : 'Vérifiez une dernière fois votre commande avant de la transmettre à GOA.' }}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent class="grid gap-5 p-4 sm:p-6">
        <div v-if="catalogue.isPending.value" class="grid gap-3" aria-busy="true">
          <Skeleton v-for="i in 3" :key="i" class="h-20 rounded-lg" />
        </div>

        <div v-else-if="catalogue.isError.value" class="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          Impossible de charger le récapitulatif : {{ (catalogue.error.value as Error)?.message }}
        </div>

        <div v-else-if="!lignesDetail.length" class="grid justify-items-center gap-3 py-8 text-center">
          <p class="font-medium">Votre panier est vide.</p>
          <p class="text-sm text-muted-foreground">Ajoutez des produits avant de confirmer une commande.</p>
          <Button variant="outline" @click="router.push(retourBoutique)">Retour à la boutique</Button>
        </div>

        <template v-else>
          <PanierRecap
            :lignes="lignesDetail"
            :total-h-t="totalHT"
            :minimum="minimum"
            :sous-minimum="sousMinimum"
            :erreurs-conditionnement="erreursConditionnementPostal"
            :remise-montant="remiseMontant"
            :remises-detail="remisesDetail"
          />

          <div class="grid gap-1.5 border-t pt-5">
            <Label for="commentaire">Commentaire (facultatif)</Label>
            <Textarea
              id="commentaire"
              v-model="commentaire"
              placeholder="Précisions de livraison, demandes particulières…"
              rows="4"
            />
          </div>

          <div v-if="commandeBloqueeParPrix || (sousMinimum && minimum != null) || erreurEnvoi" class="grid gap-2">
            <p v-if="commandeBloqueeParPrix" class="text-sm text-amber-700">
              Un ou plusieurs tarifs doivent être vérifiés avant l’envoi.
            </p>
            <p v-if="sousMinimum && minimum != null" class="text-sm text-amber-700">
              Minimum de commande : {{ prixFr(minimum) }} HT.
            </p>
            <div
              v-if="erreurEnvoi"
              class="flex gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive"
              role="alert"
            >
              <TriangleAlert class="mt-0.5 size-4 shrink-0" />
              <div class="min-w-0">
                <p class="font-semibold">{{ erreurEnvoi.titre }}</p>
                <p v-if="erreurEnvoi.message" class="mt-1 leading-snug break-words">{{ erreurEnvoi.message }}</p>
                <p v-if="erreurEnvoi.aide" class="mt-1 text-xs text-destructive/80">{{ erreurEnvoi.aide }}</p>
              </div>
            </div>
          </div>
        </template>
      </CardContent>

      <CardFooter v-if="lignesDetail.length" class="flex flex-col-reverse gap-3 border-t bg-muted/20 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
        <Button variant="outline" class="w-full sm:w-auto" :disabled="envoi.isPending.value" @click="router.push(retourBoutique)">
          Modifier le panier
        </Button>
        <Button
          size="lg"
          class="w-full sm:min-w-64 sm:w-auto"
          :disabled="validationBloquee || envoi.isPending.value"
          @click="envoi.mutate()"
        >
          <Loader2 v-if="envoi.isPending.value" class="size-4 animate-spin" />
          {{ modeApercu ? 'Aperçu uniquement' : envoi.isPending.value ? 'Envoi en cours…' : modification ? 'Confirmer la modification' : 'Confirmer et envoyer' }}
        </Button>
      </CardFooter>
    </Card>
  </div>
</template>
