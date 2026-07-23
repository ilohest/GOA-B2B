<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LayoutDashboard } from '@lucide/vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { AdminDashboardResponse, SyncReport, SyncStatusResponse } from '@/lib/types'
import { dateHeureFr, prixFr } from '@/lib/format'
import { easybeerLien } from '@/lib/easybeer'
import BoutonActualiser from '@/components/admin/BoutonActualiser.vue'
import EasybeerLink from '@/components/admin/EasybeerLink.vue'
import EtatBadge from '@/components/EtatBadge.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const queryClient = useQueryClient()
const SYNC_ATTENTION_MS = 30 * 60 * 60 * 1000
const TOAST_SYNC_ID = 'admin-sync'

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'dashboard'],
  queryFn: () => api.get<AdminDashboardResponse>('/admin/dashboard'),
})

const statutSync = useQuery({
  queryKey: ['admin', 'sync-status'],
  queryFn: () => api.get<SyncStatusResponse>('/admin/sync/status'),
  refetchInterval: 10_000,
})

type SyncStartResponse = { demarree: true } | { enCours: true } | { ok: boolean; report: SyncReport }

const syncEnCours = computed(() => statutSync.data.value?.verrou?.actif === true)
const syncGlobaleEnCours = computed(
  () => statutSync.data.value?.verrou?.actif === true && statutSync.data.value.verrou.kind === 'sync',
)
const declenchementManuel = ref(false)
let rapportAvantSyncAt: number | null = null
let dernierRapportNotifieAt: number | null = null

function notifierRapportSync(report: SyncReport) {
  if (dernierRapportNotifieAt === report.syncedAt) return
  dernierRapportNotifieAt = report.syncedAt

  const duree = Math.round(report.dureeMs / 1000)
  if (report.reussi) {
    toast.success('Synchronisation réussie.', {
      id: TOAST_SYNC_ID,
      description: `${report.produits} produit(s), ${report.listeClients} client(s) et ${report.commandesRecentes} commande(s) actualisés (${duree} s).`,
    })
    return
  }

  const nbErreurs = (report.erreurs?.length ?? 0) + report.clients.filter((client) => client.erreur).length
  toast.warning('Synchronisation partielle.', {
    id: TOAST_SYNC_ID,
    description: nbErreurs > 0
      ? `${nbErreurs} erreur(s) rencontrée(s) — le dernier cache valide est conservé (${duree} s).`
      : `Certaines données n’ont pas pu être actualisées — le dernier cache valide est conservé (${duree} s).`,
  })
}

watch(syncGlobaleEnCours, async (enCours, etaitEnCours) => {
  if (enCours && !etaitEnCours) {
    rapportAvantSyncAt = statutSync.data.value?.dernierSync?.syncedAt ?? null
    toast.loading('Synchronisation Easybeer en cours…', { id: TOAST_SYNC_ID })
    return
  }
  if (!etaitEnCours || enCours) return

  queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
  const statutActualise = await statutSync.refetch()
  const report = statutActualise.data?.dernierSync
  if (report && report.syncedAt !== rapportAvantSyncAt) {
    notifierRapportSync(report)
  } else if (!declenchementManuel.value) {
    toast.error('Synchronisation interrompue.', {
      id: TOAST_SYNC_ID,
      description: 'Aucun nouveau rapport de synchronisation n’a été enregistré.',
    })
  }
})

const syncAncienne = computed(() => {
  const cachePlusAncienAt = data.value?.cache.plusAncienAt
  return !cachePlusAncienAt || Date.now() - cachePlusAncienAt > SYNC_ATTENTION_MS
})

const derniereTentativePartielle = computed(() => {
  const rapport = data.value?.dernierRapportSync
  const cachePlusAncienAt = data.value?.cache.plusAncienAt
  return rapport && !rapport.reussi && (!cachePlusAncienAt || rapport.syncedAt >= cachePlusAncienAt) ? rapport : null
})

const synchro = useMutation({
  mutationFn: () => api.post<SyncStartResponse>('/admin/sync'),
  onMutate: () => {
    declenchementManuel.value = true
    toast.loading('Synchronisation Easybeer en cours…', { id: TOAST_SYNC_ID })
  },
  onSuccess: (resultat) => {
    declenchementManuel.value = false
    if ('demarree' in resultat) {
      toast.loading('Synchronisation Easybeer en cours…', { id: TOAST_SYNC_ID })
      statutSync.refetch()
      return
    }
    if ('enCours' in resultat) {
      toast.info('Une synchronisation est déjà en cours.', {
        id: TOAST_SYNC_ID,
        description: 'Les données seront actualisées dès qu’elle sera terminée.',
      })
      queryClient.invalidateQueries({ queryKey: ['admin', 'sync-status'] })
      return
    }
    notifierRapportSync(resultat.report)
    queryClient.invalidateQueries()
  },
  onError: (e) => {
    declenchementManuel.value = false
    toast.error('Synchronisation impossible.', {
      id: TOAST_SYNC_ID,
      description: (e as Error).message,
    })
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
  if (s.verrou?.actif) {
    return 'Une synchronisation est actuellement en cours.'
  }
  if (s.verrou) {
    return `Verrou de synchronisation ancien (${s.verrou.ageMinutes} min).`
  }
  const rapport = s.dernierSync
  if (rapport && !rapport.reussi) {
    const premiereErreur = rapport.erreurs?.[0] ?? rapport.clients.find((client) => client.erreur)?.erreur
    return premiereErreur
      ? `Dernière tentative partielle : ${premiereErreur}`
      : 'La dernière tentative de synchronisation était partielle.'
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
      statuts: d.commandes30j.statuts,
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
          <Skeleton v-if="isPending" class="h-3 w-40" />
          <p
            v-else-if="derniereTentativePartielle"
            class="text-xs text-amber-700 sm:whitespace-nowrap"
          >
            Dernière tentative : {{ dateHeureFr(derniereTentativePartielle.syncedAt) }} · partielle
          </p>
          <p v-else-if="data?.cache.plusAncienAt" class="text-xs whitespace-nowrap text-muted-foreground">
            Cache le plus ancien : {{ dateHeureFr(data.cache.plusAncienAt) }}
          </p>
          <p v-else class="text-xs whitespace-nowrap text-muted-foreground">
            Aucune synchronisation
          </p>
        </div>
        <BoutonActualiser
          label="Tout synchroniser"
          label-pending="Synchronisation…"
          :pending="synchro.isPending.value || syncEnCours"
          @click="synchro.mutate()"
        />
      </div>
    </div>

    <div
      v-if="isPending"
      class="grid gap-4 sm:grid-cols-3"
      aria-label="Chargement du tableau de bord"
      aria-busy="true"
    >
      <Card v-for="i in 3" :key="i" class="relative">
        <Skeleton class="absolute top-3 right-3 size-8 rounded-full" />
        <CardHeader class="gap-2 pb-2">
          <Skeleton class="h-3.5 w-28" />
          <Skeleton class="h-9 w-20" />
        </CardHeader>
        <CardContent class="grid gap-3">
          <Skeleton class="h-4 w-4/5" />
          <Skeleton class="h-8 w-32 rounded-md" />
        </CardContent>
      </Card>
    </div>

    <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

    <template v-else>
      <Card v-if="syncAncienne" class="border-amber-300 bg-amber-50/60">
        <CardHeader class="pb-2">
          <CardTitle class="text-base text-amber-900">Synchronisation à vérifier</CardTitle>
          <CardDescription class="text-amber-800">
            Certaines données Easybeer en cache n'ont pas été vérifiées récemment.
            Chaque section se rafraîchit automatiquement à son ouverture ; vous pouvez aussi tout synchroniser maintenant.
          </CardDescription>
        </CardHeader>
        <CardContent v-if="diagnosticSync" class="pt-0">
          <p class="text-sm text-amber-900">{{ diagnosticSync }}</p>
        </CardContent>
      </Card>

      <div class="grid gap-4 sm:grid-cols-3">
        <Card v-for="s in stats" :key="s.titre" class="relative flex h-full flex-col">
          <EasybeerLink
            :href="s.easybeer"
            :label="`${s.titre} dans Easybeer`"
            class="absolute top-3 right-3 text-muted-foreground"
          />
          <CardHeader class="pb-2">
            <CardDescription>{{ s.titre }}</CardDescription>
            <CardTitle class="text-3xl tracking-tight">{{ s.valeur }}</CardTitle>
          </CardHeader>
          <CardContent class="flex flex-1 flex-col gap-3">
            <p class="text-sm text-muted-foreground">{{ s.detail }}</p>
            <div v-if="s.statuts?.length" class="flex flex-wrap gap-2">
              <div
                v-for="statut in s.statuts"
                :key="statut.etat.code"
              >
                <EtatBadge :etat="statut.etat" :nombre="statut.nombre" />
              </div>
            </div>
            <Button variant="outline" size="sm" class="mt-auto self-start" as-child>
              <RouterLink :to="s.lien">{{ s.action }}</RouterLink>
            </Button>
          </CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>
