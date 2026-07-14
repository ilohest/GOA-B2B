<script setup lang="ts">
/**
 * Récapitulatif du panier — réutilisé par la colonne droite (desktop),
 * le volet dépliable de la barre mobile et le dialog de confirmation.
 */
import { computed } from 'vue'
import { Trash2 } from '@lucide/vue'
import { prixFr } from '@/lib/format'
import type { DetailRemiseCiblee } from '@/lib/remises'

export interface LignePanier {
  idStockBouteille: number
  idProduit?: number | null
  idContenant?: number | null
  idLot?: number | null
  libelle: string
  photoUrl?: string | null
  prixUnitaireHT: number
  pas?: number
  quantite: number
  sousTotal: number
}

const props = defineProps<{
  lignes: LignePanier[]
  totalHT: number
  minimum: number | null
  sousMinimum: boolean
  /** Conditions de remise du client, ex. « 12 % + 5 % additionnelle ». */
  remiseLabel?: string | null
  /** Montant de remise ESTIMÉ sur le sous-total (remises globales). */
  remiseMontant?: number | null
  /** Montant de remise ESTIMÉ sur les remises ciblées produit/lot. */
  remiseCibleeMontant?: number | null
  /** Détail des remises ciblées appliquées, ligne par ligne. */
  remisesCibleesDetail?: DetailRemiseCiblee[]
  editable?: boolean
}>()

const emit = defineEmits<{
  changer: [idStockBouteille: number, delta: number]
  supprimer: [idStockBouteille: number]
}>()

const aRemise = computed(() => (props.remiseMontant ?? 0) > 0)
const remiseCibleeTotale = computed(() =>
  props.remisesCibleesDetail?.length
    ? props.remisesCibleesDetail.reduce((total, detail) => total + detail.montant, 0)
    : (props.remiseCibleeMontant ?? 0),
)
const aRemiseCiblee = computed(() => remiseCibleeTotale.value > 0)
const aDesRemises = computed(() => aRemise.value || aRemiseCiblee.value)
const totalApresRemise = computed(() =>
  props.totalHT - (props.remiseMontant ?? 0) - remiseCibleeTotale.value,
)
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
        class="grid gap-2"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="flex min-w-0 flex-1 items-center gap-2.5">
            <span class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/50">
              <img
                v-if="l.photoUrl"
                :src="l.photoUrl"
                :alt="l.libelle"
                class="size-full object-cover"
                loading="lazy"
              >
              <span
                v-else
                class="grid size-full place-items-center bg-gradient-to-br from-brand-50 to-muted"
                aria-hidden="true"
              >
                <img src="/brand/goa-rond.png" alt="" class="size-7 rounded-full opacity-30">
              </span>
            </span>
            <span class="min-w-0">
              <span class="line-clamp-2 leading-snug">{{ l.libelle }}</span>
              <span class="text-muted-foreground">
                {{ l.quantite }} × {{ prixFr(l.prixUnitaireHT) }} HT
              </span>
            </span>
          </span>
          <span class="font-medium tabular-nums">{{ prixFr(l.sousTotal) }}</span>
        </div>

        <div v-if="editable" class="ml-12 flex items-center justify-between gap-2">
          <div class="inline-grid h-8 grid-cols-[2rem_2.5rem_2rem] items-center rounded-full border bg-background">
            <button
              type="button"
              class="grid h-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              :aria-label="`Retirer ${l.pas ?? 1} de ${l.libelle}`"
              @click="emit('changer', l.idStockBouteille, -(l.pas ?? 1))"
            >
              {{ (l.pas ?? 1) > 1 ? `−${l.pas}` : '−' }}
            </button>
            <span class="text-center font-semibold tabular-nums">{{ l.quantite }}</span>
            <button
              type="button"
              class="grid h-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              :aria-label="`Ajouter ${l.pas ?? 1} à ${l.libelle}`"
              @click="emit('changer', l.idStockBouteille, l.pas ?? 1)"
            >
              {{ (l.pas ?? 1) > 1 ? `+${l.pas}` : '+' }}
            </button>
          </div>
          <button
            type="button"
            class="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            :aria-label="`Supprimer ${l.libelle}`"
            @click="emit('supprimer', l.idStockBouteille)"
          >
            <Trash2 class="size-4" />
          </button>
        </div>

        <div v-if="editable && (l.pas ?? 1) > 1" class="ml-12 text-xs text-muted-foreground">
          Par {{ l.pas }} cartons
        </div>
      </li>
      <li
        class="flex items-baseline justify-between gap-3 border-t pt-2"
        :class="aDesRemises ? 'text-sm' : 'font-semibold'"
      >
        <span>{{ aDesRemises ? 'Sous-total HT' : 'Total HT' }}</span>
        <span class="tabular-nums">{{ prixFr(totalHT) }}</span>
      </li>
      <template v-if="aDesRemises">
        <li v-if="aRemise" class="flex items-baseline justify-between gap-3 text-primary">
          <span class="min-w-0 flex-1">
            Votre remise
            <span v-if="remiseLabel" class="text-muted-foreground">({{ remiseLabel }})</span>
          </span>
          <span class="font-medium tabular-nums">− {{ prixFr(remiseMontant!) }}</span>
        </li>
        <li v-if="aRemiseCiblee" class="grid gap-1 text-primary">
          <div class="flex items-baseline justify-between gap-3">
            <span class="min-w-0 flex-1">Remises produits</span>
            <span class="font-medium tabular-nums">− {{ prixFr(remiseCibleeTotale) }}</span>
          </div>
          <div
            v-for="detail in remisesCibleesDetail"
            :key="detail.idStockBouteille"
            class="ml-3 flex items-baseline justify-between gap-3 text-xs text-muted-foreground"
          >
            <span class="min-w-0 flex-1">
              <span class="line-clamp-1">{{ detail.libelle }}</span>
              <span>{{ detail.remiseLabel }}</span>
            </span>
            <span class="tabular-nums">− {{ prixFr(detail.montant) }}</span>
          </div>
        </li>
        <li class="flex items-baseline justify-between gap-3 font-semibold">
          <span>Total HT estimé</span>
          <span class="tabular-nums">{{ prixFr(totalApresRemise) }}</span>
        </li>
      </template>
    </ul>
    <p class="text-xs text-muted-foreground">
      <template v-if="aRemise">
        Remise estimée sur vos conditions habituelles — le total définitif figurera sur votre facture GOA.
      </template>
      <template v-else-if="aRemiseCiblee">
        Remises produits estimées selon vos conditions habituelles — le total définitif figurera sur votre facture GOA.
      </template>
      <template v-else>
        Montant indicatif, hors remises éventuelles — le total définitif figurera sur votre facture GOA.
      </template>
    </p>
    <p v-if="sousMinimum && minimum != null" class="text-xs text-destructive">
      Minimum de commande : {{ prixFr(minimum) }} HT
    </p>
    <slot />
  </div>
</template>
