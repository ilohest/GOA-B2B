<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CatalogueAdminResponse, CatalogueOverride } from '@/lib/types'
import AdminNav from '@/components/AdminNav.vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

const queryClient = useQueryClient()

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'catalogue'],
  queryFn: () => api.get<CatalogueAdminResponse>('/admin/catalogue'),
})

const maj = useMutation({
  mutationFn: (input: { idStockBouteille: number; patch: Partial<CatalogueOverride> }) =>
    api.put<{ ok: boolean; override: CatalogueOverride }>(
      `/admin/catalogue/${input.idStockBouteille}`,
      input.patch,
    ),
  onSuccess: (res, input) => {
    // Mise à jour locale du cache : pas de re-fetch complet à chaque toggle.
    queryClient.setQueryData<CatalogueAdminResponse>(['admin', 'catalogue'], (prev) =>
      prev
        ? {
            ...prev,
            produits: prev.produits.map((p) =>
              p.produit.idStockBouteille === input.idStockBouteille
                ? { ...p, override: res.override }
                : p,
            ),
          }
        : prev,
    )
    queryClient.invalidateQueries({ queryKey: ['catalogue'] })
  },
  onError: (e) => {
    toast.error((e as Error).message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'catalogue'] })
  },
})

function patcher(idStockBouteille: number, patch: Partial<CatalogueOverride>) {
  maj.mutate({ idStockBouteille, patch })
}

function renommer(idStockBouteille: number, event: Event) {
  const displayName = (event.target as HTMLInputElement).value
  const actuel = data.value?.produits.find((p) => p.produit.idStockBouteille === idStockBouteille)
  if (actuel && actuel.override.displayName !== displayName.trim()) {
    patcher(idStockBouteille, { displayName })
  }
}
</script>

<template>
  <div class="grid gap-4">
    <AdminNav />

    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Catalogue</CardTitle>
        <CardDescription>
          Tous les produits Easybeer. Seuls les produits <strong>visibles</strong> apparaissent
          côté client (masqué par défaut). Le nom d'affichage remplace le libellé technique.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="isPending" class="grid gap-2">
          <Skeleton v-for="i in 6" :key="i" class="h-14 w-full" />
        </div>
        <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

        <ul v-else class="divide-y">
          <li
            v-for="{ produit, override } in data?.produits"
            :key="produit.idStockBouteille"
            class="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div class="grid gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-medium">{{ produit.libelle }}</p>
                <Badge v-if="override.rupture" variant="destructive">Rupture</Badge>
                <Badge v-if="!override.visible" variant="outline">Masqué</Badge>
              </div>
              <Input
                :model-value="override.displayName"
                :placeholder="`Nom d'affichage (sinon : ${produit.libelle})`"
                class="max-w-md"
                @blur="renommer(produit.idStockBouteille, $event)"
                @keydown.enter="($event.target as HTMLInputElement).blur()"
              />
            </div>

            <div class="flex items-center gap-6">
              <label class="flex items-center gap-2 text-sm">
                <Switch
                  :model-value="override.visible"
                  @update:model-value="(v: boolean) => patcher(produit.idStockBouteille, { visible: v })"
                />
                Visible
              </label>
              <label class="flex items-center gap-2 text-sm">
                <Switch
                  :model-value="override.rupture"
                  @update:model-value="(v: boolean) => patcher(produit.idStockBouteille, { rupture: v })"
                />
                Rupture
              </label>
            </div>
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</template>
