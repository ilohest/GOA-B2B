<script setup lang="ts">
/**
 * Récapitulatif du panier — réutilisé par la colonne droite (desktop),
 * le volet dépliable de la barre mobile et le dialog de confirmation.
 */
import { prixFr } from '@/lib/format'

export interface LignePanier {
  idStockBouteille: number
  libelle: string
  quantite: number
  sousTotal: number
}

defineProps<{
  lignes: LignePanier[]
  totalHT: number
  minimum: number | null
  sousMinimum: boolean
}>()
</script>

<template>
  <div class="grid gap-2">
    <p v-if="!lignes.length" class="text-sm text-muted-foreground">
      Votre panier est vide — ajoutez des cartons depuis le catalogue.
    </p>
    <ul v-else class="grid gap-1.5 text-sm">
      <li
        v-for="l in lignes"
        :key="l.idStockBouteille"
        class="flex items-baseline justify-between gap-3"
      >
        <span class="min-w-0 flex-1">{{ l.libelle }} <span class="text-muted-foreground">× {{ l.quantite }}</span></span>
        <span class="font-medium tabular-nums">{{ prixFr(l.sousTotal) }}</span>
      </li>
      <li class="flex items-baseline justify-between gap-3 border-t pt-2 font-semibold">
        <span>Total HT</span>
        <span class="tabular-nums">{{ prixFr(totalHT) }}</span>
      </li>
    </ul>
    <p class="text-xs text-muted-foreground">
      Montant indicatif, hors remises et consigne éventuelles — le total définitif figurera sur
      votre facture GOA.
    </p>
    <p v-if="sousMinimum && minimum != null" class="text-xs text-destructive">
      Minimum de commande : {{ prixFr(minimum) }} HT
    </p>
    <slot />
  </div>
</template>
