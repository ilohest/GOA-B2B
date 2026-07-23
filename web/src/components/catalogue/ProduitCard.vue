<script setup lang="ts">
/** Carte de commande B2B compacte : identification, prix et quantité. */
import type { ProduitCatalogueClient } from '@/lib/types'
import { prixFr } from '@/lib/format'
import ProduitFormat from '@/components/catalogue/ProduitFormat.vue'
import ProduitVignette from '@/components/catalogue/ProduitVignette.vue'
import QuantiteStepper from '@/components/catalogue/QuantiteStepper.vue'

defineProps<{
  produit: ProduitCatalogueClient
  quantite: number
}>()

const emit = defineEmits<{
  changer: [delta: number]
  fixer: [quantite: number]
}>()
</script>

<template>
  <article
    class="flex h-full flex-col rounded-lg border bg-card shadow-xs transition-colors"
    :class="
      produit.rupture
        ? 'opacity-80'
        : 'hover:border-primary/30'
    "
  >
    <div class="flex items-start gap-3 p-3">
      <!-- La photo reste un repère visuel secondaire. -->
      <ProduitVignette
        :photo-url="produit.photoUrl"
        :libelle="produit.libelle"
        :grise="produit.rupture"
      />

      <div class="min-w-0 flex-1">
        <div>
          <h3
            class="line-clamp-2 text-sm leading-snug font-semibold"
            :class="produit.rupture ? 'text-muted-foreground' : ''"
          >
            {{ produit.libelle }}
          </h3>
        </div>
        <ProduitFormat
          class="mt-2"
          :contenant="produit.contenant"
          :packaging="produit.packaging"
        />
      </div>
    </div>

    <!-- Prix et quantité : les deux actions principales du catalogue B2B. -->
    <div class="mt-auto grid gap-2 border-t p-3">
      <div class="grid gap-2">
        <div
          v-if="produit.prixHT != null && produit.prixEstFrais"
          class="flex items-center justify-between gap-3"
        >
          <span class="text-xs text-muted-foreground">Prix carton HT</span>
          <span
            class="text-lg leading-none font-semibold tabular-nums tracking-tight"
            :class="produit.rupture ? 'text-muted-foreground' : ''"
          >
            {{ prixFr(produit.prixHT) }}
          </span>
        </div>
        <div
          v-if="produit.rupture"
          class="flex h-10 w-full items-center justify-center rounded-full border border-destructive/20 bg-destructive/10 px-3 text-xs font-semibold text-destructive"
        >
          Victime de son succès
        </div>
        <QuantiteStepper
          v-else-if="produit.prixHT != null && produit.prixEstFrais"
          class="w-full"
          :quantite="quantite"
          :pas="produit.pas"
          :libelle="produit.libelle"
          @changer="(delta) => emit('changer', delta)"
          @fixer="(quantite) => emit('fixer', quantite)"
        />
      </div>
      <p
        v-if="produit.prixHT == null || !produit.prixEstFrais"
        class="text-xs text-amber-700"
      >
        Commande temporairement indisponible pour ce produit.
      </p>
    </div>
  </article>
</template>
