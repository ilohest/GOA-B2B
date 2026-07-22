<script setup lang="ts">
/** Photo produit avec repli sur le logo GOA — repère visuel secondaire. */
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    photoUrl?: string | null
    libelle?: string
    /** Classes de dimension Tailwind (la vignette est carrée). */
    taille?: string
    /** Classe de dimension du logo de repli, proportionnée à `taille`. */
    tailleRepli?: string
    grise?: boolean
  }>(),
  { taille: 'size-16', tailleRepli: 'size-9', grise: false },
)

// Si l'URL de photo est cassée, on retombe proprement sur le placeholder.
const imageEnErreur = ref(false)
watch(
  () => props.photoUrl,
  () => {
    imageEnErreur.value = false
  },
)
</script>

<template>
  <div
    class="relative shrink-0 overflow-hidden rounded-md bg-muted"
    :class="taille"
  >
    <img
      v-if="photoUrl && !imageEnErreur"
      :src="photoUrl"
      :alt="libelle ?? ''"
      loading="lazy"
      class="size-full object-cover"
      :class="grise ? 'grayscale' : ''"
      @error="imageEnErreur = true"
    />
    <div
      v-else
      class="grid size-full place-items-center bg-gradient-to-br from-brand-50 to-muted"
      aria-hidden="true"
    >
      <img
        src="/brand/goa-rond.png"
        alt=""
        class="rounded-full opacity-30"
        :class="[tailleRepli, grise ? 'grayscale' : '']"
      />
    </div>
  </div>
</template>
