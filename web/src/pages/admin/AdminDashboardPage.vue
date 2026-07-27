<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LayoutDashboard } from '@lucide/vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { AdminDashboardResponse, SyncReport } from '@/lib/types'
import { dateHeureFr, prixFr } from '@/lib/format'
import { easybeerLien } from '@/lib/easybeer'
import { useSyncEnCours } from '@/composables/useSyncEnCours'
import BoutonActualiser from '@/components/admin/BoutonActualiser.vue'
import EasybeerLink from '@/components/admin/EasybeerLink.vue'
import EtatBadge from '@/components/EtatBadge.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const queryClient = useQueryClient()
const SYNC_ATTENTION_MS = 30 * 60 * 60 * 1000
const TOAST_SYNC_ID = 'admin-sync'

function accord(nombre: number, singulier: string, pluriel: string) {
  return nombre === 1 ? singulier : pluriel
}

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'dashboard'],
  queryFn: () => api.get<AdminDashboardResponse>('/admin/dashboard'),
  refetchInterval: (query) => query.state.data?.revalidationEnCours ? 10_000 : false,
})

const { statutSync, syncEnCours } = useSyncEnCours()

type SyncStartResponse = { demarree: true } | { enCours: true } | { ok: boolean; report: SyncReport }

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
      description: `${report.produits} ${accord(report.produits, 'produit', 'produits')}, ${report.listeClients} ${accord(report.listeClients, 'client', 'clients')} et ${report.commandesRecentes} ${accord(report.commandesRecentes, 'commande', 'commandes')} actualisés (${duree} s).`,
    })
    return
  }

  const nbErreurs = (report.erreurs?.length ?? 0) + report.clients.filter((client) => client.erreur).length
  toast.warning('Synchronisation partielle.', {
    id: TOAST_SYNC_ID,
    description: nbErreurs > 0
      ? `${nbErreurs} ${accord(nbErreurs, 'erreur rencontrée', 'erreurs rencontrées')} — le dernier cache valide est conservé (${duree} s).`
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

type CarteStatistique = {
  titre: string
  valeur: string
  libelle: string
  indicateurs: Array<{
    valeur: string
    libelle: string
    principal?: boolean
    complement?: string
    lien?: string | { name: string; query: Record<string, string> }
  }>
  statuts?: AdminDashboardResponse['commandes30j']['statuts']
  lien: string
  lienPrincipal?: string | { name: string; query: Record<string, string> }
  easybeer: string
  action: string
}

const stats = computed<CarteStatistique[]>(() => {
  const d = data.value
  if (!d) return []
  return [
    {
      titre: 'Clients',
      valeur: String(d.clients.total),
      libelle: accord(d.clients.total, 'client synchronisé', 'clients synchronisés'),
      indicateurs: [
        {
          valeur: String(d.clients.actifs),
          libelle: accord(d.clients.actifs, 'client actif', 'clients actifs'),
          lien: { name: 'admin-clients', query: { compte: 'actif' } },
        },
        {
          valeur: String(Math.max(0, d.clients.total - d.clients.actifs)),
          libelle: accord(
            Math.max(0, d.clients.total - d.clients.actifs),
            'client inactif',
            'clients inactifs',
          ),
          lien: { name: 'admin-clients', query: { compte: 'inactif' } },
        },
      ],
      lien: '/admin/clients',
      easybeer: easybeerLien.clients(),
      action: 'Gérer les clients',
    },
    {
      titre: 'Commandes (30 j)',
      valeur: String(d.commandes30j.nombre),
      libelle: accord(d.commandes30j.nombre, 'commande enregistrée', 'commandes enregistrées'),
      indicateurs: [
        {
          valeur: prixFr(d.commandes30j.caHT),
          libelle: 'Chiffre d’affaires HT',
          principal: true,
          complement: `${prixFr(d.commandes30j.caTTC)} TTC`,
        },
      ],
      statuts: d.commandes30j.statuts,
      lien: '/admin/commandes',
      easybeer: easybeerLien.commandes(),
      action: 'Voir les commandes',
    },
    {
      titre: 'Catalogue',
      valeur: String(d.catalogue.visibles),
      libelle: accord(d.catalogue.visibles, 'produit visible', 'produits visibles'),
      indicateurs: [
        {
          valeur: String(d.catalogue.produits),
          libelle: accord(d.catalogue.produits, 'produit référencé', 'produits référencés'),
        },
        {
          valeur: String(d.catalogue.ruptures),
          libelle: accord(d.catalogue.ruptures, 'produit en rupture', 'produits en rupture'),
          lien: { name: 'admin-catalogue', query: { rupture: '1' } },
        },
      ],
      lien: '/admin/catalogue',
      lienPrincipal: { name: 'admin-catalogue', query: { visible: '1' } },
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
            v-if="data?.revalidationEnCours || syncEnCours"
            class="text-xs whitespace-nowrap text-primary"
          >
            Mise à jour automatique en cours…
          </p>
          <p
            v-else-if="derniereTentativePartielle"
            class="text-xs text-amber-700 sm:whitespace-nowrap"
          >
            Dernière tentative : {{ dateHeureFr(derniereTentativePartielle.syncedAt) }} · partielle
          </p>
          <p v-else-if="data?.cache.plusAncienAt" class="text-xs whitespace-nowrap text-muted-foreground">
            Dernière mise à jour : {{ dateHeureFr(data.cache.plusAncienAt) }}
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
          <div class="flex items-end gap-2">
            <Skeleton class="h-9 w-20" />
            <Skeleton class="mb-1 h-3 w-32" />
          </div>
        </CardHeader>
        <CardContent class="grid gap-3">
          <div class="grid grid-cols-2 gap-2">
            <Skeleton v-for="j in 2" :key="j" class="h-16 rounded-lg" />
          </div>
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
            <RouterLink
              :to="s.lienPrincipal ?? s.lien"
              class="-m-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md p-1 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <CardTitle class="text-3xl tracking-tight">{{ s.valeur }}</CardTitle>
              <p class="text-sm font-medium text-muted-foreground">{{ s.libelle }}</p>
            </RouterLink>
          </CardHeader>
          <CardContent class="flex flex-1 flex-col gap-3">
            <div class="grid grid-cols-2 gap-2">
              <RouterLink
                v-for="indicateur in s.indicateurs"
                :key="indicateur.libelle"
                :to="indicateur.lien ?? s.lien"
                class="rounded-lg bg-muted/45 px-3 py-2.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                :class="indicateur.principal ? 'col-span-2' : ''"
                :aria-label="`${indicateur.libelle} : ${indicateur.valeur}. Ouvrir la liste.`"
              >
                <p class="text-[11px] font-medium text-muted-foreground">
                  {{ indicateur.libelle }}
                </p>
                <p
                  class="mt-1 tabular-nums"
                  :class="indicateur.principal ? 'text-xl font-semibold tracking-tight text-foreground' : 'text-base font-semibold text-foreground'"
                >
                  {{ indicateur.valeur }}
                </p>
                <p
                  v-if="indicateur.complement"
                  class="mt-0.5 text-xs tabular-nums text-muted-foreground/70"
                >
                  {{ indicateur.complement }}
                </p>
              </RouterLink>
            </div>
            <div v-if="s.statuts?.length" class="flex flex-wrap gap-2">
              <RouterLink
                v-for="statut in s.statuts"
                :key="statut.etat.code"
                :to="{ name: 'admin-commandes', query: { statut: String(statut.etat.code) } }"
                class="rounded-full outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                :aria-label="`${statut.etat.libelle} : ${statut.nombre} commandes. Filtrer la liste.`"
              >
                <EtatBadge :etat="statut.etat" :nombre="statut.nombre" />
              </RouterLink>
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
