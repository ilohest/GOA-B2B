<script setup lang="ts">
/**
 * Vignette de photo produit. Le clic ouvre la bibliothèque d'images, où l'on
 * choisit une image déjà envoyée ou l'on en dépose une nouvelle. Déposer
 * directement sur la vignette reste possible : le fichier est alors importé
 * dans la bibliothèque puis appliqué.
 */
import { ref } from 'vue'
import { Plus, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import MediaPicker from '@/components/admin/MediaPicker.vue'

const props = defineProps<{
  photoUrl: string
  libelle: string
  /** Applique l'image choisie (l'appelant décide quoi en faire). */
  choisir: (url: string) => void
  retirer: () => Promise<void>
}>()

const enCours = ref(false)
const survole = ref(false)
const bibliothequeOuverte = ref(false)
const fichierDepose = ref<File | null>(null)

const TYPES = ['image/jpeg', 'image/png', 'image/webp']

function ouvrirBibliotheque(fichier: File | null = null) {
  fichierDepose.value = fichier
  bibliothequeOuverte.value = true
}

function onDrop(e: DragEvent) {
  survole.value = false
  const fichier = e.dataTransfer?.files?.[0]
  if (!fichier) return
  if (!TYPES.includes(fichier.type)) return toast.error('Format non supporté — JPEG, PNG ou WebP.')
  if (fichier.size > 5 * 1024 * 1024) return toast.error('Image trop lourde (5 Mo maximum).')
  ouvrirBibliotheque(fichier)
}

function onChoisir(url: string) {
  props.choisir(url)
  toast.success('Photo ajoutée aux modifications.')
}

async function onRetirer() {
  enCours.value = true
  try {
    await props.retirer()
    toast.success('Photo retirée des modifications.')
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    enCours.value = false
  }
}
</script>

<template>
  <div class="relative size-20 shrink-0">
    <!-- Zone vignette / drop -->
    <button
      type="button"
      class="group relative grid size-full place-items-center overflow-hidden rounded-lg border transition-colors"
      :class="[
        photoUrl ? 'border-border' : 'border-dashed hover:border-primary/50 hover:bg-primary/5',
        survole ? 'border-primary bg-primary/10' : '',
        enCours ? 'pointer-events-none opacity-60' : '',
      ]"
      :aria-label="photoUrl ? `Remplacer la photo de ${libelle}` : `Ajouter une photo pour ${libelle}`"
      @click="ouvrirBibliotheque()"
      @dragover.prevent="survole = true"
      @dragleave="survole = false"
      @drop.prevent="onDrop"
    >
      <template v-if="photoUrl">
        <img :src="photoUrl" :alt="libelle" class="absolute inset-0 size-full object-cover" />
        <span
          class="absolute inset-0 grid place-items-center bg-black/50 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          Remplacer
        </span>
      </template>
      <span
        v-else
        class="grid max-w-full place-items-center gap-1 px-1 text-center text-[11px] leading-tight whitespace-normal text-muted-foreground"
      >
        <Plus class="size-5 text-primary" aria-hidden="true" />
        <span class="block">
          Ajouter une<br />
          image
        </span>
      </span>
      <span
        v-if="enCours"
        class="absolute inset-0 grid place-items-center bg-background/70 text-xs font-medium"
      >
        Envoi…
      </span>
    </button>

    <button
      v-if="photoUrl && !enCours"
      type="button"
      class="absolute right-1 bottom-1 grid size-6 place-items-center rounded-md border border-white/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-destructive hover:text-destructive-foreground"
      :aria-label="`Retirer la photo de ${libelle}`"
      @click="onRetirer"
    >
      <Trash2 class="size-3.5" />
    </button>

    <MediaPicker
      v-model:ouvert="bibliothequeOuverte"
      :libelle="libelle"
      :fichier-a-importer="fichierDepose"
      @choisir="onChoisir"
    />
</div>
</template>
