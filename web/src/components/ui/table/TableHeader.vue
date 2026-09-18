<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  /**
   * Fige la ligne d'en-tête pendant le défilement. « page » la cale sous
   * l'en-tête d'application (56 px) quand c'est la page qui défile ;
   * « conteneur » la cale en haut de la zone défilante qui entoure le tableau.
   */
  fige?: "page" | "conteneur"
}>()

// Fond et filet portés par les <th> : celui du <tr> ne suit pas les cellules
// figées et laisserait les lignes défiler en transparence sous l'en-tête.
//
// Le décalage de 56 px n'est posé qu'à partir de md : sous md, ces tableaux
// défilent à l'intérieur de leur propre boîte, et un `top` non nul y pousserait
// l'en-tête vers le bas au lieu de le figer.
const classesFigees = computed(() =>
  props.fige
    ? cn(
        "[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted [&_th]:shadow-[inset_0_-1px_0_var(--border)]",
        props.fige === "page" ? "md:[&_th]:top-14" : "",
      )
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
