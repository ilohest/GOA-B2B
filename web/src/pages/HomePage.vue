<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CatalogueClientResponse, ProduitCatalogueClient } from '@/lib/types'
import { prixFr } from '@/lib/format'
import { useMe } from '@/composables/useMe'
import { usePanier } from '@/composables/usePanier'
import ProduitCard from '@/components/catalogue/ProduitCard.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

const { data, isPending, isError, error } = useMe()

const catalogue = useQuery({
  queryKey: ['catalogue'],
  queryFn: () => api.get<CatalogueClientResponse>('/catalogue'),
})

// --- Panier ---

const { quantites, changer, vider, modification, nbCartons, lignes } = usePanier()

const produitsParId = computed(() => {
  const map = new Map<number, ProduitCatalogueClient>()
  for (const p of catalogue.data.value?.produits ?? []) map.set(p.idStockBouteille, p)
  return map
})

const lignesDetail = computed(() =>
  lignes.value
    .map((l) => {
      const produit = produitsParId.value.get(l.idStockBouteille)
      return produit ? { ...l, produit, sousTotal: (produit.prixHT ?? 0) * l.quantite } : null
    })
    .filter((l): l is NonNullable<typeof l> => l !== null),
)

const totalHT = computed(() => lignesDetail.value.reduce((somme, l) => somme + l.sousTotal, 0))
const minimum = computed(() => data.value?.client?.minimumCommande ?? null)
const sousMinimum = computed(() => minimum.value != null && totalHT.value < minimum.value)

// --- Envoi de la commande ---

const queryClient = useQueryClient()
const dialogOuvert = ref(false)
const commentaire = ref('')
const confirmation = ref<{ numero?: number | null; totalHT: number; modification: boolean } | null>(null)

// En mode modification, on repart du commentaire existant de la commande.
watch(
  modification,
  (m) => {
    if (m) commentaire.value = m.commentaire
  },
  { immediate: true },
)

const envoi = useMutation({
  mutationFn: () => {
    const body = { commentaire: commentaire.value, lignes: lignes.value }
    return modification.value
      ? api.put<{ ok: boolean; totalHT: number; easybeer: { numero?: number } }>(
          `/commandes/${modification.value.idCommande}`,
          body,
        )
      : api.post<{ ok: boolean; totalHT: number; easybeer: { numero?: number } }>('/commandes', body)
  },
  onSuccess: (res) => {
    confirmation.value = {
      numero: res.easybeer.numero ?? modification.value?.numero ?? null,
      totalHT: res.totalHT,
      modification: modification.value != null,
    }
    vider()
    commentaire.value = ''
    queryClient.invalidateQueries({ queryKey: ['commandes'] })
  },
  onError: (e) => toast.error((e as Error).message),
})

function ouvrirRecap() {
  confirmation.value = null
  dialogOuvert.value = true
}
</script>

<template>
  <div class="grid gap-4 pb-24">
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Mon compte</CardTitle>
        <CardDescription>Informations lues depuis Easybeer</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="isPending" class="grid gap-2">
          <Skeleton class="h-5 w-2/3" />
          <Skeleton class="h-4 w-1/2" />
        </div>
        <p v-else-if="isError" class="text-sm text-destructive">
          Impossible de charger votre compte : {{ (error as Error)?.message }}
        </p>
        <dl v-else-if="data?.client" class="grid gap-2 text-sm">
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">Commerce</dt>
            <dd class="text-right font-medium">{{ data.client.nom ?? data.client.raisonSociale }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">N° client</dt>
            <dd class="text-right">{{ data.client.numero }}</dd>
          </div>
          <div v-if="minimum != null" class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">Minimum de commande</dt>
            <dd class="text-right">{{ prixFr(minimum) }} HT</dd>
          </div>
        </dl>
        <p v-else class="text-sm text-muted-foreground">
          Votre compte n'est pas encore relié à une fiche client — contactez GOA.
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Nos kombuchas</CardTitle>
        <CardDescription>Prix HT, selon vos conditions tarifaires.</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="catalogue.isPending.value" class="grid gap-3 sm:grid-cols-2">
          <Skeleton v-for="i in 4" :key="i" class="h-32 w-full" />
        </div>

        <p v-else-if="catalogue.isError.value" class="text-sm text-destructive">
          Impossible de charger le catalogue : {{ (catalogue.error.value as Error)?.message }}
        </p>

        <p v-else-if="!catalogue.data.value?.produits.length" class="text-sm text-muted-foreground">
          Le catalogue n'est pas encore disponible — revenez bientôt.
        </p>

        <div v-else class="grid gap-3 sm:grid-cols-2">
          <ProduitCard
            v-for="p in catalogue.data.value.produits"
            :key="p.idStockBouteille"
            :produit="p"
            :quantite="quantites[p.idStockBouteille] ?? 0"
            @changer="(delta) => changer(p.idStockBouteille, delta)"
          />
        </div>
      </CardContent>
    </Card>

    <!-- Barre panier -->
    <div v-if="nbCartons > 0 || modification" class="fixed inset-x-0 bottom-0 z-20 px-4 pb-4">
      <div
        class="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-xl border bg-background p-3 shadow-lg"
      >
        <div class="text-sm">
          <p v-if="modification" class="text-xs font-medium text-primary">
            Modification de la commande n° {{ modification.numero ?? modification.idCommande }}
          </p>
          <p class="font-semibold">{{ nbCartons }} carton{{ nbCartons > 1 ? 's' : '' }} — {{ prixFr(totalHT) }} HT</p>
          <p v-if="sousMinimum" class="text-xs text-destructive">
            Minimum de commande : {{ prixFr(minimum!) }} HT
          </p>
          <button
            v-if="modification"
            class="text-xs text-muted-foreground underline underline-offset-2"
            @click="vider(); commentaire = ''"
          >
            Annuler la modification
          </button>
        </div>
        <Button size="lg" :disabled="sousMinimum || nbCartons === 0" @click="ouvrirRecap">
          {{ modification ? 'Mettre à jour' : 'Commander' }}
        </Button>
      </div>
    </div>

    <!-- Récap + confirmation -->
    <Dialog v-model:open="dialogOuvert">
      <DialogContent class="sm:max-w-md">
        <template v-if="!confirmation">
          <DialogHeader>
            <DialogTitle>
              {{ modification ? `Modifier la commande n° ${modification.numero ?? modification.idCommande}` : 'Récapitulatif de votre commande' }}
            </DialogTitle>
            <DialogDescription>
              {{ modification ? 'Cette version annule et remplace la précédente.' : "Vérifiez les quantités avant l'envoi." }}
            </DialogDescription>
          </DialogHeader>
          <ul class="grid gap-2 text-sm">
            <li
              v-for="l in lignesDetail"
              :key="l.idStockBouteille"
              class="flex items-baseline justify-between gap-3"
            >
              <span>{{ l.produit.libelle }} × {{ l.quantite }}</span>
              <span class="font-medium tabular-nums">{{ prixFr(l.sousTotal) }}</span>
            </li>
            <li class="flex items-baseline justify-between gap-3 border-t pt-2 font-semibold">
              <span>Total HT</span>
              <span class="tabular-nums">{{ prixFr(totalHT) }}</span>
            </li>
          </ul>
          <div class="grid gap-1.5">
            <Label for="commentaire">Commentaire (facultatif)</Label>
            <Textarea
              id="commentaire"
              v-model="commentaire"
              placeholder="Précisions de livraison, demandes particulières…"
              rows="3"
            />
          </div>
          <DialogFooter>
            <Button class="w-full" size="lg" :disabled="envoi.isPending.value" @click="envoi.mutate()">
              {{ envoi.isPending.value ? 'Envoi…' : modification ? 'Confirmer la modification' : 'Confirmer la commande' }}
            </Button>
          </DialogFooter>
        </template>

        <template v-else>
          <DialogHeader>
            <DialogTitle>{{ confirmation.modification ? 'Commande mise à jour ✓' : 'Commande envoyée ✓' }}</DialogTitle>
            <DialogDescription>
              Votre commande de {{ prixFr(confirmation.totalHT) }} HT a bien été transmise à GOA<template
                v-if="confirmation.numero"
              >
                (n° {{ confirmation.numero }})</template
              >.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button class="w-full" @click="dialogOuvert = false">Fermer</Button>
          </DialogFooter>
        </template>
      </DialogContent>
    </Dialog>
  </div>
</template>
