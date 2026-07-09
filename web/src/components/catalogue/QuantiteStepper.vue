<script setup lang="ts">
/**
 * Stepper de quantité en pilule, mobile-first (gros boutons tactiles).
 * `pas` = incrément imposé (ex. règle La Poste : 3 pour 35cl, 2 pour 1L).
 */
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
    <div
      class="inline-flex items-center rounded-full border bg-background shadow-xs transition-colors"
      :class="quantite > 0 ? 'border-primary/40' : ''"
    >
      <button
        class="grid size-10 place-items-center rounded-full text-lg text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        :disabled="quantite === 0"
        :aria-label="`Retirer ${pluriel(pas)} de ${libelle}`"
        @click="emit('changer', -pas)"
      >
        −
      </button>
      <span
        class="w-8 text-center text-base font-semibold tabular-nums"
        :class="quantite > 0 ? 'text-primary' : ''"
        aria-live="polite"
      >
        {{ quantite }}
      </span>
      <button
        class="grid size-10 place-items-center rounded-full text-lg text-muted-foreground transition-colors hover:text-foreground"
        :aria-label="`Ajouter ${pluriel(pas)} de ${libelle}`"
        @click="emit('changer', pas)"
      >
        +
      </button>
    </div>
    <p v-if="pas > 1" class="text-xs text-muted-foreground">par {{ pas }} (La Poste)</p>
  </div>
</template>
