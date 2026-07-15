<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, ReceiptText } from '@lucide/vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { AdminCommandesResponse } from '@/lib/types'
import { dateFr, dateHeureFr, prixFr } from '@/lib/format'
import { easybeerLien } from '@/lib/easybeer'
import { signalerBanEasybeer } from '@/composables/useEasybeerBan'
import { useTriPersistant } from '@/composables/useTriPersistant'
import EtatBadge from '@/components/EtatBadge.vue'
import BoutonActualiser from '@/components/admin/BoutonActualiser.vue'
import CommandeDetailDialog from '@/components/admin/CommandeDetailDialog.vue'
import EasybeerLink from '@/components/admin/EasybeerLink.vue'
import EasybeerIndisponible from '@/components/admin/EasybeerIndisponible.vue'
import IconTooltip from '@/components/admin/IconTooltip.vue'
import PaiementBadge from '@/components/admin/PaiementBadge.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const queryClient = useQueryClient()
const commandeOuverte = ref<number | null>(null)

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'commandes'],
  queryFn: () => api.get<AdminCommandesResponse>('/admin/commandes'),
})

// Alimente le compte à rebours partagé quand la donnée n'est pas dispo.
watch(data, (d) => {
  if (d?.indisponible && d.retryAfterSeconds) signalerBanEasybeer(d.retryAfterSeconds)
})

const actualisation = useMutation({
  mutationFn: () => api.get<AdminCommandesResponse>('/admin/commandes?refresh=1'),
  onSuccess: (res) => {
    queryClient.setQueryData(['admin', 'commandes'], res)
    toast.success('Commandes actualisées.', {
      description: 'Les données commandes ont été mises à jour.',
    })
  },
  onError: (e) => toast.error((e as Error).message),
})

const optionsLignesParPage = [10, 25, 50, 100]
const lignesParPage = ref(25)
const pageCourante = ref(1)
type CleTri = 'numero' | 'client' | 'dateCreation' | 'etat' | 'facture' | 'paiement' | 'totalHT' | 'totalTTC'
const clesTri: CleTri[] = ['numero', 'client', 'dateCreation', 'etat', 'facture', 'paiement', 'totalHT', 'totalTTC']
const tri = useTriPersistant<CleTri>('goa-admin-commandes-tri-v1', { cle: 'dateCreation', direction: 'desc' }, clesTri)

function valeurTri(cmd: AdminCommandesResponse['commandes'][number], cle: CleTri) {
  switch (cle) {
    case 'numero':
      return cmd.numero ?? cmd.idCommande
    case 'client':
      return cmd.client?.nom?.toLowerCase() ?? ''
    case 'facture':
      return cmd.facture?.existe ? 1 : cmd.facture === null ? -1 : 0
    case 'dateCreation':
      return cmd.dateCreation ?? 0
    case 'etat':
      return cmd.etat.libelle.toLowerCase()
    case 'paiement':
      return cmd.paiement?.toLowerCase() ?? ''
    case 'totalHT':
      return cmd.totalHT ?? -1
    case 'totalTTC':
      return cmd.totalTTC ?? -1
  }
}

function basculerTri(cle: CleTri) {
  tri.value =
    tri.value.cle === cle
      ? { cle, direction: tri.value.direction === 'asc' ? 'desc' : 'asc' }
      : { cle, direction: 'asc' }
  pageCourante.value = 1
}

function changerTriMobile(cle: unknown) {
  if (!clesTri.includes(cle as CleTri)) return
  tri.value = { cle: cle as CleTri, direction: tri.value.direction }
  pageCourante.value = 1
}

function basculerDirectionTri() {
  tri.value = { cle: tri.value.cle, direction: tri.value.direction === 'asc' ? 'desc' : 'asc' }
  pageCourante.value = 1
}

const commandesTriees = computed(() =>
  [...(data.value?.commandes ?? [])].sort((a, b) => {
    const va = valeurTri(a, tri.value.cle)
    const vb = valeurTri(b, tri.value.cle)
    const resultat =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'fr', { numeric: true, sensitivity: 'base' })
    return tri.value.direction === 'asc' ? resultat : -resultat
  }),
)

const totalCommandes = computed(() => commandesTriees.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCommandes.value / lignesParPage.value)))
const debutPagination = computed(() =>
  totalCommandes.value === 0 ? 0 : (pageCourante.value - 1) * lignesParPage.value + 1,
)
const finPagination = computed(() => Math.min(totalCommandes.value, pageCourante.value * lignesParPage.value))

const commandesAffichees = computed(() => {
  const debut = (pageCourante.value - 1) * lignesParPage.value
  return commandesTriees.value.slice(debut, debut + lignesParPage.value)
})

watch(totalPages, (pages) => {
  if (pageCourante.value > pages) pageCourante.value = pages
})

function changerLignesParPage(valeur: unknown) {
  const prochaineValeur = Number(valeur)
  if (!Number.isFinite(prochaineValeur)) return
  lignesParPage.value = prochaineValeur
  pageCourante.value = 1
}

function allerPage(delta: number) {
  pageCourante.value = Math.min(totalPages.value, Math.max(1, pageCourante.value + delta))
}

const colonnesTri: { cle: CleTri; label: string; classe?: string }[] = [
  { cle: 'numero', label: '#' },
  { cle: 'dateCreation', label: 'Date' },
  { cle: 'etat', label: 'Statut' },
  { cle: 'client', label: 'Client' },
  { cle: 'facture', label: 'FA' },
  { cle: 'paiement', label: 'Paiement' },
  { cle: 'totalHT', label: 'Total HT', classe: 'justify-end' },
  { cle: 'totalTTC', label: 'Total TTC', classe: 'justify-end' },
]

const totalHTCommande = (cmd: AdminCommandesResponse['commandes'][number]) =>
  cmd.totalHT ?? (cmd.totalTTC != null ? cmd.totalTTC / 1.055 : null)
</script>

<template>
  <Card>
    <CardHeader class="gap-3">
        <div class="grid gap-3 sm:flex sm:items-start sm:justify-between">
          <div class="flex min-w-0 items-center justify-between gap-3 sm:block">
            <CardTitle class="flex items-center gap-2 text-lg">
              <ReceiptText class="size-5 text-muted-foreground" />
              Commandes
            </CardTitle>
            <EasybeerLink
              :href="easybeerLien.commandes(data?.easybeerAppUrl)"
              label="Ouvrir les commandes dans Easybeer"
              class="shrink-0 text-muted-foreground sm:hidden"
            />
          </div>
          <div class="grid justify-items-start gap-2 sm:justify-items-end">
            <div class="flex items-center gap-2">
              <p v-if="data?.syncedAt" class="text-xs whitespace-nowrap text-muted-foreground">
                À jour : {{ dateHeureFr(data.syncedAt) }}
            </p>
            <EasybeerLink
              :href="easybeerLien.commandes(data?.easybeerAppUrl)"
              label="Ouvrir les commandes dans Easybeer"
              class="hidden text-muted-foreground sm:inline-flex"
            />
          </div>
          <BoutonActualiser
            label="Actualiser les commandes"
            :pending="actualisation.isPending.value"
            @click="actualisation.mutate()"
          />
        </div>
      </div>
    </CardHeader>
    <CardContent class="grid gap-4">
      <div v-if="isPending" class="grid gap-2">
        <Skeleton v-for="i in 6" :key="i" class="h-10 w-full" />
      </div>

      <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

      <EasybeerIndisponible
        v-else-if="data?.indisponible"
        :pending="actualisation.isPending.value"
        @reessayer="actualisation.mutate()"
      />

      <template v-else>
        <div class="grid gap-3 md:hidden">
          <div class="grid gap-2 rounded-lg border bg-muted/30 p-3">
            <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trier par</span>
            <div class="flex items-center gap-2">
              <Select :model-value="tri.cle" @update:model-value="changerTriMobile">
                <SelectTrigger class="h-9 min-w-0 flex-1 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="colonne in colonnesTri"
                    :key="colonne.cle"
                    :value="colonne.cle"
                  >
                    {{ colonne.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" class="h-9 shrink-0" @click="basculerDirectionTri">
                <ArrowUp v-if="tri.direction === 'asc'" class="size-4" />
                <ArrowDown v-else class="size-4" />
                <span class="sr-only">Changer le sens du tri</span>
              </Button>
            </div>
          </div>

          <button
            v-for="cmd in commandesAffichees"
            :key="cmd.idCommande"
            class="grid gap-3 rounded-xl border bg-background p-3 text-left shadow-xs transition-colors hover:bg-muted/40"
            @click="commandeOuverte = cmd.idCommande"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="font-semibold">Commande n° {{ cmd.numero ?? cmd.idCommande }}</p>
                <p class="text-xs text-muted-foreground">{{ dateFr(cmd.dateCreation) }}</p>
              </div>
              <p class="shrink-0 text-right font-semibold tabular-nums">
                {{ cmd.totalTTC != null ? prixFr(cmd.totalTTC) : '—' }}
                <span class="block text-[11px] font-medium text-muted-foreground">TTC</span>
              </p>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <EtatBadge :etat="cmd.etat" />
              <PaiementBadge :paiement="cmd.paiement" />
              <span
                v-if="cmd.facture?.existe"
                class="inline-flex items-center gap-1 rounded-full border border-cyan-100 bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700"
              >
                <FileText class="size-3.5" />
                Facture
              </span>
            </div>

            <div class="grid gap-2 text-sm">
              <RouterLink
                v-if="cmd.client?.idClient"
                :to="`/admin/clients/${cmd.client.idClient}`"
                class="min-w-0 hover:underline"
                @click.stop
              >
                <span class="block truncate font-medium">{{ cmd.client.nom }}</span>
                <span class="text-xs text-muted-foreground">{{ cmd.client.numero }}</span>
              </RouterLink>
              <span v-else class="text-muted-foreground">Client non renseigné</span>

              <div class="flex items-center justify-between gap-3 border-t pt-2 text-xs">
                <span class="text-muted-foreground">Total HT</span>
                <span class="font-medium tabular-nums">
                  {{ totalHTCommande(cmd) != null ? prixFr(totalHTCommande(cmd)!) : '—' }}
                </span>
              </div>
            </div>
          </button>

          <p v-if="!data?.commandes.length" class="rounded-lg border p-4 text-center text-sm text-muted-foreground">
            Aucune commande.
          </p>
        </div>

        <div class="hidden rounded-lg border [&_[data-slot=table-container]]:overflow-visible md:block">
          <Table class="table-fixed">
            <colgroup>
              <col style="width: 6%" />
              <col style="width: 11%" />
              <col style="width: 12%" />
              <col style="width: 24%" />
              <col style="width: 6%" />
              <col style="width: 13%" />
              <col style="width: 11%" />
              <col style="width: 11%" />
              <col style="width: 6%" />
            </colgroup>
            <TableHeader class="[&_tr]:bg-muted">
              <TableRow>
                <TableHead
                  v-for="colonne in colonnesTri"
                  :key="colonne.cle"
                  :class="colonne.classe?.includes('justify-end') ? 'text-right' : ''"
                >
                  <button
                    class="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground/80 transition-colors hover:bg-background/80"
                    :class="colonne.classe"
                    @click="basculerTri(colonne.cle)"
                  >
                    {{ colonne.label }}
                    <ArrowUp v-if="tri.cle === colonne.cle && tri.direction === 'asc'" class="size-3" />
                    <ArrowDown v-else-if="tri.cle === colonne.cle && tri.direction === 'desc'" class="size-3" />
                    <ArrowUpDown v-else class="size-3 text-muted-foreground" />
                  </button>
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="cmd in commandesAffichees"
                :key="cmd.idCommande"
                class="cursor-pointer"
                @click="commandeOuverte = cmd.idCommande"
              >
                <TableCell class="font-medium">{{ cmd.numero ?? cmd.idCommande }}</TableCell>
                <TableCell class="text-sm text-muted-foreground">{{ dateFr(cmd.dateCreation) }}</TableCell>
                <TableCell><EtatBadge :etat="cmd.etat" /></TableCell>
                <TableCell class="min-w-0">
                  <RouterLink
                    v-if="cmd.client?.idClient"
                    :to="`/admin/clients/${cmd.client.idClient}`"
                    class="flex min-w-0 items-baseline gap-1 hover:underline"
                    @click.stop
                  >
                    <span class="truncate">{{ cmd.client.nom }}</span>
                    <span class="shrink-0 text-xs text-muted-foreground">{{ cmd.client.numero }}</span>
                  </RouterLink>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell class="text-center">
                  <IconTooltip v-if="cmd.facture?.existe" :text="cmd.facture.numero ?? 'Facture disponible'">
                    <FileText class="size-4 text-cyan-600" />
                  </IconTooltip>
                  <span
                    v-else-if="cmd.facture"
                    class="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600"
                  >
                    Non
                  </span>
                  <span v-else class="text-sm text-muted-foreground">—</span>
                </TableCell>
                <TableCell><PaiementBadge :paiement="cmd.paiement" /></TableCell>
                <TableCell class="text-right font-medium tabular-nums">
                  {{ totalHTCommande(cmd) != null ? prixFr(totalHTCommande(cmd)!) : '—' }}
                </TableCell>
                <TableCell class="text-right font-medium tabular-nums">
                  {{ cmd.totalTTC != null ? prixFr(cmd.totalTTC) : '—' }}
                </TableCell>
                <TableCell class="text-right text-muted-foreground">Détail →</TableCell>
              </TableRow>
              <TableRow v-if="!data?.commandes.length">
                <TableCell colspan="9" class="h-16 text-center text-muted-foreground">
                  Aucune commande.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {{ debutPagination }}-{{ finPagination }} / {{ totalCommandes }} commande(s)
          </span>

          <div class="flex flex-wrap items-center gap-2">
            <span class="whitespace-nowrap">Lignes par page</span>
            <Select :model-value="String(lignesParPage)" @update:model-value="changerLignesParPage">
              <SelectTrigger class="h-8 w-20 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in optionsLignesParPage"
                  :key="option"
                  :value="String(option)"
                >
                  {{ option }}
                </SelectItem>
              </SelectContent>
            </Select>

            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="pageCourante <= 1"
                @click="allerPage(-1)"
              >
                Précédent
              </Button>
              <span class="min-w-24 text-center tabular-nums">
                Page {{ pageCourante }} / {{ totalPages }}
              </span>
              <Button
                variant="outline"
                size="sm"
                :disabled="pageCourante >= totalPages"
                @click="allerPage(1)"
              >
                Suivant
              </Button>
            </div>
          </div>
        </div>
      </template>
    </CardContent>

    <CommandeDetailDialog
      v-model:id-commande="commandeOuverte"
      :easybeer-app-url="data?.easybeerAppUrl"
    />
  </Card>
</template>
