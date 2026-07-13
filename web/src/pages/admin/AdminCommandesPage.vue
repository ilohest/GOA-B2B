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
import EtatBadge from '@/components/EtatBadge.vue'
import CommandeDetailDialog from '@/components/admin/CommandeDetailDialog.vue'
import EasybeerLink from '@/components/admin/EasybeerLink.vue'
import EasybeerIndisponible from '@/components/admin/EasybeerIndisponible.vue'
import IconTooltip from '@/components/admin/IconTooltip.vue'
import PaiementBadge from '@/components/admin/PaiementBadge.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
    toast.success('Commandes resynchronisées depuis Easybeer.')
  },
  onError: (e) => toast.error((e as Error).message),
})

const toutAfficher = ref(false)
const PAR_PAGE = 25
type CleTri = 'numero' | 'client' | 'dateCreation' | 'etat' | 'facture' | 'paiement' | 'totalHT' | 'totalTTC'
const tri = ref<{ cle: CleTri; direction: 'asc' | 'desc' }>({ cle: 'dateCreation', direction: 'desc' })

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

const commandesAffichees = computed(() =>
  toutAfficher.value ? commandesTriees.value : commandesTriees.value.slice(0, PAR_PAGE),
)

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
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <CardTitle class="flex items-center gap-2 text-lg">
            <ReceiptText class="size-5 text-muted-foreground" />
            Commandes
          </CardTitle>
        </div>
        <div class="flex items-center gap-2">
          <p v-if="data?.syncedAt" class="text-xs whitespace-nowrap text-muted-foreground">
            À jour : {{ dateHeureFr(data.syncedAt) }}
          </p>
          <EasybeerLink
            :href="easybeerLien.commandes(data?.easybeerAppUrl)"
            label="Ouvrir les commandes dans Easybeer"
            class="text-muted-foreground"
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
        <div class="overflow-x-auto rounded-lg border">
          <Table>
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
                <TableCell>
                  <RouterLink
                    v-if="cmd.client?.idClient"
                    :to="`/admin/clients/${cmd.client.idClient}`"
                    class="hover:underline"
                    @click.stop
                  >
                    {{ cmd.client.nom }}
                    <span class="text-xs text-muted-foreground">{{ cmd.client.numero }}</span>
                  </RouterLink>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell>
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
            {{ commandesAffichees.length }} / {{ data?.commandes.length ?? 0 }} commande(s)
            (les plus récentes — l'historique complet reste dans Easybeer)
          </span>
          <Button
            v-if="(data?.commandes.length ?? 0) > PAR_PAGE"
            variant="ghost"
            size="sm"
            @click="toutAfficher = !toutAfficher"
          >
            {{ toutAfficher ? 'Réduire' : 'Tout afficher' }}
          </Button>
        </div>
      </template>
    </CardContent>

    <CommandeDetailDialog
      v-model:id-commande="commandeOuverte"
      :easybeer-app-url="data?.easybeerAppUrl"
    />
  </Card>
</template>
