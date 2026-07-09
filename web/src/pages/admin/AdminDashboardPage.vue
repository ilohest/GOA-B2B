<script setup lang="ts">
import { computed } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { AdminDashboardResponse, SyncReport } from '@/lib/types'
import { dateHeureFr, prixFr } from '@/lib/format'
import BoutonActualiser from '@/components/admin/BoutonActualiser.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const queryClient = useQueryClient()

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'dashboard'],
  queryFn: () => api.get<AdminDashboardResponse>('/admin/dashboard'),
})

const synchro = useMutation({
  mutationFn: () => api.post<{ ok: boolean; report: SyncReport }>('/admin/sync'),
  onSuccess: ({ report }) => {
    toast.success(`Synchro terminée en ${Math.round(report.dureeMs / 1000)} s.`)
    queryClient.invalidateQueries()
  },
  onError: (e) => toast.error((e as Error).message),
})

const stats = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    {
      titre: 'Clients',
      valeur: String(d.clients.total),
      detail: `${d.clients.avecCompte} avec compte, dont ${d.clients.actifs} actif(s)`,
      lien: '/admin/clients',
      action: 'Gérer les clients',
    },
    {
      titre: 'Commandes (30 j)',
      valeur: String(d.commandes30j.nombre),
      detail: `${prixFr(d.commandes30j.caTTC)} TTC`,
      lien: '/admin/commandes',
      action: 'Voir les commandes',
    },
    {
      titre: 'Catalogue',
      valeur: `${d.catalogue.visibles}/${d.catalogue.produits}`,
      detail:
        d.catalogue.ruptures > 0
          ? `produits visibles — ${d.catalogue.ruptures} en rupture`
          : 'produits visibles',
      lien: '/admin/catalogue',
      action: 'Gérer le catalogue',
    },
  ]
})
</script>

<template>
  <div class="grid gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Tableau de bord</h1>
        <p class="text-sm text-muted-foreground">
          <template v-if="data?.dernierSync">
            Données synchronisées le {{ dateHeureFr(data.dernierSync) }}.
          </template>
          <template v-else>Aucune synchronisation complète pour l'instant.</template>
        </p>
      </div>
      <BoutonActualiser
        variant="secondary"
        label="Synchroniser Easybeer"
        label-pending="Synchronisation…"
        :pending="synchro.isPending.value"
        @click="synchro.mutate()"
      />
    </div>

    <div v-if="isPending" class="grid gap-4 sm:grid-cols-3">
      <Skeleton v-for="i in 3" :key="i" class="h-36 w-full" />
    </div>

    <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

    <div v-else class="grid gap-4 sm:grid-cols-3">
      <Card v-for="s in stats" :key="s.titre">
        <CardHeader class="pb-2">
          <CardDescription>{{ s.titre }}</CardDescription>
          <CardTitle class="text-3xl tracking-tight">{{ s.valeur }}</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-3">
          <p class="text-sm text-muted-foreground">{{ s.detail }}</p>
          <Button variant="outline" size="sm" class="justify-self-start" as-child>
            <RouterLink :to="s.lien">{{ s.action }}</RouterLink>
          </Button>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
