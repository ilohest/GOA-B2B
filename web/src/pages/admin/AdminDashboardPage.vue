<script setup lang="ts">
import { computed } from 'vue'
import { LayoutDashboard } from '@lucide/vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { AdminDashboardResponse, SyncReport, SyncStatusResponse } from '@/lib/types'
import { dateHeureFr, prixFr } from '@/lib/format'
import { easybeerLien } from '@/lib/easybeer'
import BoutonActualiser from '@/components/admin/BoutonActualiser.vue'
import EasybeerLink from '@/components/admin/EasybeerLink.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const queryClient = useQueryClient()
const SYNC_ATTENTION_MS = 30 * 60 * 60 * 1000

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'dashboard'],
  queryFn: () => api.get<AdminDashboardResponse>('/admin/dashboard'),
})

const statutSync = useQuery({
  queryKey: ['admin', 'sync-status'],
  queryFn: () => api.get<SyncStatusResponse>('/admin/sync/status'),
})

const syncAncienne = computed(() => {
  const dernierSync = data.value?.dernierSync
  return !dernierSync || Date.now() - dernierSync > SYNC_ATTENTION_MS
})

const synchro = useMutation({
  mutationFn: () => api.post<{ ok: boolean; report: SyncReport }>('/admin/sync'),
  onSuccess: ({ report }) => {
    toast.success('Synchronisation terminée.', {
      description: `Les données Easybeer sont à jour (${Math.round(report.dureeMs / 1000)} s).`,
    })
    queryClient.invalidateQueries()
  },
  onError: (e) => {
    toast.error((e as Error).message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'sync-status'] })
  },
})

const diagnosticSync = computed(() => {
  const s = statutSync.data.value
  if (!s) return null
  if (s.banMemoire.banni) {
    return `Ban local actif : ${s.banMemoire.secondesRestantes} s restantes.`
  }
  if (s.banPersiste?.actif) {
    return `Ban persisté jusqu'à ${dateHeureFr(s.banPersiste.until)}.`
  }
  if (s.verrou && (s.verrou.ageMinutes ?? 0) >= 15) {
    return `Verrou de synchronisation ancien (${s.verrou.ageMinutes} min).`
  }
  return 'Aucun ban local actif détecté.'
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
      easybeer: easybeerLien.clients(),
      action: 'Gérer les clients',
    },
    {
      titre: 'Commandes (30 j)',
      valeur: String(d.commandes30j.nombre),
      detail: `${prixFr(d.commandes30j.caHT)} HT · ${prixFr(d.commandes30j.caTTC)} TTC`,
      lien: '/admin/commandes',
      easybeer: easybeerLien.commandes(),
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
      easybeer: easybeerLien.grilleTarifaire(),
      action: 'Gérer le catalogue',
    },
  ]
})
</script>

<template>
  <div class="grid gap-4">
    <div class="grid gap-3 sm:flex sm:items-start sm:justify-between">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <LayoutDashboard class="size-5 text-muted-foreground" />
          Tableau de bord
        </h1>
      </div>
      <div class="grid justify-items-start gap-2 sm:justify-items-end">
        <div class="flex items-center gap-2">
          <p v-if="data?.dernierSync" class="text-xs whitespace-nowrap text-muted-foreground">
            À jour : {{ dateHeureFr(data.dernierSync) }}
          </p>
          <p v-else class="text-xs whitespace-nowrap text-muted-foreground">
            Aucune synchronisation
          </p>
        </div>
        <BoutonActualiser
          label="Tout synchroniser"
          label-pending="Synchronisation…"
          :pending="synchro.isPending.value"
          @click="synchro.mutate()"
        />
      </div>
    </div>

    <div v-if="isPending" class="grid gap-4 sm:grid-cols-3">
      <Skeleton v-for="i in 3" :key="i" class="h-36 w-full" />
    </div>

    <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

    <template v-else>
      <Card v-if="syncAncienne" class="border-amber-300 bg-amber-50/60">
        <CardHeader class="pb-2">
          <CardTitle class="text-base text-amber-900">Synchronisation à vérifier</CardTitle>
          <CardDescription class="text-amber-800">
            La synchronisation Easybeer prévue pendant la nuit ne semble pas récente.
            Lancez une synchronisation avant l'ouverture des commandes.
          </CardDescription>
        </CardHeader>
        <CardContent v-if="diagnosticSync" class="pt-0">
          <p class="text-sm text-amber-900">{{ diagnosticSync }}</p>
        </CardContent>
      </Card>

      <div class="grid gap-4 sm:grid-cols-3">
        <Card v-for="s in stats" :key="s.titre" class="relative">
          <EasybeerLink
            :href="s.easybeer"
            :label="`${s.titre} dans Easybeer`"
            class="absolute top-3 right-3 text-muted-foreground"
          />
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
    </template>
  </div>
</template>
