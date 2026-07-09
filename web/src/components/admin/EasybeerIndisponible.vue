<script setup lang="ts">
/**
 * Encart affiché quand une donnée admin n'est pas encore en cache et que l'API
 * Easybeer est momentanément saturée. Montre un compte à rebours et réessaie
 * automatiquement quand le ban se lève.
 */
import { computed, watch } from 'vue'
import { useEasybeerBan } from '@/composables/useEasybeerBan'
import { Button } from '@/components/ui/button'

const props = defineProps<{ pending?: boolean }>()
const emit = defineEmits<{ reessayer: [] }>()

const { banni, secondesRestantes } = useEasybeerBan()

const compte = computed(() => {
  const s = secondesRestantes.value
  if (s <= 0) return ''
  const min = Math.floor(s / 60)
  return min > 0 ? `${min} min ${s % 60} s` : `${s} s`
})

// Auto-réessai dès que le ban se lève (transition banni → libre).
watch(banni, (estBanni, avant) => {
  if (avant && !estBanni && !props.pending) emit('reessayer')
})
</script>

<template>
  <div class="grid justify-items-center gap-3 rounded-lg border border-dashed p-6 text-center">
    <p class="text-sm text-muted-foreground">
      Ces données ne sont pas encore en cache et l'API Easybeer est momentanément saturée.
      <template v-if="banni"><br />Réessai automatique dans {{ compte }}.</template>
    </p>
    <Button variant="outline" size="sm" :disabled="pending || banni" @click="emit('reessayer')">
      {{ pending ? 'Chargement…' : banni ? `Réessayez dans ${compte}` : 'Réessayer maintenant' }}
    </Button>
  </div>
</template>
