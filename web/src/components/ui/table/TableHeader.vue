<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  /**
   * Fige la ligne d'en-tête sous l'en-tête de l'application pendant que la
   * page défile, à partir de la largeur indiquée — celle où le tableau tient
   * dans la page.
   *
   * Deux conditions côté tableau : aucun ancêtre ne doit être une zone
   * défilante (sinon `sticky` s'y rattache), et le tableau doit être en
   * `border-separate` — en `border-collapse`, les bordures appartiennent au
   * tableau et resteraient en place pendant que l'en-tête défile.
   *
   * Les cellules ne portent volontairement aucun arrondi : il découperait leur
   * fond et laisserait aux deux coins une encoche transparente où l'on verrait
   * défiler les lignes. C'est la boîte du tableau qui rogne ses angles.
   */
  fige?: "md" | "xl"
}>()

const FIGE = {
  md: "md:sticky md:top-16 md:z-20",
  xl: "xl:sticky xl:top-16 xl:z-20",
} as const

const classesFigees = computed(() =>
  props.fige
    ? cn("[&_th]:bg-muted", FIGE[props.fige])
    : "",
)
</script>

<template>
  <thead
    data-slot="table-header"
    :class="cn('[&_tr]:border-b', classesFigees, props.class)"
  >
    <slot />
  </thead>
</template>
