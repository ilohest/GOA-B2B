<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { api } from '@/lib/api'
import type { AdminCommandesResponse } from '@/lib/types'
import { dateFr, prixFr } from '@/lib/format'
import EtatBadge from '@/components/EtatBadge.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'commandes'],
  queryFn: () => api.get<AdminCommandesResponse>('/admin/commandes'),
})
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Commandes</CardTitle>
      <CardDescription>
        Toutes les commandes de la brasserie, lues en direct d'Easybeer. La gestion
        (statuts, documents, facturation) se fait dans Easybeer.
      </CardDescription>
    </CardHeader>
    <CardContent class="grid gap-4">
      <div v-if="isPending" class="grid gap-2">
        <Skeleton v-for="i in 6" :key="i" class="h-10 w-full" />
      </div>

      <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

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
              <TableRow v-for="cmd in data?.commandes" :key="cmd.idCommande">
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
                <TableCell class="text-right">
                  <Button variant="ghost" size="sm" as-child>
                    <a :href="data?.easybeerAppUrl" target="_blank" rel="noopener">
                      Ouvrir Easybeer ↗
                    </a>
                  </Button>
                </TableCell>
              </TableRow>
              <TableRow v-if="!data?.commandes.length">
                <TableCell colspan="7" class="h-16 text-center text-muted-foreground">
                  Aucune commande.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <p class="text-sm text-muted-foreground">
          {{ data?.commandes.length ?? 0 }} commande(s) affichée(s)
          <template v-if="(data?.totalElements ?? 0) > (data?.commandes.length ?? 0)">
            (les plus récentes — l'historique complet reste dans Easybeer)
          </template>
        </p>
      </template>
    </CardContent>
  </Card>
</template>
