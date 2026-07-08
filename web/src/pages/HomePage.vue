<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { api } from '@/lib/api'
import type { CatalogueClientResponse } from '@/lib/types'
import { useMe } from '@/composables/useMe'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const { data, isPending, isError, error } = useMe()

const catalogue = useQuery({
  queryKey: ['catalogue'],
  queryFn: () => api.get<CatalogueClientResponse>('/catalogue'),
})

const prixFr = (v: number) =>
  v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
</script>

<template>
  <div class="mx-auto grid w-full max-w-xl gap-4">
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Mon compte</CardTitle>
        <CardDescription>Informations lues depuis Easybeer</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="isPending" class="grid gap-2">
          <Skeleton class="h-5 w-2/3" />
          <Skeleton class="h-4 w-1/2" />
          <Skeleton class="h-4 w-1/3" />
        </div>
        <p v-else-if="isError" class="text-sm text-destructive">
          Impossible de charger votre compte : {{ (error as Error)?.message }}
        </p>
        <dl v-else-if="data?.client" class="grid gap-2 text-sm">
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">Commerce</dt>
            <dd class="text-right font-medium">{{ data.client.nom ?? data.client.raisonSociale }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">N° client</dt>
            <dd class="text-right">{{ data.client.numero }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">Catégorie</dt>
            <dd class="text-right">{{ data.client.type?.libelle ?? '—' }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">Compte</dt>
            <dd class="text-right">{{ data.user.email }}</dd>
          </div>
        </dl>
        <p v-else class="text-sm text-muted-foreground">
          Votre compte n'est pas encore relié à une fiche client — contactez GOA.
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Nos kombuchas</CardTitle>
        <CardDescription>Prix HT, selon vos conditions tarifaires.</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="catalogue.isPending.value" class="grid gap-3 sm:grid-cols-2">
          <Skeleton v-for="i in 4" :key="i" class="h-28 w-full" />
        </div>

        <p v-else-if="catalogue.isError.value" class="text-sm text-destructive">
          Impossible de charger le catalogue : {{ (catalogue.error.value as Error)?.message }}
        </p>

        <p
          v-else-if="!catalogue.data.value?.produits.length"
          class="text-sm text-muted-foreground"
        >
          Le catalogue n'est pas encore disponible — revenez bientôt.
        </p>

        <ul v-else class="grid gap-3 sm:grid-cols-2">
          <li
            v-for="p in catalogue.data.value.produits"
            :key="p.idStockBouteille"
            class="flex flex-col justify-between gap-2 rounded-xl border p-4"
            :class="p.rupture ? 'opacity-60' : ''"
          >
            <div class="flex items-start justify-between gap-2">
              <p class="font-medium">{{ p.libelle }}</p>
              <Badge v-if="p.rupture" variant="destructive" class="shrink-0">Rupture</Badge>
            </div>
            <p class="text-sm text-muted-foreground">
              <template v-if="p.prixHT != null">
                <span class="text-base font-semibold text-foreground">{{ prixFr(p.prixHT) }}</span>
                HT
              </template>
              <template v-else>Prix sur demande</template>
            </p>
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</template>
