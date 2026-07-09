<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { AdminCommandesResponse } from '@/lib/types'
import { dateFr, dateHeureFr, prixFr } from '@/lib/format'
import { signalerBanEasybeer } from '@/composables/useEasybeerBan'
import EtatBadge from '@/components/EtatBadge.vue'
import CommandeDetailDialog from '@/components/admin/CommandeDetailDialog.vue'
import BoutonActualiser from '@/components/admin/BoutonActualiser.vue'
import EasybeerIndisponible from '@/components/admin/EasybeerIndisponible.vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const queryClient = useQueryClient()
const commandeOuverte = ref<number | null>(null)

const { data, isPending, isError, error, refetch, isFetching } = useQuery({
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
const commandesAffichees = computed(() =>
  toutAfficher.value ? (data.value?.commandes ?? []) : (data.value?.commandes ?? []).slice(0, PAR_PAGE),
)
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Commandes</CardTitle>
      <CardDescription>
        Les commandes les plus récentes, servies depuis le cache
        <template v-if="data"> (à jour : {{ dateHeureFr(data.syncedAt) }})</template>.
        La gestion (statuts, documents, facturation) se fait dans Easybeer.
      </CardDescription>
    </CardHeader>
    <CardContent class="grid gap-4">
      <div>
        <BoutonActualiser :pending="actualisation.isPending.value" @click="actualisation.mutate()" />
      </div>
      <div v-if="isPending" class="grid gap-2">
        <Skeleton v-for="i in 6" :key="i" class="h-10 w-full" />
      </div>

      <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

      <EasybeerIndisponible
        v-else-if="data?.indisponible"
        :pending="isFetching"
        @reessayer="refetch()"
      />

      <template v-else>
        <div class="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Paiement</TableHead>
                <TableHead class="text-right">Total TTC</TableHead>
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
                <TableCell class="text-sm text-muted-foreground">{{ dateFr(cmd.dateCreation) }}</TableCell>
                <TableCell><EtatBadge :etat="cmd.etat" /></TableCell>
                <TableCell class="text-sm text-muted-foreground">{{ cmd.paiement ?? '—' }}</TableCell>
                <TableCell class="text-right font-medium tabular-nums">
                  {{ cmd.totalTTC != null ? prixFr(cmd.totalTTC) : '—' }}
                </TableCell>
                <TableCell class="text-right text-muted-foreground">Détail →</TableCell>
              </TableRow>
              <TableRow v-if="!data?.commandes.length">
                <TableCell colspan="7" class="h-16 text-center text-muted-foreground">
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
