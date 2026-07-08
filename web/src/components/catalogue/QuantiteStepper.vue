<script setup lang="ts">
/**
 * Stepper de quantité mobile-first (gros boutons tactiles).
 * `pas` = incrément imposé (ex. règle La Poste : 3 pour 35cl, 2 pour 1L).
 */
import { Button } from '@/components/ui/button'

withDefaults(
  defineProps<{
    quantite: number
    pas?: number
    libelle?: string
  }>(),
  { pas: 1, libelle: 'ce produit' },
)

const emit = defineEmits<{ changer: [delta: number] }>()

const pluriel = (n: number) => (n > 1 ? `${n} cartons` : 'un carton')
</script>

<template>
  <div class="flex flex-col items-end gap-1">
    <div class="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        class="size-10 text-lg"
        :disabled="quantite === 0"
        :aria-label="`Retirer ${pluriel(pas)} de ${libelle}`"
        @click="emit('changer', -pas)"
      >
        −
      </Button>
      <span class="w-8 text-center text-base font-semibold tabular-nums" aria-live="polite">
        {{ quantite }}
      </span>
      <Button
        variant="outline"
        size="icon"
        class="size-10 text-lg"
        :aria-label="`Ajouter ${pluriel(pas)} de ${libelle}`"
        @click="emit('changer', pas)"
      >
        +
      </Button>
    </div>
    <p v-if="pas > 1" class="text-xs text-muted-foreground">par {{ pas }} (La Poste)</p>
  </div>
</template>
