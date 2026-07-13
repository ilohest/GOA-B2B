<script setup lang="ts">
/**
 * Bouton d'actualisation / synchronisation Easybeer : se désactive avec un
 * compte à rebours tant que l'API est bannie (évite de retaper l'API et de
 * prolonger le ban).
 */
import { computed } from 'vue'
import { useEasybeerBan } from '@/composables/useEasybeerBan'
import { Button } from '@/components/ui/button'

const props = withDefaults(
  defineProps<{
    pending?: boolean
    label?: string
    labelPending?: string
    variant?: 'outline' | 'secondary'
  }>(),
  { pending: false, label: 'Actualiser depuis Easybeer', labelPending: 'Actualisation…', variant: 'outline' },
)

const emit = defineEmits<{ click: [] }>()

const { banni, secondesRestantes } = useEasybeerBan()

const texte = computed(() => {
  if (banni.value) return `Réessayez dans ${secondesRestantes.value} s`
  return props.pending ? props.labelPending : props.label
})
</script>

<template>
  <Button
    :variant="variant"
    size="sm"
    class="border border-border bg-background font-medium shadow-sm hover:bg-muted"
    :disabled="pending || banni"
    :title="banni ? 'API Easybeer momentanément saturée' : undefined"
    @click="emit('click')"
  >
    {{ texte }}
  </Button>
</template>
