<script setup lang="ts">
/**
 * Récapitulatif du panier — réutilisé par la colonne droite (desktop),
 * le volet dépliable de la barre mobile et le dialog de confirmation.
 */
import { computed } from "vue";
import { Trash2 } from "@lucide/vue";
import { prixFr } from "@/lib/format";
import type { DetailRemiseCiblee } from "@/lib/remises";
import { Badge } from "@/components/ui/badge";
import ProduitFormat from "@/components/catalogue/ProduitFormat.vue";

export interface LignePanier {
  idStockBouteille: number;
  idProduit?: number | null;
  idContenant?: number | null;
  idLot?: number | null;
  libelle: string;
  contenant?: string | null;
  packaging?: string | null;
  photoUrl?: string | null;
  prixUnitaireHT: number;
  pas?: number;
  quantite: number;
  historique?: boolean;
  quantiteMaximum?: number;
  sousTotal: number;
}

const props = defineProps<{
  lignes: LignePanier[];
  totalHT: number;
  minimum: number | null;
  sousMinimum: boolean;
  /**
   * Montant de remise ESTIMÉ, fidèle à Easybeer (une remise par ligne =
   * ciblée-ou-globale, hors « remise 2 » en € qu'Easybeer n'applique pas).
   */
  remiseMontant?: number | null;
  /** Détail de la remise estimée, ligne par ligne. */
  remisesDetail?: DetailRemiseCiblee[];
  editable?: boolean;
}>();

const emit = defineEmits<{
  changer: [idStockBouteille: number, delta: number];
  supprimer: [idStockBouteille: number];
}>();

const aRemise = computed(() => (props.remiseMontant ?? 0) > 0);
const totalApresRemise = computed(() => props.totalHT - (props.remiseMontant ?? 0));
const tauxTVA = 0.055;
const montantTVA = computed(() => totalApresRemise.value * tauxTVA);
const totalTTC = computed(() => totalApresRemise.value + montantTVA.value);
</script>

<template>
  <div class="grid min-w-0 gap-2">
    <p v-if="!lignes.length" class="text-sm text-muted-foreground">
      Votre panier est vide — ajoutez des cartons depuis le catalogue.
    </p>
    <ul v-else class="grid min-w-0 text-sm">
      <li
        v-for="l in lignes"
        :key="l.idStockBouteille"
        class="grid min-w-0 gap-3 border-b border-border/60 py-3 first:pt-0"
      >
        <div class="flex items-start justify-between gap-3">
          <span class="flex min-w-0 flex-1 items-start gap-2.5">
            <span
              class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/50"
            >
              <img
                v-if="l.photoUrl"
                :src="l.photoUrl"
                :alt="l.libelle"
                class="size-full object-cover"
                loading="lazy"
              />
              <span
                v-else
                class="grid size-full place-items-center bg-gradient-to-br from-brand-50 to-muted"
                aria-hidden="true"
              >
                <img
                  src="/brand/goa-rond.png"
                  alt=""
                  class="size-7 rounded-full opacity-30"
                />
              </span>
            </span>
            <span class="min-w-0">
              <span class="line-clamp-2 leading-snug">{{ l.libelle }}</span>
              <ProduitFormat
                class="mt-1"
                :contenant="l.contenant"
                :packaging="l.packaging"
              />
              <Badge v-if="l.historique" variant="secondary" class="mt-1">
                Hors catalogue
              </Badge>
              <span class="mt-1 block text-muted-foreground">
                {{ l.quantite }} × {{ prixFr(l.prixUnitaireHT) }} HT
              </span>
            </span>
          </span>
          <span class="shrink-0 whitespace-nowrap font-medium tabular-nums">{{
            prixFr(l.sousTotal)
          }}</span>
        </div>

        <div
          v-if="editable"
          class="ml-12 flex items-center justify-between gap-2"
        >
          <div
            class="inline-grid h-8 grid-cols-[2rem_2.5rem_2rem] items-center rounded-full border bg-background"
          >
            <button
              type="button"
              class="grid h-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              :aria-label="`Retirer ${l.pas ?? 1} de ${l.libelle}`"
              @click="emit('changer', l.idStockBouteille, -(l.pas ?? 1))"
            >
              {{ (l.pas ?? 1) > 1 ? `−${l.pas}` : "−" }}
            </button>
            <span class="text-center font-semibold tabular-nums">{{
              l.quantite
            }}</span>
            <button
              type="button"
              class="grid h-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              :aria-label="`Ajouter ${l.pas ?? 1} à ${l.libelle}`"
              :disabled="l.quantiteMaximum != null && l.quantite >= l.quantiteMaximum"
              :class="l.quantiteMaximum != null && l.quantite >= l.quantiteMaximum ? 'cursor-not-allowed opacity-35' : ''"
              @click="emit('changer', l.idStockBouteille, l.pas ?? 1)"
            >
              {{ (l.pas ?? 1) > 1 ? `+${l.pas}` : "+" }}
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

        <div
          v-if="editable && (l.pas ?? 1) > 1"
          class="ml-12 text-xs text-muted-foreground"
        >
          Par {{ l.pas }} cartons
        </div>
        <p
          v-if="editable && l.quantiteMaximum != null"
          class="ml-12 text-xs text-muted-foreground"
        >
          Ce produit n'est plus proposé actuellement : sa quantité peut être réduite, mais pas augmentée.
        </p>
      </li>
      <li
        class="flex items-baseline justify-between gap-3 pt-3"
        :class="aRemise ? 'text-sm' : 'font-semibold'"
      >
        <span>{{ aRemise ? "Sous-total HT" : "Total HT" }}</span>
        <span class="shrink-0 whitespace-nowrap tabular-nums">{{ prixFr(totalHT) }}</span>
      </li>
      <template v-if="aRemise">
        <li class="grid gap-1 text-primary">
          <div class="flex items-baseline justify-between gap-3">
            <span class="min-w-0 flex-1">Remise</span>
            <span class="shrink-0 whitespace-nowrap font-medium tabular-nums">− {{ prixFr(remiseMontant!) }}</span>
          </div>
          <div
            v-for="detail in remisesDetail"
            :key="detail.idStockBouteille"
            class="ml-3 flex items-baseline justify-between gap-3 text-xs text-muted-foreground"
          >
            <span class="min-w-0 flex-1">
              <span class="line-clamp-1">{{ detail.libelle }}</span>
              <ProduitFormat
                class="mt-1"
                :contenant="detail.contenant"
                :packaging="detail.packaging"
              />
              <Badge variant="secondary" class="mt-1 text-primary">
                {{ detail.remiseLabel }}
              </Badge>
            </span>
            <span class="shrink-0 whitespace-nowrap tabular-nums">− {{ prixFr(detail.montant) }}</span>
          </div>
        </li>
        <li class="flex items-baseline justify-between gap-3 font-semibold">
          <span>Total HT</span>
          <span class="shrink-0 whitespace-nowrap tabular-nums">{{ prixFr(totalApresRemise) }}</span>
        </li>
      </template>
      <li class="flex items-baseline justify-between gap-3 text-muted-foreground">
        <span>TVA (5,5 %)</span>
        <span class="shrink-0 whitespace-nowrap tabular-nums">{{ prixFr(montantTVA) }}</span>
      </li>
      <li class="flex items-baseline justify-between gap-3 font-semibold">
        <span>Total TTC</span>
        <span class="shrink-0 whitespace-nowrap tabular-nums">{{ prixFr(totalTTC) }}</span>
      </li>
    </ul>
    <p v-if="sousMinimum && minimum != null" class="text-xs text-destructive">
      Minimum de commande : {{ prixFr(minimum) }} HT
    </p>
    <slot />
  </div>
</template>
