<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Eye, EyeOff, Package, PackageCheck, PackageX, Search } from '@lucide/vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CatalogueAdminResponse, CatalogueAdminUnite, CatalogueOverride } from '@/lib/types'
import { dateHeureFr, prixFr } from '@/lib/format'
import { easybeerLien } from '@/lib/easybeer'
import { useHeaderSaveBar } from '@/composables/useHeaderSaveBar'
import { signalerBanEasybeer } from '@/composables/useEasybeerBan'
import { useSyncEnCours } from '@/composables/useSyncEnCours'
import PhotoUpload from '@/components/admin/PhotoUpload.vue'
import BoutonActualiser from '@/components/admin/BoutonActualiser.vue'
import EasybeerLink from '@/components/admin/EasybeerLink.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'

const queryClient = useQueryClient()
const { setSaveBar, clearSaveBar } = useHeaderSaveBar()

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'catalogue'],
  queryFn: () => api.get<CatalogueAdminResponse>('/admin/catalogue'),
})

const { syncEnCours } = useSyncEnCours()

// Actualisation SCOPÉE : ne resynchronise que le catalogue (produits + grille),
// pas les prix par client — pour ça, c'est la synchro complète du dashboard.
const actualisation = useMutation({
  mutationFn: () => api.get<CatalogueAdminResponse>('/admin/catalogue?refresh=1'),
  onSuccess: (res) => {
    queryClient.setQueryData(['admin', 'catalogue'], res)
    queryClient.invalidateQueries({ queryKey: ['catalogue'] })
    if (res.enCours) {
      toast.info('Une synchronisation est déjà en cours — le catalogue actuel reste affiché.')
    } else if (res.indisponible && res.retryAfterSeconds) {
      signalerBanEasybeer(res.retryAfterSeconds)
      toast.warning('Easybeer momentanément saturé — catalogue inchangé, réessayez dans un instant.')
    } else {
      toast.success('Catalogue actualisé.', {
        description: 'Les données catalogue ont été mises à jour.',
      })
    }
  },
  onError: (e) => toast.error((e as Error).message),
})

const recherche = ref('')
/** Filtre d'état partagé par les indicateurs de visibilité et de rupture. */
const filtreEtat = ref<'tous' | 'visibles' | 'rupture'>('tous')
type BrouillonCatalogue = Partial<Pick<CatalogueOverride, 'displayName' | 'visible' | 'rupture' | 'photoUrl'>>
const brouillons = ref<Record<number, BrouillonCatalogue>>({})

function overrideAffiche(u: CatalogueAdminUnite): CatalogueOverride {
  return { ...u.override, ...(brouillons.value[u.idStockBouteille] ?? {}) }
}

/**
 * Filtres de contexte au-dessus du tableau. `tous` = pas de filtre.
 * Les options sont les valeurs réellement présentes au catalogue.
 */
const filtresColonne = ref<Record<string, string>>({ contenant: 'tous', packaging: 'tous' })

function valeursDistinctes(champ: 'contenant' | 'packaging') {
  const valeurs = (data.value?.unites ?? []).map((u) => u[champ]).filter((v): v is string => Boolean(v))
  return [...new Set(valeurs)].sort((a, b) => a.localeCompare(b, 'fr'))
}
const optionsColonne = computed<Record<string, string[]>>(() => ({
  contenant: valeursDistinctes('contenant'),
  packaging: valeursDistinctes('packaging'),
}))

const unitesFiltrees = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  const unites = data.value?.unites ?? []
  return unites.filter((u) => {
    const override = overrideAffiche(u)
    const correspondRecherche =
      !q ||
      [u.produit, u.contenant, u.packaging, override.displayName, u.libelleEasybeer]
        .some((v) => v?.toLowerCase().includes(q))
    const correspondEtat =
      filtreEtat.value === 'tous' ||
      (filtreEtat.value === 'visibles' && override.visible) ||
      (filtreEtat.value === 'rupture' && override.rupture)
    const correspondColonnes =
      (filtresColonne.value.contenant === 'tous' || u.contenant === filtresColonne.value.contenant) &&
      (filtresColonne.value.packaging === 'tous' || u.packaging === filtresColonne.value.packaging)
    return correspondRecherche && correspondEtat && correspondColonnes
  })
})

function basculerFiltreEtat(cle: typeof filtreEtat.value) {
  filtreEtat.value = filtreEtat.value === cle ? 'tous' : cle
}

const filtresActifs = computed(
  () =>
    recherche.value.trim() !== '' ||
    filtreEtat.value !== 'tous' ||
    filtresColonne.value.contenant !== 'tous' ||
    filtresColonne.value.packaging !== 'tous',
)

function reinitialiserFiltres() {
  recherche.value = ''
  filtreEtat.value = 'tous'
  filtresColonne.value = { contenant: 'tous', packaging: 'tous' }
}

const statsCatalogue = computed(() => {
  const unites = data.value?.unites ?? []
  return {
    total: unites.length,
    visibles: unites.filter((u) => overrideAffiche(u).visible).length,
    ruptures: unites.filter((u) => overrideAffiche(u).rupture).length,
  }
})

// --- Tri par colonne (desktop) ---

type CleTri = 'produit' | 'contenant' | 'packaging' | 'tarif' | 'visibilite' | 'stock'
const colonnesTri: { cle: CleTri; label: string }[] = [
  { cle: 'produit', label: 'Produit' },
  { cle: 'contenant', label: 'Contenant' },
  { cle: 'packaging', label: 'Packaging' },
  { cle: 'tarif', label: 'Tarif HT' },
  { cle: 'visibilite', label: 'Visibilité' },
  { cle: 'stock', label: 'Stock' },
]
const tri = ref<{ cle: CleTri; direction: 'asc' | 'desc' }>({ cle: 'produit', direction: 'asc' })

function classeColonneTri(cle: CleTri) {
  if (cle === 'tarif') return 'w-48'
  if (cle === 'visibilite') return 'w-48 pl-6'
  if (cle === 'stock') return 'w-40'
  return ''
}

function basculerTri(cle: CleTri) {
  tri.value =
    tri.value.cle === cle
      ? { cle, direction: tri.value.direction === 'asc' ? 'desc' : 'asc' }
      : { cle, direction: 'asc' }
}

function valeurTri(u: CatalogueAdminUnite, cle: CleTri): string | number {
  const override = overrideAffiche(u)
  switch (cle) {
    case 'produit':
      return u.produit.toLowerCase()
    case 'contenant':
      return u.contenant?.toLowerCase() ?? ''
    case 'packaging':
      return u.packaging?.toLowerCase() ?? ''
    case 'tarif':
      // Tarif de référence = le plus bas de l'unité (les unités sans tarif en dernier).
      return u.tarifs.length ? Math.min(...u.tarifs.map((t) => t.prixHT)) : Number.POSITIVE_INFINITY
    case 'visibilite':
      return override.visible ? 1 : 0
    case 'stock':
      return override.rupture ? 1 : 0
  }
}

const unitesTriees = computed(() =>
  [...unitesFiltrees.value].sort((a, b) => {
    const va = valeurTri(a, tri.value.cle)
    const vb = valeurTri(b, tri.value.cle)
    const resultat =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'fr', { numeric: true, sensitivity: 'base' })
    return tri.value.direction === 'asc' ? resultat : -resultat
  }),
)

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
        <div class="grid gap-3 sm:flex sm:items-start sm:justify-between">
          <div class="flex min-w-0 items-center justify-between gap-3 sm:block">
            <CardTitle class="flex items-center gap-2 text-lg">
              <Package class="size-5 text-muted-foreground" />
              Catalogue
            </CardTitle>
            <EasybeerLink
              :href="easybeerLien.grilleTarifaire()"
              label="Ouvrir la grille tarifaire dans Easybeer"
              class="shrink-0 text-muted-foreground sm:hidden"
            />
          </div>
          <div class="grid justify-items-start gap-2 sm:justify-items-end">
            <div class="flex items-center gap-2">
              <Skeleton v-if="isPending" class="h-3 w-36" />
              <p v-else-if="data?.syncedAt" class="text-xs whitespace-nowrap text-muted-foreground">
                Dernière mise à jour : {{ dateHeureFr(data.syncedAt) }}
              </p>
              <EasybeerLink
                :href="easybeerLien.grilleTarifaire()"
                label="Ouvrir la grille tarifaire dans Easybeer"
                class="hidden text-muted-foreground sm:inline-flex"
              />
            </div>
            <BoutonActualiser
              label="Actualiser le catalogue"
              :pending="actualisation.isPending.value || syncEnCours"
              @click="actualisation.mutate()"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent class="grid gap-4">
        <div class="grid gap-3">
          <div class="relative max-w-sm">
            <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="recherche" placeholder="Rechercher (produit, contenant, packaging)…" class="pl-9" />
          </div>
        </div>

        <div
          v-if="isPending"
          class="grid gap-3"
          aria-label="Chargement du catalogue administrateur"
          aria-busy="true"
        >
          <div class="flex flex-wrap gap-2">
            <Skeleton class="h-7 w-36 rounded-md" />
            <Skeleton class="h-7 w-32 rounded-md" />
            <Skeleton class="h-7 w-44 rounded-md" />
          </div>
          <div class="grid gap-3 md:hidden">
            <div v-for="i in 5" :key="i" class="grid gap-3 rounded-xl border p-3">
              <div class="flex items-start gap-3">
                <Skeleton class="size-16 shrink-0 rounded-lg" />
                <div class="grid flex-1 gap-2">
                  <Skeleton class="h-4 w-3/4" />
                  <div class="flex gap-2">
                    <Skeleton class="h-6 w-28 rounded-full" />
                    <Skeleton class="h-6 w-24 rounded-full" />
                  </div>
                </div>
              </div>
              <div class="flex justify-between gap-3">
                <Skeleton class="h-8 w-32 rounded-md" />
                <Skeleton class="h-8 w-20 rounded-md" />
              </div>
            </div>
          </div>
          <div class="hidden overflow-hidden rounded-lg border md:block">
            <div class="grid grid-cols-[4rem_1.2fr_1fr_1fr_.8fr_.7fr] gap-4 bg-muted p-3">
              <Skeleton v-for="i in 6" :key="`head-${i}`" class="h-4" />
            </div>
            <div
              v-for="ligne in 6"
              :key="ligne"
              class="grid grid-cols-[4rem_1.2fr_1fr_1fr_.8fr_.7fr] items-center gap-4 border-t p-3"
            >
              <Skeleton class="size-12 rounded-md" />
              <Skeleton class="h-4 w-4/5" />
              <Skeleton class="h-4 w-3/4" />
              <Skeleton class="h-4 w-3/4" />
              <Skeleton class="h-4 w-20" />
              <div class="flex gap-2">
                <Skeleton class="h-6 w-14 rounded-full" />
                <Skeleton class="h-6 w-14 rounded-full" />
              </div>
            </div>
          </div>
        </div>
        <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>
        <p v-else-if="!data?.unites.length" class="py-8 text-center text-sm text-muted-foreground">
          Aucune unité tarifée. Lancez une synchronisation pour charger la grille tarifaire.
        </p>

        <template v-else>
          <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <button
              type="button"
              class="rounded-md border px-2.5 py-1 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
              :class="filtreEtat === 'visibles' ? 'border-primary/50 bg-primary/10 text-foreground' : 'bg-muted/30'"
              @click="basculerFiltreEtat('visibles')"
            >
              <strong class="font-semibold text-foreground">{{ statsCatalogue.visibles }}</strong>
              / {{ statsCatalogue.total }} produit{{ statsCatalogue.total > 1 ? 's' : '' }} visible{{ statsCatalogue.visibles > 1 ? 's' : '' }}
            </button>
            <button
              type="button"
              class="rounded-md border px-2.5 py-1 text-left transition-colors hover:border-destructive/40 hover:bg-destructive/5 hover:text-foreground"
              :class="filtreEtat === 'rupture' ? 'border-destructive/50 bg-destructive/10 text-foreground' : 'bg-muted/30'"
              @click="basculerFiltreEtat('rupture')"
            >
              <strong class="font-semibold text-foreground">{{ statsCatalogue.ruptures }}</strong>
              / {{ statsCatalogue.total }} produit{{ statsCatalogue.total > 1 ? 's' : '' }} en rupture
            </button>

            <Select
              :model-value="filtresColonne.contenant"
              @update:model-value="filtresColonne.contenant = String($event)"
            >
              <SelectTrigger
                class="h-7 w-[11rem] bg-background text-xs font-normal"
                :class="filtresColonne.contenant !== 'tous' ? 'border-primary text-primary' : ''"
                aria-label="Filtrer par contenant"
              >
                <SelectValue placeholder="Contenant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous les contenants</SelectItem>
                <SelectItem v-for="v in optionsColonne.contenant" :key="v" :value="v">{{ v }}</SelectItem>
              </SelectContent>
            </Select>

            <Select
              :model-value="filtresColonne.packaging"
              @update:model-value="filtresColonne.packaging = String($event)"
            >
              <SelectTrigger
                class="h-7 w-[11rem] bg-background text-xs font-normal"
                :class="filtresColonne.packaging !== 'tous' ? 'border-primary text-primary' : ''"
                aria-label="Filtrer par packaging"
              >
                <SelectValue placeholder="Packaging" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous les packagings</SelectItem>
                <SelectItem v-for="v in optionsColonne.packaging" :key="v" :value="v">{{ v }}</SelectItem>
              </SelectContent>
            </Select>

            <Button
              v-if="filtresActifs"
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 text-xs text-muted-foreground hover:text-foreground"
              @click="reinitialiserFiltres"
            >
              Réinitialiser
            </Button>
          </div>

          <div class="grid gap-3 md:hidden">
            <article
              v-for="u in unitesFiltrees"
              :key="u.idStockBouteille"
              class="grid gap-3 rounded-xl border bg-background p-3 shadow-xs"
            >
              <div class="flex gap-3">
                <PhotoUpload
                  :photo-url="overrideAffiche(u).photoUrl"
                  :libelle="u.override.displayName || u.produit"
                  :envoyer="(f) => envoyerPhoto(u.idStockBouteille, f)"
                  :retirer="() => retirerPhoto(u.idStockBouteille)"
                />

                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-2">
                    <p class="min-w-0 text-sm font-semibold leading-snug">{{ overrideAffiche(u).displayName || u.produit }}</p>
                  </div>
                  <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{{ u.produit }}</p>
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="outline">{{ u.contenant }}</Badge>
                    <Badge variant="outline">{{ u.packaging }}</Badge>
                    <Badge
                      variant="secondary"
                      :class="overrideAffiche(u).rupture
                        ? 'border border-destructive/20 bg-destructive/10 text-destructive'
                        : 'border border-primary/20 bg-primary/10 text-primary'"
                    >
                      <PackageX v-if="overrideAffiche(u).rupture" class="size-3" />
                      <PackageCheck v-else class="size-3" />
                      {{ overrideAffiche(u).rupture ? 'Rupture' : 'Disponible' }}
                    </Badge>
                    <Badge v-if="!overrideAffiche(u).visible" variant="secondary" class="border border-border bg-muted text-foreground">
                      <EyeOff class="size-3" />
                      Masqué
                    </Badge>
                  </div>
                </div>
              </div>

              <div class="grid gap-1 rounded-lg bg-muted/40 p-3 text-sm">
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

              <div class="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-2">
                <label class="flex min-w-0 cursor-pointer items-center justify-between gap-1.5 rounded-lg border px-2 py-2.5 text-sm">
                  <span>Visible</span>
                  <Switch
                    class="shrink-0"
                    :model-value="overrideAffiche(u).visible"
                    @update:model-value="(v: boolean) => definirBrouillon(u, 'visible', v)"
                  />
                </label>
                <label
                  class="flex min-w-0 cursor-pointer items-center justify-between gap-1.5 rounded-lg border px-2 py-2.5 text-xs"
                  :class="overrideAffiche(u).rupture
                    ? 'border-destructive/30 bg-destructive/5 text-destructive'
                    : 'border-primary/30 bg-primary/5 text-primary'"
                >
                  <span class="flex min-w-0 items-center gap-1 font-medium">
                    <PackageX v-if="overrideAffiche(u).rupture" class="size-3.5 shrink-0" />
                    <PackageCheck v-else class="size-3.5 shrink-0" />
                    {{ overrideAffiche(u).rupture ? 'Rupture' : 'Disponible' }}
                  </span>
                  <Switch
                    class="shrink-0"
                    :model-value="overrideAffiche(u).rupture"
                    color-mode="availability"
                    @update:model-value="(v: boolean) => definirBrouillon(u, 'rupture', v)"
                  />
                </label>
              </div>

              <details class="group rounded-lg border">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
                  Modifier le nom d'affichage
                  <ChevronDown class="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div class="border-t p-3">
                  <Textarea
                    :model-value="overrideAffiche(u).displayName"
                    :placeholder="`Nom d'affichage (sinon : ${u.produit} — ${u.packaging})`"
                    class="min-h-24 resize-y"
                    @update:model-value="(v) => definirBrouillon(u, 'displayName', String(v))"
                  />
                </div>
              </details>
            </article>
            <p v-if="!unitesFiltrees.length" class="rounded-lg border p-4 text-center text-sm text-muted-foreground">
              Aucun produit trouvé.
            </p>
          </div>

        <!-- Vue desktop : tableau à colonnes (inspiré d'Easybeer) — contenant et
             packaging ont leur propre colonne, et la visibilité affiche son ÉTAT
             en toutes lettres à côté de l'interrupteur. -->
        <div class="hidden overflow-x-auto rounded-lg border md:block">
          <Table>
            <TableHeader class="[&_tr]:bg-muted">
              <TableRow>
                <TableHead class="w-16"><span class="sr-only">Photo</span></TableHead>
                <TableHead
                  v-for="colonne in colonnesTri"
                  :key="colonne.cle"
                  :class="classeColonneTri(colonne.cle)"
                >
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-background/80"
                    :aria-label="`Trier par ${colonne.label}`"
                    @click="basculerTri(colonne.cle)"
                  >
                    {{ colonne.label }}
                    <ArrowUp v-if="tri.cle === colonne.cle && tri.direction === 'asc'" class="size-3" />
                    <ArrowDown v-else-if="tri.cle === colonne.cle && tri.direction === 'desc'" class="size-3" />
                    <ArrowUpDown v-else class="size-3 text-muted-foreground/60" />
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="u in unitesTriees"
                :key="u.idStockBouteille"
                :class="overrideAffiche(u).visible ? '' : 'bg-muted/30'"
              >
                <TableCell>
                  <PhotoUpload
                    :photo-url="overrideAffiche(u).photoUrl"
                    :libelle="u.override.displayName || u.produit"
                    :envoyer="(f) => envoyerPhoto(u.idStockBouteille, f)"
                    :retirer="() => retirerPhoto(u.idStockBouteille)"
                  />
                </TableCell>

                <TableCell class="min-w-64">
                  <p class="text-sm font-medium">{{ u.produit }}</p>
                  <Input
                    :model-value="overrideAffiche(u).displayName"
                    :placeholder="`Nom d'affichage (sinon : ${u.produit} — ${u.packaging})`"
                    class="mt-1.5 max-w-md"
                    @update:model-value="(v) => definirBrouillon(u, 'displayName', String(v))"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  />
                </TableCell>

                <TableCell class="whitespace-nowrap text-sm">{{ u.contenant }}</TableCell>
                <TableCell class="whitespace-nowrap text-sm">{{ u.packaging }}</TableCell>

                <TableCell class="w-48 pr-8 text-sm">
                  <div v-if="u.tarifs.length" class="grid w-fit grid-cols-[max-content_max-content] items-baseline gap-x-8">
                    <template v-for="t in u.tarifs" :key="t.idClientType">
                      <span class="text-muted-foreground">{{ t.typeClient }}</span>
                      <span class="justify-self-start text-left font-semibold tabular-nums">{{ prixFr(t.prixHT) }}</span>
                    </template>
                  </div>
                  <p v-if="!u.tarifs.length" class="text-xs text-muted-foreground">Aucun tarif</p>
                </TableCell>

                <TableCell class="w-48 pl-6">
                  <label class="flex cursor-pointer items-center gap-2 whitespace-nowrap">
                    <Switch
                      :model-value="overrideAffiche(u).visible"
                      @update:model-value="(v: boolean) => definirBrouillon(u, 'visible', v)"
                    />
                    <span
                      class="flex items-center gap-1 text-xs font-medium"
                      :class="overrideAffiche(u).visible ? 'text-primary' : 'text-muted-foreground'"
                    >
                      <Eye v-if="overrideAffiche(u).visible" class="size-3.5" />
                      <EyeOff v-else class="size-3.5" />
                      {{ overrideAffiche(u).visible ? 'Visible' : 'Masqué' }}
                    </span>
                  </label>
                </TableCell>

                <TableCell class="w-40">
                  <label class="flex cursor-pointer items-center gap-2 whitespace-nowrap">
                    <Switch
                      :model-value="overrideAffiche(u).rupture"
                      color-mode="availability"
                      @update:model-value="(v: boolean) => definirBrouillon(u, 'rupture', v)"
                    />
                    <span
                      class="flex items-center gap-1 text-xs font-medium"
                      :class="overrideAffiche(u).rupture ? 'text-destructive' : 'text-primary'"
                    >
                      <PackageX v-if="overrideAffiche(u).rupture" class="size-3.5" />
                      <PackageCheck v-else class="size-3.5" />
                      {{ overrideAffiche(u).rupture ? 'Rupture' : 'Disponible' }}
                    </span>
                  </label>
                </TableCell>
              </TableRow>

              <TableRow v-if="!unitesFiltrees.length">
                <TableCell colspan="7" class="py-8 text-center text-sm text-muted-foreground">
                  Aucun produit trouvé.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        </template>
      </CardContent>
    </Card>
  </div>
</template>
