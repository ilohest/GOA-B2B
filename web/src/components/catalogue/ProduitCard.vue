<script setup lang="ts">
/**
 * Carte produit du catalogue client (rendu premium).
 *
 * - Emplacement image : `photoUrl` de l'override admin, sinon placeholder de
 *   marque (pastille GOA sur fond doux).
 * - Rupture / prix expiré : produit visible mais pas commandable.
 */
import { ref } from 'vue'
import type { ProduitCatalogueClient } from '@/lib/types'
import { prixFr } from '@/lib/format'
import QuantiteStepper from '@/components/catalogue/QuantiteStepper.vue'

defineProps<{
  produit: ProduitCatalogueClient
  quantite: number
}>()

const emit = defineEmits<{ changer: [delta: number] }>()

// Si l'URL de photo est cassée, on retombe proprement sur le placeholder.
const imageEnErreur = ref(false)
</script>

<template>
  <article
    class="group flex h-full flex-col rounded-2xl border bg-card shadow-sm transition-all duration-200"
    :class="
      produit.rupture
        ? 'opacity-80'
        : 'hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg'
    "
  >
    <!-- Emplacement image (photo admin ou placeholder de marque) -->
    <div class="relative aspect-[4/3] w-full overflow-hidden rounded-t-2xl bg-muted">
      <img
        v-if="produit.photoUrl && !imageEnErreur"
        :src="produit.photoUrl"
        :alt="produit.libelle"
        loading="lazy"
        class="absolute inset-0 size-full object-cover transition-transform duration-300"
        :class="produit.rupture ? 'grayscale' : 'group-hover:scale-[1.03]'"
        @error="imageEnErreur = true"
      />
      <div
        v-else
        class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand-50 to-muted"
        aria-hidden="true"
      >
        <img
          src="/brand/goa-rond.png"
          alt=""
          class="size-16 rounded-full opacity-30"
          :class="produit.rupture ? 'grayscale' : ''"
        />
      </div>
      <span
        v-if="produit.rupture"
        class="absolute top-3 left-3 rounded-full bg-background/90 px-2.5 py-1 text-xs font-semibold text-destructive shadow-sm backdrop-blur"
      >
        Victime de son succès
      </span>
    </div>

    <div class="flex flex-1 flex-col gap-5 p-5">
      <h3 class="min-h-12 text-base leading-snug font-semibold" :class="produit.rupture ? 'text-muted-foreground' : ''">
        {{ produit.libelle }}
      </h3>

      <!-- Prix + ajout au panier, en bas de carte -->
      <div class="mt-auto grid gap-4">
        <div
          v-if="produit.prixHT != null && produit.prixEstFrais"
          class="flex min-h-12 items-end justify-between gap-4 rounded-xl bg-muted/35 px-3 py-2.5"
        >
          <span class="grid gap-0.5">
            <span class="text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">
              Prix carton
            </span>
            <span
              class="text-2xl leading-none font-semibold tabular-nums tracking-tight"
              :class="produit.rupture ? 'text-muted-foreground' : ''"
            >
              {{ prixFr(produit.prixHT) }}
            </span>
          </span>
          <span class="pb-0.5 text-sm whitespace-nowrap text-muted-foreground">HT</span>
        </div>
        <QuantiteStepper
          v-if="!produit.rupture && produit.prixHT != null && produit.prixEstFrais"
          class="w-full"
          :quantite="quantite"
          :pas="produit.pas"
          :libelle="produit.libelle"
          @changer="(delta) => emit('changer', delta)"
        />
      </div>
      <p v-if="produit.prixHT == null || !produit.prixEstFrais" class="text-xs text-amber-700">
        Commande temporairement indisponible pour ce produit.
      </p>
    </div>
  </article>
</template>
