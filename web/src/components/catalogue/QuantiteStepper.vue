<script setup lang="ts">
/**
 * Stepper de quantité en pilule, mobile-first (gros boutons tactiles).
 * `pas` = incrément imposé (ex. règle La Poste : 3 pour 35cl, 2 pour 1L).
 */
import { Info } from '@lucide/vue'
import IconTooltip from '@/components/admin/IconTooltip.vue'

const props = withDefaults(
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
  <div class="flex flex-col items-stretch gap-1.5">
    <div
      class="grid h-12 grid-cols-[3.25rem_1fr_3.25rem] items-center rounded-full border bg-background shadow-xs transition-colors"
      :class="quantite > 0 ? 'border-primary/40' : ''"
    >
      <button
        class="grid h-12 place-items-center rounded-full text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        :disabled="quantite === 0"
        :aria-label="`Retirer ${pluriel(props.pas)} de ${props.libelle}`"
        @click="emit('changer', -props.pas)"
      >
        {{ props.pas > 1 ? `−${props.pas}` : '−' }}
      </button>
      <span
        class="text-center text-lg font-semibold tabular-nums"
        :class="quantite > 0 ? 'text-primary' : ''"
        aria-live="polite"
      >
        {{ quantite }}
      </span>
      <button
        class="grid h-12 place-items-center rounded-full text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :aria-label="`Ajouter ${pluriel(props.pas)} de ${props.libelle}`"
        @click="emit('changer', props.pas)"
      >
        {{ props.pas > 1 ? `+${props.pas}` : '+' }}
      </button>
    </div>
    <div v-if="props.pas > 1" class="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <span>Cartons complets : par {{ props.pas }}</span>
      <IconTooltip
        :text="`Livraison La Poste : minimum ${props.pas} cartons pour ce format, puis commande par multiple de ${props.pas}.`"
      >
        <button
          type="button"
          class="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          :aria-label="`Pourquoi ${props.libelle} se commande par ${props.pas}`"
        >
          <Info class="size-3.5" />
        </button>
      </IconTooltip>
    </div>
  </div>
</template>
