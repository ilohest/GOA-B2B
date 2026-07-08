<script setup lang="ts">
/**
 * Carte produit du catalogue client.
 *
 * - Emplacement image : `photoUrl` de l'override admin, sinon placeholder de
 *   marque (pastille GOA sur fond neutre).
 * - Rupture : produit TOUJOURS visible mais grisé (photo désaturée), mention
 *   « Victime de son succès » en rouge, pas de stepper.
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
    class="flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow"
    :class="produit.rupture ? 'opacity-75' : 'hover:shadow-md'"
  >
    <!-- Emplacement image (photo admin ou placeholder de marque) -->
    <div class="relative aspect-[4/3] w-full bg-muted">
      <img
        v-if="produit.photoUrl && !imageEnErreur"
        :src="produit.photoUrl"
        :alt="produit.libelle"
        loading="lazy"
        class="absolute inset-0 size-full object-cover"
        :class="produit.rupture ? 'grayscale' : ''"
        @error="imageEnErreur = true"
      />
      <div v-else class="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <img
          src="/brand/goa-rond.png"
          alt=""
          class="size-16 rounded-full opacity-25"
          :class="produit.rupture ? 'grayscale' : ''"
        />
      </div>
    </div>

    <div class="flex flex-1 flex-col justify-between gap-3 p-4">
      <div class="grid gap-1">
        <h3 class="font-medium" :class="produit.rupture ? 'text-muted-foreground' : ''">
          {{ produit.libelle }}
        </h3>
        <p v-if="produit.rupture" class="text-sm font-semibold text-destructive">
          Victime de son succès
        </p>
      </div>

      <div class="flex items-end justify-between gap-2">
        <p class="text-sm text-muted-foreground">
          <template v-if="produit.prixHT != null">
            <span
              class="text-base font-semibold"
              :class="produit.rupture ? 'text-muted-foreground' : 'text-foreground'"
            >
              {{ prixFr(produit.prixHT) }}
            </span>
            HT
          </template>
          <template v-else>Prix sur demande</template>
        </p>
        <QuantiteStepper
          v-if="!produit.rupture && produit.prixHT != null"
          :quantite="quantite"
          :pas="produit.pas"
          :libelle="produit.libelle"
          @changer="(delta) => emit('changer', delta)"
        />
      </div>
    </div>
  </article>
</template>
