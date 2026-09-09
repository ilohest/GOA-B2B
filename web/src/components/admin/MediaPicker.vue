<script setup lang="ts">
/**
 * Bibliothèque d'images : dépôt depuis l'ordinateur en haut, images déjà
 * envoyées en dessous. Une image existe indépendamment des produits, donc la
 * choisir ne la duplique pas — plusieurs unités peuvent pointer vers la même.
 */
import { computed, ref, watch } from 'vue'
import { Eye, ImageOff, Loader2, Trash2, Upload, X } from '@lucide/vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { MediaItem } from '@/lib/types'
import { dateHeureFr } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const props = defineProps<{
  ouvert: boolean
  libelle: string
  /** Fichier déposé directement sur la vignette : importé dès l'ouverture. */
  fichierAImporter?: File | null
}>()
const emit = defineEmits<{ 'update:ouvert': [valeur: boolean]; choisir: [url: string] }>()

const TYPES = ['image/jpeg', 'image/png', 'image/webp']
const TAILLE_MAX = 5 * 1024 * 1024

const queryClient = useQueryClient()
const input = ref<HTMLInputElement>()
const survole = ref(false)
const selection = ref<string | null>(null)
const recherche = ref('')
const apercu = ref<MediaItem | null>(null)
const dimensions = ref<string | null>(null)

function ouvrirApercu(item: MediaItem) {
  // Les dimensions ne sont pas stockées : on les lit sur l'image chargée.
  dimensions.value = null
  apercu.value = item
  // Sélectionner en même temps évite deux notions concurrentes : l'image
  // affichée en grand est celle que le bouton du pied appliquera.
  selection.value = item.url
}

const media = useQuery({
  queryKey: ['admin', 'media'],
  queryFn: () => api.get<{ media: MediaItem[] }>('/admin/media'),
  enabled: computed(() => props.ouvert),
})

const liste = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  const items = media.data.value?.media ?? []
  return q ? items.filter((m) => m.nom.toLowerCase().includes(q)) : items
})

// Rouvrir le sélecteur ne doit pas conserver la sélection précédente.
watch(
  () => props.ouvert,
  (ouvert) => {
    if (!ouvert) return
    selection.value = null
    recherche.value = ''
    apercu.value = null
    // Déposer sur la vignette doit valoir import, pas seulement ouverture.
    if (props.fichierAImporter) traiter(props.fichierAImporter)
  },
)

const envoi = useMutation({
  mutationFn: (fichier: File) =>
    api.envoyerFichier<{ ok: boolean; media: MediaItem }>('/admin/media', 'fichier', fichier),
  onSuccess: (res) => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'media'] })
    // Une image qu'on vient d'ajouter est presque toujours celle qu'on veut.
    selection.value = res.media.url
    toast.success('Image ajoutée à la bibliothèque.')
  },
  onError: (e) => toast.error((e as Error).message),
})

const suppression = useMutation({
  mutationFn: (id: string) => api.delete(`/admin/media/${id}`),
  onSuccess: (_res, id) => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'media'] })
    if (apercu.value?.id === id) apercu.value = null
    toast.success('Image supprimée.')
  },
  onError: (e) => toast.error((e as Error).message),
})

function traiter(fichier: File | undefined | null) {
  if (!fichier || envoi.isPending.value) return
  if (!TYPES.includes(fichier.type)) return toast.error('Format non supporté — JPEG, PNG ou WebP.')
  if (fichier.size > TAILLE_MAX) return toast.error('Image trop lourde (5 Mo maximum).')
  envoi.mutate(fichier)
}

function onDrop(e: DragEvent) {
  survole.value = false
  traiter(e.dataTransfer?.files?.[0])
}

function fermer() {
  emit('update:ouvert', false)
}

function valider() {
  if (!selection.value) return
  emit('choisir', selection.value)
  fermer()
}

function poids(octets: number) {
  return octets < 1024 * 1024
    ? `${Math.round(octets / 1024)} Ko`
    : `${(octets / 1024 / 1024).toFixed(1)} Mo`
}
</script>

<template>
  <!--
    Téléporté dans <body> : rendue en place, la modale est rognée par les
    conteneurs du tableau, dont le dépassement est masqué. `position: fixed`
    ne suffit pas dès qu'un ancêtre crée un contexte d'empilement.
  -->
  <Teleport to="body">
    <div
      v-if="ouvert"
    class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Choisir une image"
    @click.self="fermer"
    @keydown.esc="fermer"
  >
    <div
      class="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border bg-background shadow-lg transition-[max-width]"
      :class="apercu ? 'max-w-5xl' : 'max-w-3xl'"
    >
      <div class="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div class="min-w-0">
          <h2 class="text-base font-semibold">Choisir une image</h2>
          <p class="truncate text-sm text-muted-foreground">{{ libelle }}</p>
        </div>
        <Button variant="ghost" size="sm" @click="fermer">Fermer</Button>
      </div>

      <div class="grid gap-4 overflow-y-auto px-5 py-4">
        <button
          type="button"
          class="grid place-items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors"
          :class="[
            survole ? 'border-primary bg-primary/10' : 'hover:border-primary/50 hover:bg-primary/5',
            envoi.isPending.value ? 'pointer-events-none opacity-60' : '',
          ]"
          @click="input?.click()"
          @dragover.prevent="survole = true"
          @dragleave="survole = false"
          @drop.prevent="onDrop"
        >
          <Loader2 v-if="envoi.isPending.value" class="size-5 animate-spin text-primary" />
          <Upload v-else class="size-5 text-primary" aria-hidden="true" />
          <span class="text-sm font-medium">
            {{ envoi.isPending.value ? 'Envoi en cours…' : 'Déposer une image ou parcourir vos fichiers' }}
          </span>
          <span class="text-xs text-muted-foreground">JPEG, PNG ou WebP · 5 Mo maximum</span>
        </button>

        <div v-if="(media.data.value?.media.length ?? 0) > 6">
          <input
            v-model="recherche"
            type="search"
            placeholder="Rechercher une image par son nom…"
            class="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </div>

        <div v-if="media.isPending.value" class="grid grid-cols-3 gap-3 sm:grid-cols-4">
          <Skeleton v-for="i in 8" :key="i" class="aspect-square rounded-lg" />
        </div>

        <p v-else-if="!media.data.value?.media.length" class="py-6 text-center text-sm text-muted-foreground">
          Aucune image dans la bibliothèque pour l'instant. Déposez-en une ci-dessus, elle sera
          ensuite réutilisable sur tous vos produits.
        </p>

        <p v-else-if="!liste.length" class="py-6 text-center text-sm text-muted-foreground">
          Aucune image ne correspond à « {{ recherche }} ».
        </p>

        <div v-else class="grid gap-4" :class="apercu ? 'sm:grid-cols-[minmax(0,1fr)_18rem]' : ''">
        <ul class="grid grid-cols-3 gap-3" :class="apercu ? 'sm:grid-cols-3' : 'sm:grid-cols-4'">
          <li v-for="item in liste" :key="item.id" class="relative">
            <button
              type="button"
              class="grid w-full gap-1.5 rounded-lg border p-1.5 text-left transition-colors"
              :class="
                selection === item.url
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'hover:border-primary/40'
              "
              :aria-pressed="selection === item.url"
              @click="selection = item.url"
              @dblclick="((selection = item.url), valider())"
            >
              <span class="grid aspect-square place-items-center overflow-hidden rounded-md bg-muted">
                <img :src="item.url" :alt="item.nom" class="size-full object-cover" loading="lazy" />
              </span>
              <span class="truncate text-[11px] leading-tight" :title="item.nom">{{ item.nom }}</span>
              <span class="text-[10px] text-muted-foreground">{{ poids(item.taille) }}</span>
            </button>
            <button
              type="button"
              class="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-md border bg-background/90 text-muted-foreground opacity-70 shadow-sm backdrop-blur transition hover:bg-destructive hover:text-destructive-foreground hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
              :aria-label="`Supprimer ${item.nom} de la bibliothèque`"
              :disabled="suppression.isPending.value"
              @click.stop="suppression.mutate(item.id)"
            >
              <Trash2 class="size-3.5" />
            </button>
            <button
              type="button"
              class="oeil absolute right-2.5 bottom-11 grid size-6 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm transition"
              :class="apercu?.id === item.id ? 'ring-2 ring-primary/40' : ''"
              :aria-label="`Aperçu de ${item.nom}`"
              @click.stop="ouvrirApercu(item)"
            >
              <Eye class="size-3.5" />
            </button>
          </li>
        </ul>

        <aside v-if="apercu" class="grid content-start gap-3 rounded-lg border bg-muted/20 p-3">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-medium">Aperçu</p>
            <button
              type="button"
              class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Fermer l'aperçu"
              @click="apercu = null"
            >
              <X class="size-4" />
            </button>
          </div>
          <img
            :src="apercu.url"
            :alt="apercu.nom"
            class="max-h-72 w-full rounded-md border bg-background object-contain"
            @load="(e) => {
              const img = e.target as HTMLImageElement
              dimensions = `${img.naturalWidth} × ${img.naturalHeight}`
            }"
          />
          <div class="grid gap-0.5">
            <p class="text-sm font-medium break-words">{{ apercu.nom }}</p>
            <p class="text-xs text-muted-foreground">
              {{ dateHeureFr(apercu.creeLe) }} · {{ apercu.contentType.replace('image/', '').toUpperCase() }}
              <template v-if="dimensions"> · {{ dimensions }}</template>
            </p>
            <p class="text-xs text-muted-foreground">{{ poids(apercu.taille) }}</p>
          </div>
        </aside>
        </div>

        <p v-if="media.isError.value" class="flex items-center gap-2 text-sm text-destructive">
          <ImageOff class="size-4" />
          Bibliothèque indisponible : {{ (media.error.value as Error)?.message }}
        </p>
      </div>

      <div class="flex items-center justify-end gap-2 border-t px-5 py-3">
        <Button variant="outline" size="sm" @click="fermer">Annuler</Button>
        <Button size="sm" :disabled="!selection" @click="valider">Utiliser cette image</Button>
      </div>
    </div>

      <input
        ref="input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        class="hidden"
        @change="traiter(($event.target as HTMLInputElement).files?.[0]); (($event.target as HTMLInputElement).value = '')"
      />
    </div>
  </Teleport>
</template>

<style scoped>
/*
 * L'œil suit le survol, comme attendu d'un aperçu secondaire. Mais le survol
 * n'existe pas au doigt : là, il reste visible, sans quoi la fonction serait
 * inaccessible sur tablette.
 */
@media (hover: hover) {
  .oeil {
    opacity: 0;
  }
  li:hover .oeil,
  .oeil:focus-visible {
    opacity: 1;
  }
}
</style>
