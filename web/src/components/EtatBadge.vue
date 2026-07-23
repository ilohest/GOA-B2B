<script setup lang="ts">
/** Pastille d'état de commande (libellé + couleur fournis par Easybeer). */
import { computed } from 'vue'
import type { EtatCommande } from '@/lib/types'

const props = defineProps<{ etat: EtatCommande; nombre?: number }>()

const styleBadge = computed(() =>
  props.etat.couleur
    ? {
        borderColor: `${props.etat.couleur}55`,
        backgroundColor: `${props.etat.couleur}14`,
      }
    : undefined,
)
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground/80"
    :style="styleBadge"
  >
    <span
      class="size-1.5 rounded-full"
      :style="{ backgroundColor: etat.couleur ?? 'var(--muted-foreground)' }"
    />
    {{ etat.libelle }}
    <span v-if="nombre != null" class="font-semibold tabular-nums">{{ nombre }}</span>
  </span>
</template>
