<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CatalogueAdminResponse, CatalogueOverride } from '@/lib/types'
import PhotoUpload from '@/components/admin/PhotoUpload.vue'
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

/** Applique un override renvoyé par le serveur au cache local + invalide le catalogue client. */
function appliquerOverride(idStockBouteille: number, override: CatalogueOverride) {
  queryClient.setQueryData<CatalogueAdminResponse>(['admin', 'catalogue'], (prev) =>
    prev
      ? {
          ...prev,
          produits: prev.produits.map((p) =>
            p.produit.idStockBouteille === idStockBouteille ? { ...p, override } : p,
          ),
        }
      : prev,
  )
  queryClient.invalidateQueries({ queryKey: ['catalogue'] })
}

const maj = useMutation({
  mutationFn: (input: { idStockBouteille: number; patch: Partial<CatalogueOverride> }) =>
    api.put<{ ok: boolean; override: CatalogueOverride }>(
      `/admin/catalogue/${input.idStockBouteille}`,
      input.patch,
    ),
  onSuccess: (res, input) => appliquerOverride(input.idStockBouteille, res.override),
  onError: (e) => {
    toast.error((e as Error).message)
    queryClient.invalidateQueries({ queryKey: ['admin', 'catalogue'] })
  },
})

function patcher(idStockBouteille: number, patch: Partial<CatalogueOverride>) {
  maj.mutate({ idStockBouteille, patch })
}

/** Enregistre le nom d'affichage au blur, seulement s'il a changé. */
function renommer(idStockBouteille: number, event: Event) {
  const valeur = (event.target as HTMLInputElement).value
  const actuel = data.value?.produits.find((p) => p.produit.idStockBouteille === idStockBouteille)
  if (actuel && actuel.override.displayName !== valeur.trim()) {
    patcher(idStockBouteille, { displayName: valeur })
  }
}

// --- Photos (upload Storage via le serveur) ---

async function envoyerPhoto(idStockBouteille: number, fichier: File) {
  const res = await api.envoyerFichier<{ ok: boolean; override: CatalogueOverride }>(
    `/admin/catalogue/${idStockBouteille}/photo`,
    'photo',
    fichier,
  )
  appliquerOverride(idStockBouteille, res.override)
}

async function retirerPhoto(idStockBouteille: number) {
  const res = await api.delete<{ ok: boolean; override: CatalogueOverride }>(
    `/admin/catalogue/${idStockBouteille}/photo`,
  )
  appliquerOverride(idStockBouteille, res.override)
}
</script>

<template>
  <div class="grid gap-4">
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Catalogue</CardTitle>
        <CardDescription>
          Tous les produits Easybeer. Seuls les produits <strong>visibles</strong> apparaissent
          côté client (masqué par défaut). Glissez une image sur la vignette ou cliquez pour
          l'ajouter.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="isPending" class="grid gap-2">
          <Skeleton v-for="i in 6" :key="i" class="h-24 w-full" />
        </div>
        <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

        <ul v-else class="divide-y">
          <li
            v-for="{ produit, override } in data?.produits"
            :key="produit.idStockBouteille"
            class="grid gap-3 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
          >
            <PhotoUpload
              :photo-url="override.photoUrl"
              :libelle="override.displayName || produit.libelle"
              :envoyer="(f) => envoyerPhoto(produit.idStockBouteille, f)"
              :retirer="() => retirerPhoto(produit.idStockBouteille)"
            />

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
