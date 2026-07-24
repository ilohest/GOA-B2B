<script setup lang="ts">
/**
 * Stepper de quantité en pilule, mobile-first (gros boutons tactiles).
 * `pas` = incrément éventuellement imposé à un article (1 par défaut).
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, Info } from '@lucide/vue'
import IconTooltip from '@/components/admin/IconTooltip.vue'

const props = withDefaults(
  defineProps<{
    quantite: number
    pas?: number
    libelle?: string
  }>(),
  { pas: 1, libelle: 'ce produit' },
)

const emit = defineEmits<{
  changer: [delta: number]
  fixer: [quantite: number]
}>()

const saisie = ref(String(props.quantite))
const ajoutAnime = ref(false)
const ajoutConfirme = ref(false)
let minuteurAnimation: ReturnType<typeof setTimeout> | null = null
let minuteurConfirmation: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.quantite,
  async (quantite, precedente) => {
    saisie.value = String(quantite)
    if (quantite <= precedente) return

    ajoutAnime.value = false
    await nextTick()
    ajoutAnime.value = true
    if (minuteurAnimation) clearTimeout(minuteurAnimation)
    minuteurAnimation = setTimeout(() => {
      ajoutAnime.value = false
      minuteurAnimation = null
    }, 320)
  },
)

onBeforeUnmount(() => {
  if (minuteurAnimation) clearTimeout(minuteurAnimation)
  if (minuteurConfirmation) clearTimeout(minuteurConfirmation)
})

function ajouter() {
  ajoutConfirme.value = true
  if (minuteurConfirmation) clearTimeout(minuteurConfirmation)
  minuteurConfirmation = setTimeout(() => {
    ajoutConfirme.value = false
    minuteurConfirmation = null
  }, 850)
  emit('changer', props.pas)
}

function validerSaisie() {
  const valeur = Number(saisie.value)
  const pas = Math.max(1, Math.floor(props.pas))
  const quantite = Number.isFinite(valeur) && valeur > 0
    ? Math.ceil(Math.floor(valeur) / pas) * pas
    : 0

  saisie.value = String(quantite)
  if (quantite !== props.quantite) emit('fixer', quantite)
}

const pluriel = (n: number) => (n > 1 ? `${n} cartons` : 'un carton')
</script>

<template>
  <div class="flex flex-col items-stretch gap-1.5">
    <div
      class="grid h-10 grid-cols-[2.75rem_1fr_2.75rem] items-center rounded-full border bg-background shadow-xs transition-colors"
      :class="[
        quantite > 0 ? 'border-primary/40' : '',
        ajoutAnime ? 'quantite-ajoutee' : '',
      ]"
    >
      <button
        type="button"
        class="grid h-10 place-items-center rounded-full text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        :disabled="quantite === 0"
        :aria-label="`Retirer ${pluriel(props.pas)} de ${props.libelle}`"
        @click="emit('changer', -props.pas)"
      >
        {{ props.pas > 1 ? `−${props.pas}` : '−' }}
      </button>
      <input
        v-model="saisie"
        type="number"
        inputmode="numeric"
        min="0"
        :step="props.pas"
        class="h-9 w-full appearance-none border-0 bg-transparent px-1 text-center text-base font-semibold tabular-nums outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        :class="quantite > 0 ? 'text-primary' : ''"
        :aria-label="`Quantité de ${props.libelle}`"
        @blur="validerSaisie"
        @change="validerSaisie"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      />
      <button
        type="button"
        class="grid h-10 place-items-center rounded-full text-sm font-medium transition-[color,background-color,transform] duration-200 active:scale-[0.94]"
        :class="
          ajoutConfirme
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        "
        :aria-label="`Ajouter ${pluriel(props.pas)} de ${props.libelle}`"
        @click="ajouter"
      >
        <Check v-if="ajoutConfirme" class="size-4" aria-hidden="true" />
        <template v-else>{{ props.pas > 1 ? `+${props.pas}` : '+' }}</template>
      </button>
    </div>
    <span class="sr-only" role="status" aria-live="polite">
      {{ ajoutConfirme ? `${pluriel(props.pas)} ajouté au panier` : '' }}
    </span>
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

<style scoped>
.quantite-ajoutee {
  animation: quantite-ajoutee 300ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes quantite-ajoutee {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgb(40 153 72 / 0%);
  }
  45% {
    transform: translateY(-1px) scale(1.015);
    box-shadow: 0 0 0 4px rgb(40 153 72 / 12%);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgb(40 153 72 / 0%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .quantite-ajoutee {
    animation: none;
  }
}
</style>
