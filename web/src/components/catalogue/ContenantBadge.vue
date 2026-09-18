<script setup lang="ts">
/**
 * Pastille d'un contenant, colorée par famille et volume (cf. lib/contenant).
 * S'appuie sur le Badge maison pour garder le gabarit des autres pastilles de
 * l'app (fiche compte, remises…) : seules les couleurs changent.
 */
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { styleContenant } from '@/lib/contenant'

const props = defineProps<{
  contenant?: string | null
  /** Grise la pastille (produit en rupture) sans changer sa forme. */
  attenue?: boolean
}>()

const classes = computed(() =>
  props.attenue ? 'bg-muted/40 text-muted-foreground' : styleContenant(props.contenant),
)
</script>

<template>
  <Badge v-if="contenant" variant="outline" :class="classes">
    {{ contenant }}
  </Badge>
</template>
