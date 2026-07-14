<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import { EyeOff, Package, PackageX, Search } from '@lucide/vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CatalogueAdminResponse, CatalogueAdminUnite, CatalogueOverride } from '@/lib/types'
import { dateHeureFr, prixFr } from '@/lib/format'
import { easybeerLien } from '@/lib/easybeer'
import { useHeaderSaveBar } from '@/composables/useHeaderSaveBar'
import { signalerBanEasybeer } from '@/composables/useEasybeerBan'
import PhotoUpload from '@/components/admin/PhotoUpload.vue'
import BoutonActualiser from '@/components/admin/BoutonActualiser.vue'
import EasybeerLink from '@/components/admin/EasybeerLink.vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

const queryClient = useQueryClient()
const { setSaveBar, clearSaveBar } = useHeaderSaveBar()

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'catalogue'],
  queryFn: () => api.get<CatalogueAdminResponse>('/admin/catalogue'),
})

// Actualisation SCOPÉE : ne resynchronise que le catalogue (produits + grille),
// pas les prix par client — pour ça, c'est la synchro complète du dashboard.
const actualisation = useMutation({
  mutationFn: () => api.get<CatalogueAdminResponse>('/admin/catalogue?refresh=1'),
  onSuccess: (res) => {
    queryClient.setQueryData(['admin', 'catalogue'], res)
    queryClient.invalidateQueries({ queryKey: ['catalogue'] })
    if (res.indisponible && res.retryAfterSeconds) {
      signalerBanEasybeer(res.retryAfterSeconds)
      toast.warning('Easybeer momentanément saturé — catalogue inchangé, réessayez dans un instant.')
    } else {
      toast.success('Catalogue resynchronisé depuis Easybeer.')
    }
  },
  onError: (e) => toast.error((e as Error).message),
})

const recherche = ref('')
type BrouillonCatalogue = Partial<Pick<CatalogueOverride, 'displayName' | 'visible' | 'rupture' | 'photoUrl'>>
const brouillons = ref<Record<number, BrouillonCatalogue>>({})

function overrideAffiche(u: CatalogueAdminUnite): CatalogueOverride {
  return { ...u.override, ...(brouillons.value[u.idStockBouteille] ?? {}) }
}

const unitesFiltrees = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  const unites = data.value?.unites ?? []
  if (!q) return unites
  return unites.filter((u) =>
    [u.produit, u.contenant, u.packaging, overrideAffiche(u).displayName, u.libelleEasybeer]
      .some((v) => v?.toLowerCase().includes(q)),
  )
})

const nbModifs = computed(() => Object.keys(brouillons.value).length)
const aDesModifs = computed(() => nbModifs.value > 0)

/** Applique un override renvoyé par le serveur au cache local + invalide le catalogue client. */
function appliquerOverride(idStockBouteille: number, override: CatalogueOverride) {
  queryClient.setQueryData<CatalogueAdminResponse>(['admin', 'catalogue'], (prev) =>
    prev
      ? {
          ...prev,
          unites: prev.unites.map((u) =>
            u.idStockBouteille === idStockBouteille ? { ...u, override } : u,
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

function definirBrouillon<K extends keyof BrouillonCatalogue>(
  u: CatalogueAdminUnite,
  champ: K,
  valeur: NonNullable<BrouillonCatalogue[K]>,
) {
  const id = u.idStockBouteille
  const normalisee = champ === 'displayName' ? String(valeur) : valeur
  const originale = u.override[champ]
  const prochaine = { ...(brouillons.value[id] ?? {}) }

  if (champ === 'displayName' ? String(normalisee).trim() === String(originale) : normalisee === originale) {
    delete prochaine[champ]
  } else {
    prochaine[champ] = normalisee as BrouillonCatalogue[K]
  }

  if (Object.keys(prochaine).length) brouillons.value = { ...brouillons.value, [id]: prochaine }
  else {
    const { [id]: _retire, ...reste } = brouillons.value
    brouillons.value = reste
  }
}

async function enregistrerModifs() {
  const entrees = Object.entries(brouillons.value)
  if (!entrees.length) return
  try {
    for (const [id, patch] of entrees) {
      await maj.mutateAsync({ idStockBouteille: Number(id), patch })
    }
    brouillons.value = {}
    toast.success('Modifications du catalogue enregistrées.')
  } catch {
    // Le toast d'erreur est déjà déclenché par la mutation.
  }
}

function annulerModifs() {
  brouillons.value = {}
}

watchEffect(() => {
  if (!aDesModifs.value) {
    clearSaveBar()
    return
  }

  setSaveBar({
    label: `${nbModifs.value} modification${nbModifs.value > 1 ? 's' : ''} non enregistrée${nbModifs.value > 1 ? 's' : ''}`,
    pending: maj.isPending.value,
    onDiscard: annulerModifs,
    onSave: enregistrerModifs,
  })
})

onBeforeUnmount(clearSaveBar)

// --- Photos (upload Storage via le serveur) ---

async function envoyerPhoto(idStockBouteille: number, fichier: File) {
  const res = await api.envoyerFichier<{ ok: boolean; photoUrl: string }>(
    `/admin/catalogue/${idStockBouteille}/photo`,
    'photo',
    fichier,
  )
  const unite = data.value?.unites.find((u) => u.idStockBouteille === idStockBouteille)
  if (unite) definirBrouillon(unite, 'photoUrl', res.photoUrl)
}

async function retirerPhoto(idStockBouteille: number) {
  const unite = data.value?.unites.find((u) => u.idStockBouteille === idStockBouteille)
  if (unite) definirBrouillon(unite, 'photoUrl', '')
}
</script>

<template>
  <div class="grid gap-4">
    <Card>
      <CardHeader class="gap-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <CardTitle class="flex items-center gap-2 text-lg">
            <Package class="size-5 text-muted-foreground" />
            Catalogue
          </CardTitle>
          <div class="flex items-center gap-2">
            <p v-if="data?.syncedAt" class="text-xs whitespace-nowrap text-muted-foreground">
              À jour : {{ dateHeureFr(data.syncedAt) }}
            </p>
            <EasybeerLink
              :href="easybeerLien.grilleTarifaire()"
              label="Ouvrir la grille tarifaire dans Easybeer"
              class="text-muted-foreground"
            />
            <BoutonActualiser
              label="Actualiser le catalogue"
              :pending="actualisation.isPending.value"
              @click="actualisation.mutate()"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent class="grid gap-4">
        <div class="relative max-w-sm">
          <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="recherche" placeholder="Rechercher (produit, contenant, packaging)…" class="pl-9" />
        </div>

        <div v-if="isPending" class="grid gap-2">
          <Skeleton v-for="i in 6" :key="i" class="h-24 w-full" />
        </div>
        <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>
        <p v-else-if="!data?.unites.length" class="py-8 text-center text-sm text-muted-foreground">
          Aucune unité tarifée. Lancez une synchronisation pour charger la grille tarifaire.
        </p>

        <ul v-else class="divide-y">
          <li
            v-for="u in unitesFiltrees"
            :key="u.idStockBouteille"
            class="grid gap-3 py-4 sm:grid-cols-[auto_1fr_auto_auto] sm:items-center"
          >
            <PhotoUpload
              :photo-url="overrideAffiche(u).photoUrl"
              :libelle="u.override.displayName || u.produit"
              :envoyer="(f) => envoyerPhoto(u.idStockBouteille, f)"
              :retirer="() => retirerPhoto(u.idStockBouteille)"
            />

            <div class="grid gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-medium">{{ u.produit }}</p>
                <Badge variant="outline">{{ u.contenant }}</Badge>
                <Badge variant="outline">{{ u.packaging }}</Badge>
                <Badge v-if="overrideAffiche(u).rupture" variant="destructive">
                  <PackageX class="size-3" />
                  Rupture
                </Badge>
                <Badge v-if="!overrideAffiche(u).visible" variant="secondary" class="border border-border bg-muted text-foreground">
                  <EyeOff class="size-3" />
                  Masqué
                </Badge>
              </div>
              <Input
                :model-value="overrideAffiche(u).displayName"
                :placeholder="`Nom d'affichage (sinon : ${u.produit} — ${u.packaging})`"
                class="max-w-md"
                @update:model-value="(v) => definirBrouillon(u, 'displayName', String(v))"
                @keydown.enter="($event.target as HTMLInputElement).blur()"
              />
            </div>

            <div class="text-sm sm:min-w-44">
              <div
                v-for="t in u.tarifs"
                :key="t.idClientType"
                class="flex items-baseline justify-between gap-3"
              >
                <span class="text-muted-foreground">{{ t.typeClient }}</span>
                <span class="font-semibold tabular-nums">{{ prixFr(t.prixHT) }} HT</span>
              </div>
              <p v-if="!u.tarifs.length" class="text-xs text-muted-foreground">Aucun tarif</p>
            </div>

            <div class="flex items-center gap-6">
              <label class="flex items-center gap-2 text-sm">
                <Switch
                  :model-value="overrideAffiche(u).visible"
                  @update:model-value="(v: boolean) => definirBrouillon(u, 'visible', v)"
                />
                Visible
              </label>
              <label class="flex items-center gap-2 text-sm">
                <Switch
                  :model-value="overrideAffiche(u).rupture"
                  @update:model-value="(v: boolean) => definirBrouillon(u, 'rupture', v)"
                />
                Rupture
              </label>
            </div>
          </li>
          <li v-if="!unitesFiltrees.length" class="py-8 text-center text-sm text-muted-foreground">
            Aucun produit trouvé.
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</template>
