<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { api } from '@/lib/api'
import type { AdminClientDetail } from '@/lib/types'
import { dateFr, prixFr } from '@/lib/format'
import EtatBadge from '@/components/EtatBadge.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const route = useRoute()
const idClient = computed(() => Number(route.params.id))

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'client', idClient],
  queryFn: () => api.get<AdminClientDetail>(`/admin/clients/${idClient.value}`),
})

const client = computed(() => data.value?.client)

const tags = computed(() => {
  const t = client.value?.tags
  if (t == null) return []
  return Array.isArray(t) ? t : String(t).split(',').map((s) => s.trim()).filter(Boolean)
})

/** Paires libellé/valeur affichées telles quelles (— si absent). */
const infos = computed(() => [
  { label: 'Email', valeur: client.value?.emailPrincipal },
  { label: 'Téléphone', valeur: client.value?.telephonePrincipal },
  { label: 'Adresse de facturation', valeur: client.value?.adresseFacturation },
  { label: 'Adresse de livraison', valeur: client.value?.adresseLivraison },
  { label: 'Catégorie', valeur: client.value?.categorie },
  { label: 'Mode de livraison', valeur: client.value?.typeLivraisonFav },
  { label: 'Tournée', valeur: client.value?.tournee },
])

const conditions = computed(() => [
  {
    label: 'Minimum de commande',
    valeur: client.value?.minimumCommande != null ? `${prixFr(client.value.minimumCommande)} HT` : null,
  },
  {
    label: 'Frais de livraison',
    valeur: client.value?.fraisLivraisonHT != null ? `${prixFr(client.value.fraisLivraisonHT)} HT` : null,
  },
  { label: 'Remise spéciale', valeur: client.value?.remise },
  {
    label: 'Remise 2',
    valeur: client.value?.remise2
      ? `${client.value.remise2}${client.value.typeRemise2 ? ` (${client.value.typeRemise2.toLowerCase()})` : ''}`
      : null,
  },
  {
    label: 'Remises ciblées (produit/lot)',
    valeur: client.value?.nbRemisesCiblees ? String(client.value.nbRemisesCiblees) : null,
  },
])
</script>

<template>
  <div class="grid gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <RouterLink to="/admin" class="text-sm text-muted-foreground hover:underline">
          ← Clients
        </RouterLink>
        <h1 class="text-xl font-semibold">
          {{ client?.nom ?? client?.raisonSociale ?? '…' }}
          <span class="ml-2 text-sm font-normal text-muted-foreground">{{ client?.numero }}</span>
        </h1>
      </div>
      <Button variant="outline" size="sm" as-child>
        <a :href="data?.easybeerAppUrl" target="_blank" rel="noopener">Ouvrir Easybeer ↗</a>
      </Button>
    </div>

    <div v-if="isPending" class="grid gap-3">
      <Skeleton class="h-40 w-full" />
      <Skeleton class="h-40 w-full" />
    </div>

    <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

    <template v-else-if="client">
      <div class="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle class="text-base">Informations</CardTitle></CardHeader>
          <CardContent>
            <dl class="grid gap-2 text-sm">
              <div v-for="i in infos" :key="i.label" class="grid gap-0.5 sm:grid-cols-[12rem_1fr]">
                <dt class="text-muted-foreground">{{ i.label }}</dt>
                <dd>{{ i.valeur || '—' }}</dd>
              </div>
              <div v-if="tags.length" class="grid gap-0.5 sm:grid-cols-[12rem_1fr]">
                <dt class="text-muted-foreground">Tags</dt>
                <dd class="flex flex-wrap gap-1">
                  <Badge v-for="t in tags" :key="t" variant="secondary">{{ t }}</Badge>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div class="grid gap-4">
          <Card>
            <CardHeader><CardTitle class="text-base">Conditions commerciales</CardTitle></CardHeader>
            <CardContent>
              <dl class="grid gap-2 text-sm">
                <div v-for="c in conditions" :key="c.label" class="grid gap-0.5 sm:grid-cols-[12rem_1fr]">
                  <dt class="text-muted-foreground">{{ c.label }}</dt>
                  <dd>{{ c.valeur || '—' }}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle class="text-base">Comptes plateforme</CardTitle></CardHeader>
            <CardContent>
              <p v-if="!data?.comptes.length" class="text-sm text-muted-foreground">
                Aucun compte — invitez ce client depuis la liste.
              </p>
              <ul v-else class="grid gap-1.5 text-sm">
                <li v-for="c in data.comptes" :key="c.email" class="flex items-center justify-between gap-3">
                  <span>{{ c.email }}</span>
                  <Badge :variant="c.status === 'active' ? 'default' : 'secondary'">
                    {{ c.status === 'active' ? 'Actif' : 'Invité' }}
                  </Badge>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle class="text-base">Commandes ({{ data?.commandes.length ?? 0 }})</CardTitle></CardHeader>
        <CardContent>
          <p v-if="!data?.commandes.length" class="text-sm text-muted-foreground">Aucune commande.</p>
          <ul v-else class="divide-y">
            <li
              v-for="cmd in data.commandes"
              :key="cmd.idCommande"
              class="flex flex-wrap items-center justify-between gap-3 py-2.5"
            >
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium">n° {{ cmd.numero ?? cmd.idCommande }}</p>
                <EtatBadge :etat="cmd.etat" />
              </div>
              <div class="flex items-center gap-4 text-sm">
                <span class="text-muted-foreground">{{ dateFr(cmd.dateCreation) }}</span>
                <span class="font-medium tabular-nums">
                  {{ cmd.totalTTC != null ? `${prixFr(cmd.totalTTC)} TTC` : '—' }}
                </span>
              </div>
            </li>
          </ul>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
