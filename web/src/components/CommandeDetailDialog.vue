<script setup lang="ts">
/**
 * Dialog partagé de détail d'une commande : lignes, totaux HT/TVA/TTC et
 * documents téléchargeables. Le contexte sélectionne les routes admin/client.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { useQuery } from '@tanstack/vue-query'
import { useResizeObserver } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CommandeDetail } from '@/lib/types'
import { dateFr, decomposerTotaux, prixFr } from '@/lib/format'
import { easybeerLien } from '@/lib/easybeer'
import { useEasybeerBan } from '@/composables/useEasybeerBan'
import EasybeerLink from '@/components/admin/EasybeerLink.vue'
import IconTooltip from '@/components/admin/IconTooltip.vue'
import EtatBadge from '@/components/EtatBadge.vue'
import ProduitFormat from '@/components/catalogue/ProduitFormat.vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const props = withDefaults(defineProps<{
  idCommande: number | null
  easybeerAppUrl?: string
  contexte?: 'admin' | 'client'
  idsCommandes?: number[]
}>(), { contexte: 'admin' })
const emit = defineEmits<{ 'update:idCommande': [value: number | null] }>()

const ouvert = computed({
  get: () => props.idCommande != null,
  set: (v) => {
    if (!v) emit('update:idCommande', null)
  },
})

const idCommande = computed(() => props.idCommande)
const indexCommande = computed(() =>
  props.idCommande == null ? -1 : (props.idsCommandes ?? []).indexOf(props.idCommande),
)
const idCommandePrecedente = computed(() =>
  indexCommande.value > 0 ? (props.idsCommandes?.[indexCommande.value - 1] ?? null) : null,
)
const idCommandeSuivante = computed(() =>
  indexCommande.value >= 0 && indexCommande.value < (props.idsCommandes?.length ?? 0) - 1
    ? (props.idsCommandes?.[indexCommande.value + 1] ?? null)
    : null,
)
const routeCommandes = computed(() => props.contexte === 'admin' ? '/admin/commandes' : '/commandes')
const { data, isPending, isError, error, refetch, isFetching } = useQuery({
  queryKey: computed(() => [props.contexte, 'commande', idCommande.value]),
  queryFn: () => api.get<CommandeDetail>(`${routeCommandes.value}/${props.idCommande}`),
  enabled: computed(() => props.idCommande != null),
  retry: false,
})

const { banni, secondesRestantes } = useEasybeerBan()

const totaux = computed(() => (data.value ? decomposerTotaux(data.value) : []))

const telechargementEnCours = ref<number | null>(null)
const listeMobile = ref<HTMLElement | null>(null)
const listeDesktop = ref<HTMLElement | null>(null)
const listeMobileDeborde = ref(false)
const listeDesktopDeborde = ref(false)
const listeMobileEnBas = ref(true)
const listeDesktopEnBas = ref(true)

function mesurerListe(
  element: HTMLElement | null,
  deborde: typeof listeMobileDeborde,
  enBas: typeof listeMobileEnBas,
) {
  if (!element || element.clientHeight === 0) {
    deborde.value = false
    enBas.value = true
    return
  }
  deborde.value = element.scrollHeight > element.clientHeight + 2
  enBas.value = element.scrollTop + element.clientHeight >= element.scrollHeight - 2
}

const mesurerListeMobile = () => mesurerListe(listeMobile.value, listeMobileDeborde, listeMobileEnBas)
const mesurerListeDesktop = () => mesurerListe(listeDesktop.value, listeDesktopDeborde, listeDesktopEnBas)

useResizeObserver(listeMobile, mesurerListeMobile)
useResizeObserver(listeDesktop, mesurerListeDesktop)

onMounted(async () => {
  await nextTick()
  mesurerListeMobile()
  mesurerListeDesktop()
})

async function telecharger(doc: CommandeDetail['documents'][number]) {
  if (props.idCommande == null) return
  telechargementEnCours.value = doc.idCommandeDocument
  try {
    await api.telecharger(
      `${routeCommandes.value}/${props.idCommande}/documents/${doc.idCommandeDocument}/pdf`,
      doc.nomFichier,
    )
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    telechargementEnCours.value = null
  }
}

watch(
  () => props.idCommande,
  async () => {
    telechargementEnCours.value = null
    if (listeMobile.value) listeMobile.value.scrollTop = 0
    if (listeDesktop.value) listeDesktop.value.scrollTop = 0
    await nextTick()
    mesurerListeMobile()
    mesurerListeDesktop()
  },
)

watch(
  () => data.value?.lignes.length,
  async () => {
    await nextTick()
    mesurerListeMobile()
    mesurerListeDesktop()
  },
)
</script>

<template>
  <Dialog v-model:open="ouvert">
    <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[min(92vw,72rem)]">
      <div class="absolute top-2 right-10 flex items-center gap-0.5">
        <IconTooltip text="Commande précédente">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Commande précédente"
            :disabled="idCommandePrecedente == null"
            @click="emit('update:idCommande', idCommandePrecedente)"
          >
            <ChevronLeft class="size-4" />
          </Button>
        </IconTooltip>
        <IconTooltip text="Commande suivante">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Commande suivante"
            :disabled="idCommandeSuivante == null"
            @click="emit('update:idCommande', idCommandeSuivante)"
          >
            <ChevronRight class="size-4" />
          </Button>
        </IconTooltip>
        <EasybeerLink
          v-if="contexte === 'admin' && idCommande != null"
          :href="easybeerLien.commandeDetail(easybeerAppUrl, idCommande)"
          label="Ouvrir la commande dans Easybeer"
          class="text-muted-foreground"
        />
      </div>
      <DialogHeader class="pr-32">
        <DialogTitle class="flex items-center gap-2">
          Commande #{{ data?.numero ?? idCommande }}
          <EtatBadge v-if="data?.etat" :etat="data.etat" />
        </DialogTitle>
        <DialogDescription v-if="data?.dateCreation">
          Commandée le {{ dateFr(data.dateCreation) }}
        </DialogDescription>
        <DialogDescription v-if="contexte === 'admin' && data?.client">
          Client : <span class="font-medium text-foreground">{{ data.client.nom ?? '—' }}</span>
          <template v-if="data.client.numero"> · {{ data.client.numero }}</template>
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="isPending"
        class="grid gap-4"
        aria-label="Chargement du détail de la commande"
        aria-busy="true"
      >
        <div class="grid gap-3 sm:hidden">
          <div v-for="i in 2" :key="i" class="grid gap-3 rounded-lg border p-3">
            <div class="flex justify-between gap-3">
              <Skeleton class="h-4 w-2/3" />
              <Skeleton class="h-5 w-16" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <Skeleton v-for="j in 4" :key="j" class="h-12 rounded-md" />
            </div>
          </div>
        </div>
        <div class="hidden overflow-hidden rounded-lg border sm:block">
          <div class="grid grid-cols-6 gap-3 bg-muted p-3">
            <Skeleton v-for="i in 6" :key="`head-${i}`" class="h-4" />
          </div>
          <div v-for="ligne in 3" :key="ligne" class="grid grid-cols-6 gap-3 border-t p-3">
            <Skeleton class="h-4 w-3/4" />
            <Skeleton v-for="i in 5" :key="i" class="h-4" />
          </div>
        </div>
        <div class="ml-auto grid w-full max-w-xs gap-2 rounded-lg border p-3">
          <div v-for="i in 3" :key="i" class="flex justify-between gap-4">
            <Skeleton class="h-4 w-20" />
            <Skeleton class="h-4 w-24" />
          </div>
        </div>
      </div>

      <!-- Détail momentanément indisponible : message doux + réessai, plutôt qu'une erreur rouge -->
      <div v-else-if="isError && banni" class="grid justify-items-center gap-3 py-4 text-center">
        <p class="text-sm text-muted-foreground">
          Le détail de la commande n’est pas disponible pour le moment.
          Réessayez dans {{ secondesRestantes }} s.
        </p>
        <Button variant="outline" size="sm" :disabled="isFetching || banni" @click="refetch()">
          {{ isFetching ? 'Chargement…' : `Réessayez dans ${secondesRestantes} s` }}
        </Button>
      </div>

      <div v-else-if="isError" class="grid justify-items-center gap-3 py-4 text-center">
        <p class="text-sm text-destructive">{{ (error as Error)?.message }}</p>
        <Button variant="outline" size="sm" :disabled="isFetching" @click="refetch()">Réessayer</Button>
      </div>

      <div v-else-if="data" class="grid gap-4">
        <dl
          v-if="data.modeLivraison"
          class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
        >
          <dt class="text-muted-foreground">Mode de livraison</dt>
          <dd class="font-medium">{{ data.modeLivraison }}</dd>
        </dl>

        <div class="relative min-h-0 sm:hidden">
          <div
            ref="listeMobile"
            class="grid max-h-[min(52dvh,32rem)] gap-3 overflow-y-auto overscroll-contain pr-1"
            @scroll="mesurerListeMobile"
          >
            <article
              v-for="(l, i) in data.lignes"
              :key="i"
              class="grid gap-3 rounded-lg border bg-background p-3 odd:bg-background even:bg-muted/35"
            >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="font-medium leading-snug">{{ l.designation }}</p>
                <ProduitFormat
                  class="mt-1"
                  :contenant="l.contenant"
                  :packaging="l.packaging"
                />
              </div>
              <p class="shrink-0 text-right font-semibold tabular-nums">
                {{ l.totalHT != null ? prixFr(l.totalHT) : '—' }}
                <span class="block text-[11px] font-medium text-muted-foreground">HT</span>
              </p>
            </div>

            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="rounded-md bg-muted/50 px-2 py-1.5">
                <p class="text-muted-foreground">Qté</p>
                <p class="font-medium tabular-nums">{{ l.quantite }}</p>
              </div>
              <div class="rounded-md bg-muted/50 px-2 py-1.5">
                <p class="text-muted-foreground">Prix unitaire HT</p>
                <p class="font-medium tabular-nums">
                  {{ l.prixUnitaireHT != null ? prixFr(l.prixUnitaireHT) : '—' }}
                </p>
              </div>
              <div class="rounded-md bg-muted/50 px-2 py-1.5">
                <p class="text-muted-foreground">TVA</p>
                <p class="font-medium tabular-nums">{{ l.tvaLigne != null ? prixFr(l.tvaLigne) : '—' }}</p>
              </div>
              <div class="rounded-md bg-muted/50 px-2 py-1.5">
                <p class="text-muted-foreground">Remise</p>
                <div v-if="l.remiseLabel || l.remiseMontant" class="flex flex-wrap items-center gap-1">
                  <Badge v-if="l.remiseLabel" variant="secondary" class="border border-green-200 bg-green-50 text-green-700">
                    {{ l.remiseLabel }}
                  </Badge>
                  <span v-if="l.remiseMontant" class="font-medium tabular-nums text-green-700">
                    − {{ prixFr(l.remiseMontant) }}
                  </span>
                </div>
                <p v-else class="font-medium text-muted-foreground">—</p>
              </div>
            </div>
            </article>
          </div>
          <div
            v-if="listeMobileDeborde && !listeMobileEnBas"
            class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/95 to-transparent px-2 pt-8 pb-1"
            aria-hidden="true"
          >
            <span class="rounded-full border bg-background px-2.5 py-1 text-[0.68rem] font-medium text-muted-foreground shadow-sm">
              Faites défiler pour voir les autres produits ↓
            </span>
          </div>
        </div>

        <div class="relative hidden min-h-0 overflow-hidden rounded-lg border sm:block">
          <div
            ref="listeDesktop"
            class="max-h-[min(50dvh,30rem)] overflow-auto overscroll-contain"
            @scroll="mesurerListeDesktop"
          >
          <Table>
            <TableHeader class="sticky top-0 z-10 [&_tr]:bg-muted">
              <TableRow>
                <TableHead class="min-w-72">Produit</TableHead>
                <TableHead class="w-16 text-right">Qté</TableHead>
                <TableHead class="w-36 text-right">Prix unitaire HT</TableHead>
                <TableHead class="w-36 text-right">Remise</TableHead>
                <TableHead class="w-28 text-right">TVA</TableHead>
                <TableHead class="w-32 text-right">Total HT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="(l, i) in data.lignes" :key="i" class="odd:bg-background even:bg-muted/45">
                <TableCell>
                  <p class="font-medium leading-snug">{{ l.designation }}</p>
                  <ProduitFormat
                    class="mt-1"
                    :contenant="l.contenant"
                    :packaging="l.packaging"
                  />
                </TableCell>
                <TableCell class="text-right tabular-nums">{{ l.quantite }}</TableCell>
                <TableCell class="text-right tabular-nums text-muted-foreground">
                  {{ l.prixUnitaireHT != null ? prixFr(l.prixUnitaireHT) : '—' }}
                </TableCell>
                <TableCell class="text-right tabular-nums">
                  <span v-if="l.remiseLabel || l.remiseMontant" class="inline-grid justify-items-end gap-1">
                    <Badge v-if="l.remiseLabel" variant="secondary" class="border border-green-200 bg-green-50 text-green-700">
                      {{ l.remiseLabel }}
                    </Badge>
                    <span v-if="l.remiseMontant" class="text-green-700">− {{ prixFr(l.remiseMontant) }}</span>
                  </span>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell class="text-right tabular-nums text-muted-foreground">
                  {{ l.tvaLigne != null ? prixFr(l.tvaLigne) : '—' }}
                </TableCell>
                <TableCell class="text-right tabular-nums text-muted-foreground">
                  <span>{{ l.totalHT != null ? prixFr(l.totalHT) : '—' }}</span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          </div>
          <div
            v-if="listeDesktopDeborde && !listeDesktopEnBas"
            class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/95 to-transparent px-2 pt-8 pb-1"
            aria-hidden="true"
          >
            <span class="rounded-full border bg-background px-2.5 py-1 text-[0.68rem] font-medium text-muted-foreground shadow-sm">
              Faites défiler pour voir les autres produits ↓
            </span>
          </div>
        </div>

        <dl class="grid gap-1 border-t pt-3 text-sm">
          <div
            v-for="t in totaux"
            :key="t.label"
            class="flex items-baseline justify-between gap-3"
            :class="t.fort ? 'font-semibold' : 'text-muted-foreground'"
          >
            <dt>{{ t.label }}</dt>
            <dd class="tabular-nums">{{ t.valeur }}</dd>
          </div>
        </dl>

        <p v-if="data.commentaire" class="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground italic">
          « {{ data.commentaire }} »
        </p>

        <div v-if="data.documents.length" class="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button
            v-for="doc in data.documents"
            :key="doc.idCommandeDocument"
            variant="outline"
            size="sm"
            :disabled="telechargementEnCours === doc.idCommandeDocument"
            @click="telecharger(doc)"
          >
            ⤓ {{ doc.libelle }} {{ doc.code }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
