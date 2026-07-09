<script setup lang="ts">
/** Pastille d'état de commande (libellé + couleur fournis par Easybeer). */
import type { EtatCommande } from '@/lib/types'

defineProps<{ etat: EtatCommande }>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
  >
    <span
      class="size-1.5 rounded-full"
      :style="{ backgroundColor: etat.couleur ?? 'var(--muted-foreground)' }"
    />
    {{ etat.libelle }}
  </span>
</template>
