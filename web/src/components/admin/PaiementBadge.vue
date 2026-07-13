<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ paiement: string | null }>()

const normalise = computed(() =>
  (props.paiement ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase(),
)

const etatPaiement = computed(() => {
  const p = normalise.value
  if (!p) return 'attente'
  if (p.includes('non') || p.includes('impaye') || p.includes('refuse') || p.includes('echec')) return 'non-paye'
  if (p.includes('attente') || p.includes('partiel') || p.includes('cours')) return 'attente'
  if (p.includes('paye') || p.includes('regle') || p.includes('solde')) return 'paye'
  return 'attente'
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
    :class="{
      'border-emerald-200 bg-emerald-50 text-emerald-700': etatPaiement === 'paye',
      'border-red-200 bg-red-50 text-red-700': etatPaiement === 'non-paye',
      'border-zinc-200 bg-zinc-50 text-zinc-600': etatPaiement === 'attente',
    }"
  >
    <span
      class="size-1.5 rounded-full"
      :class="{
        'bg-emerald-500': etatPaiement === 'paye',
        'bg-red-500': etatPaiement === 'non-paye',
        'bg-zinc-400': etatPaiement === 'attente',
      }"
    />
    {{ paiement ?? 'En attente' }}
  </span>
</template>
