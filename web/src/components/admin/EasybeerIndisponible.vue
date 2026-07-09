<script setup lang="ts">
/**
 * Encart affiché quand une donnée admin n'est pas encore en cache et que l'API
 * Easybeer est momentanément saturée. Montre un compte à rebours, puis réactive
 * le bouton manuel une fois le ban levé.
 *
 * ⚠️ PAS d'auto-réessai : Easybeer re-bannit sur presque chaque appel quand il
 * est saturé, et un réessai automatique entretiendrait le ban en boucle. La
 * synchro périodique (prod) remplit le cache proactivement.
 */
import { computed } from 'vue'
import { useEasybeerBan } from '@/composables/useEasybeerBan'
import { Button } from '@/components/ui/button'

defineProps<{ pending?: boolean }>()
const emit = defineEmits<{ reessayer: [] }>()

const { banni, secondesRestantes } = useEasybeerBan()

const compte = computed(() => {
  const s = secondesRestantes.value
  if (s <= 0) return ''
  const min = Math.floor(s / 60)
  return min > 0 ? `${min} min ${s % 60} s` : `${s} s`
})
</script>

<template>
  <div class="grid justify-items-center gap-3 rounded-lg border border-dashed p-6 text-center">
    <p class="text-sm text-muted-foreground">
      Ces données ne sont pas encore en cache et l'API Easybeer est momentanément saturée.
      <template v-if="banni"><br />Patientez {{ compte }} avant de réessayer.</template>
    </p>
    <Button variant="outline" size="sm" :disabled="pending || banni" @click="emit('reessayer')">
      {{ pending ? 'Chargement…' : banni ? `Réessayez dans ${compte}` : 'Réessayer maintenant' }}
    </Button>
  </div>
</template>
