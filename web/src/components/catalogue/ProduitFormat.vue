<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import ContenantBadge from '@/components/catalogue/ContenantBadge.vue'

defineProps<{
  contenant?: string | null
  packaging?: string | null
  nowrap?: boolean
  /** Rupture de stock : les pastilles s'effacent avec le reste de la carte. */
  attenue?: boolean
}>()
</script>

<template>
  <div
    v-if="contenant || packaging"
    class="flex gap-1.5"
    :class="nowrap ? 'flex-nowrap' : 'flex-wrap'"
    aria-label="Format du produit"
  >
    <ContenantBadge :contenant="contenant" :attenue="attenue" />
    <!-- Le conditionnement reste neutre : une seule couleur par carte, sinon
         le code couleur du contenant ne ressort plus. -->
    <Badge v-if="packaging" variant="outline" :class="attenue ? 'text-muted-foreground' : ''">
      {{ packaging }}
    </Badge>
  </div>
</template>
