<script setup lang="ts">
/**
 * Vignette + zone d'upload de photo produit, façon Shopify :
 * clic ou glisser-déposer, remplacement, suppression, état d'envoi.
 */
import { ref } from 'vue'
import { Plus, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'

const props = defineProps<{
  photoUrl: string
  libelle: string
  /** Envoie le fichier (l'appelant gère l'appel API) ; doit rejeter en cas d'échec. */
  envoyer: (fichier: File) => Promise<void>
  retirer: () => Promise<void>
}>()

const input = ref<HTMLInputElement>()
const enCours = ref(false)
const survole = ref(false)

const TYPES = ['image/jpeg', 'image/png', 'image/webp']

async function traiter(fichier: File | undefined | null) {
  if (!fichier || enCours.value) return
  if (!TYPES.includes(fichier.type)) {
    toast.error('Format non supporté — JPEG, PNG ou WebP.')
    return
  }
  if (fichier.size > 5 * 1024 * 1024) {
    toast.error('Image trop lourde (5 Mo maximum).')
    return
  }
  enCours.value = true
  try {
    await props.envoyer(fichier)
    toast.success('Photo ajoutée aux modifications.')
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    enCours.value = false
    if (input.value) input.value.value = ''
  }
}

function onDrop(e: DragEvent) {
  survole.value = false
  traiter(e.dataTransfer?.files?.[0])
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
      @click="input?.click()"
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

    <input
      ref="input"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      class="hidden"
      @change="traiter(($event.target as HTMLInputElement).files?.[0])"
    />
</div>
</template>
