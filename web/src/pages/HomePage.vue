<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { PackageCheck, Store } from '@lucide/vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CatalogueClientResponse, ProduitCatalogueClient } from '@/lib/types'
import { prixFr } from '@/lib/format'
import { useMe } from '@/composables/useMe'
import { usePanier } from '@/composables/usePanier'
import ProduitCard from '@/components/catalogue/ProduitCard.vue'
import PanierRecap from '@/components/catalogue/PanierRecap.vue'
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

const router = useRouter()
const { data, isPending, isError, error } = useMe()

// L'admin n'a pas d'espace boutique : direction l'administration.
watchEffect(() => {
  if (data.value?.user.role === 'admin') router.replace('/admin')
})

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
      return produit
        ? { ...l, libelle: produit.libelle, produit, sousTotal: (produit.prixHT ?? 0) * l.quantite }
        : null
    })
    .filter((l): l is NonNullable<typeof l> => l !== null),
)

const totalHT = computed(() => lignesDetail.value.reduce((somme, l) => somme + l.sousTotal, 0))
const minimum = computed(() => data.value?.client?.minimumCommande ?? null)
const sousMinimum = computed(() => minimum.value != null && totalHT.value < minimum.value)
const lignesPrixExpires = computed(() => lignesDetail.value.filter((l) => !l.produit.prixEstFrais))
const commandeBloqueeParPrix = computed(() => lignesPrixExpires.value.length > 0)
const panierVisible = computed(() => nbCartons.value > 0 || modification.value != null)
const tagsClient = computed(() => {
  const tags = data.value?.client?.tags
  if (!tags) return []
  return (Array.isArray(tags) ? tags : String(tags).split(','))
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
})
const livraisonPostale = computed(() => tagsClient.value.includes('laposte'))
const pasLivraisonPostale = computed(() =>
  [...new Set((catalogue.data.value?.produits ?? []).map((p) => p.pas).filter((pas) => pas > 1))]
    .sort((a, b) => a - b),
)
const resumeLivraisonPostale = computed(() => {
  if (!pasLivraisonPostale.value.length) return 'La Poste impose des colis homogènes : commande par cartons complets.'
  return `La Poste impose des colis homogènes : commande par ${pasLivraisonPostale.value.join(' ou ')} cartons selon le format.`
})
const agePrixCatalogue = computed(() => {
  const ageMs = catalogue.data.value?.prixPlusAncienAgeMs
  if (ageMs == null) return null
  const minutes = Math.max(1, Math.ceil(ageMs / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
})

/** Volet détail de la barre mobile. */
const barreDepliee = ref(false)

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
    barreDepliee.value = false
    queryClient.invalidateQueries({ queryKey: ['commandes'] })
  },
  onError: (e) => toast.error((e as Error).message),
})

function ouvrirRecap() {
  confirmation.value = null
  dialogOuvert.value = true
}

function annulerModification() {
  vider()
  commentaire.value = ''
  barreDepliee.value = false
}
</script>

<template>
  <div class="grid items-start gap-4 pb-28 lg:grid-cols-[minmax(0,1fr)_20rem] lg:pb-4">
    <!-- Colonne principale -->
    <div class="grid gap-4">
      <!-- Bandeau mode modification -->
      <div
        v-if="modification"
        class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
      >
        <p class="text-sm">
          <span class="font-semibold text-primary">
            Modification de la commande n° {{ modification.numero ?? modification.idCommande }}
          </span>
          <span class="text-muted-foreground">
            — ajustez les quantités ci-dessous puis validez. La nouvelle version annule et
            remplace la précédente.
          </span>
        </p>
        <Button variant="outline" size="sm" @click="annulerModification">Annuler</Button>
      </div>

      <div
        v-if="livraisonPostale"
        class="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
      >
        <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-background text-primary shadow-xs">
          <PackageCheck class="size-4" />
        </span>
        <div class="grid gap-0.5">
          <p class="font-medium text-foreground">
            Livraison La Poste : commande par cartons complets
          </p>
          <p class="text-muted-foreground">
            {{ resumeLivraisonPostale }} Les boutons +/− suivent ce pas automatiquement.
          </p>
        </div>
      </div>

      <section>
        <div class="mb-5">
          <h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Store class="size-5 text-muted-foreground" />
            Nos kombuchas
          </h1>
          <p v-if="agePrixCatalogue" class="mt-1 text-xs text-muted-foreground">
            Tarifs synchronisés il y a {{ agePrixCatalogue }}.
          </p>
        </div>

        <div v-if="catalogue.isPending.value || isPending" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton v-for="i in 6" :key="i" class="h-72 w-full rounded-2xl" />
        </div>

        <p v-else-if="catalogue.isError.value" class="text-sm text-destructive">
          Impossible de charger le catalogue : {{ (catalogue.error.value as Error)?.message }}
        </p>
        <p v-else-if="isError" class="text-sm text-destructive">
          Impossible de charger votre compte : {{ (error as Error)?.message }}
        </p>

        <p v-else-if="!catalogue.data.value?.produits.length" class="text-sm text-muted-foreground">
          Le catalogue n'est pas encore disponible — revenez bientôt.
        </p>

        <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ProduitCard
            v-for="p in catalogue.data.value.produits"
            :key="p.idStockBouteille"
            :produit="p"
            :quantite="quantites[p.idStockBouteille] ?? 0"
            @changer="(delta) => changer(p.idStockBouteille, delta)"
          />
        </div>
      </section>
    </div>

    <!-- Colonne récap (desktop) -->
    <aside class="sticky top-20 hidden lg:block">
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">
            {{ modification ? `Modification n° ${modification.numero ?? modification.idCommande}` : 'Votre commande' }}
          </CardTitle>
          <CardDescription v-if="modification">
            La nouvelle version annule et remplace la précédente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PanierRecap :lignes="lignesDetail" :total-h-t="totalHT" :minimum="minimum" :sous-minimum="sousMinimum">
            <p v-if="commandeBloqueeParPrix" class="text-xs text-amber-700">
              Un ou plusieurs tarifs doivent être vérifiés avant l'envoi.
            </p>
            <Button
              class="mt-2 w-full"
              size="lg"
              :disabled="sousMinimum || commandeBloqueeParPrix || nbCartons === 0"
              @click="ouvrirRecap"
            >
              {{ modification ? 'Mettre à jour' : 'Commander' }}
            </Button>
            <Button
              v-if="modification"
              variant="ghost"
              class="w-full text-muted-foreground"
              @click="annulerModification"
            >
              Annuler la modification
            </Button>
          </PanierRecap>
        </CardContent>
      </Card>
    </aside>

    <!-- Barre panier (mobile) : résumé + volet détail dépliable -->
    <div v-if="panierVisible" class="fixed inset-x-0 bottom-0 z-20 px-4 pb-4 lg:hidden">
      <div class="mx-auto w-full max-w-5xl rounded-xl border bg-background shadow-lg">
        <div v-if="barreDepliee" class="border-b p-4">
          <p v-if="modification" class="mb-2 text-xs font-medium text-primary">
            Modification de la commande n° {{ modification.numero ?? modification.idCommande }} —
            la nouvelle version annule et remplace la précédente.
          </p>
          <PanierRecap :lignes="lignesDetail" :total-h-t="totalHT" :minimum="minimum" :sous-minimum="sousMinimum">
            <p v-if="commandeBloqueeParPrix" class="text-xs text-amber-700">
              Un ou plusieurs tarifs doivent être vérifiés avant l'envoi.
            </p>
            <button
              v-if="modification"
              class="justify-self-start text-xs text-muted-foreground underline underline-offset-2"
              @click="annulerModification"
            >
              Annuler la modification
            </button>
          </PanierRecap>
        </div>
        <div class="flex items-center justify-between gap-3 p-3">
          <button
            class="min-w-0 flex-1 text-left"
            :aria-expanded="barreDepliee"
            aria-label="Voir le détail du panier"
            @click="barreDepliee = !barreDepliee"
          >
            <p v-if="modification" class="text-xs font-medium text-primary">
              Modification n° {{ modification.numero ?? modification.idCommande }}
            </p>
            <p class="text-sm font-semibold">
              {{ nbCartons }} carton{{ nbCartons > 1 ? 's' : '' }} — {{ prixFr(totalHT) }} HT
              <span class="ml-1 text-muted-foreground">{{ barreDepliee ? '▾' : '▴' }}</span>
            </p>
            <p v-if="sousMinimum" class="text-xs text-destructive">
              Minimum : {{ prixFr(minimum!) }} HT
            </p>
          </button>
          <Button size="lg" :disabled="sousMinimum || commandeBloqueeParPrix || nbCartons === 0" @click="ouvrirRecap">
            {{ modification ? 'Mettre à jour' : 'Commander' }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Confirmation -->
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
          <PanierRecap :lignes="lignesDetail" :total-h-t="totalHT" :minimum="minimum" :sous-minimum="sousMinimum" />
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
            <p v-if="commandeBloqueeParPrix" class="text-xs text-amber-700">
              Un ou plusieurs tarifs doivent être vérifiés avant l'envoi.
            </p>
            <Button
              class="w-full"
              size="lg"
              :disabled="envoi.isPending.value || commandeBloqueeParPrix"
              @click="envoi.mutate()"
            >
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
