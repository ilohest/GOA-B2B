<script setup lang="ts">
/**
 * Récapitulatif du panier — réutilisé par la colonne droite (desktop),
 * le volet dépliable de la barre mobile et le dialog de confirmation.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { Info, Trash2 } from "@lucide/vue";
import { useResizeObserver } from "@vueuse/core";
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
  /** Erreurs de multiples logistiques bloquant la validation du panier. */
  erreursConditionnement?: string[];
  /**
   * Montant de remise ESTIMÉ, fidèle à Easybeer (une remise par ligne =
   * ciblée-ou-globale, hors « remise 2 » en € qu'Easybeer n'applique pas).
   */
  remiseMontant?: number | null;
  /** Détail de la remise estimée, ligne par ligne. */
  remisesDetail?: DetailRemiseCiblee[];
  editable?: boolean;
  /** Contraint la liste à l'espace disponible et active son scroll interne. */
  defilementContraint?: boolean;
}>();

const emit = defineEmits<{
  changer: [idStockBouteille: number, delta: number];
  supprimer: [idStockBouteille: number];
  vider: [];
}>();

const aRemise = computed(() => (props.remiseMontant ?? 0) > 0);
const remisesParProduit = computed(
  () =>
    new Map(
      (props.remisesDetail ?? []).map((detail) => [
        detail.idStockBouteille,
        detail,
      ]),
    ),
);
const remisePour = (idStockBouteille: number) =>
  remisesParProduit.value.get(idStockBouteille);
const totalApresRemise = computed(
  () => props.totalHT - (props.remiseMontant ?? 0),
);
const tauxTVA = 0.055;
const montantTVA = computed(() => totalApresRemise.value * tauxTVA);
const totalTTC = computed(() => totalApresRemise.value + montantTVA.value);

const formatNombre = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
});

function contenanceEnLitres(contenant: string | null | undefined) {
  if (!contenant || !/bouteille/i.test(contenant)) return null;
  const resultat = contenant.match(/(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|l)\b/i);
  if (!resultat) return null;
  const valeur = Number(resultat[1].replace(",", "."));
  if (!Number.isFinite(valeur)) return null;
  const unite = resultat[2].toLowerCase();
  if (unite === "ml") return valeur / 1000;
  if (unite === "cl") return valeur / 100;
  if (unite === "dl") return valeur / 10;
  return valeur;
}

function bouteillesParArticle(packaging: string | null | undefined) {
  if (!packaging) return null;
  if (/\bunit[eé]\b/i.test(packaging)) return 1;
  const resultat = packaging.match(/\b(\d+)\b/);
  if (!resultat) return null;
  const quantite = Number(resultat[1]);
  return quantite > 0 ? quantite : null;
}

const recapBouteilles = computed(() => {
  const parContenance = new Map<number, number>();
  for (const ligne of props.lignes) {
    const contenanceLitres = contenanceEnLitres(ligne.contenant);
    const parArticle = bouteillesParArticle(ligne.packaging);
    if (contenanceLitres == null || parArticle == null) continue;
    parContenance.set(
      contenanceLitres,
      (parContenance.get(contenanceLitres) ?? 0) + ligne.quantite * parArticle,
    );
  }
  return [...parContenance.entries()]
    .map(([contenanceLitres, nbBouteilles]) => ({
      contenanceLitres,
      nbBouteilles,
      totalLitres: nbBouteilles * contenanceLitres,
    }))
    .sort((a, b) => a.contenanceLitres - b.contenanceLitres);
});

const totalLitresBouteilles = computed(() =>
  recapBouteilles.value.reduce((total, ligne) => total + ligne.totalLitres, 0),
);

const volumeFr = (litres: number) => `${formatNombre.format(litres)} L`;

const listeProduits = ref<HTMLElement | null>(null);
const listeDeborde = ref(false);
const listeEnBas = ref(true);

function mesurerScrollProduits() {
  const liste = listeProduits.value;
  if (!liste) {
    listeDeborde.value = false;
    listeEnBas.value = true;
    return;
  }
  listeDeborde.value = liste.scrollHeight > liste.clientHeight + 2;
  listeEnBas.value =
    liste.scrollTop + liste.clientHeight >= liste.scrollHeight - 2;
}

useResizeObserver(listeProduits, mesurerScrollProduits);
watch(
  () => [props.lignes.length, props.totalHT, props.remiseMontant],
  async () => {
    await nextTick();
    mesurerScrollProduits();
  },
);
onMounted(async () => {
  await nextTick();
  mesurerScrollProduits();
});
</script>

<template>
  <div
    class="flex min-h-0 min-w-0 flex-col gap-2"
    :class="defilementContraint ? 'overflow-hidden' : ''"
  >
    <p v-if="!lignes.length" class="text-sm text-muted-foreground">
      Votre panier est vide — ajoutez des articles depuis le catalogue.
    </p>
    <div v-if="editable && lignes.length" class="flex shrink-0 justify-end">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        @click="emit('vider')"
      >
        <Trash2 class="size-3.5" />
        Vider le panier
      </button>
    </div>
    <div
      class="relative min-w-0"
      :class="
        lignes.length && defilementContraint
          ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
          : ''
      "
    >
      <ul
        ref="listeProduits"
        class="grid min-w-0 pr-1 text-sm"
        :class="
          lignes.length && defilementContraint
            ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain'
            : ''
        "
        @scroll="mesurerScrollProduits"
      >
        <TransitionGroup name="panier-ligne">
          <li
            v-for="l in lignes"
            :key="l.idStockBouteille"
            class="grid min-w-0 gap-3 border-b border-border/60 py-3 first:pt-0"
          >
            <div class="grid min-w-0 gap-1">
              <div class="flex items-start justify-between gap-3">
                <span class="line-clamp-2 leading-snug">{{ l.libelle }}</span>
                <span
                  class="grid shrink-0 justify-items-end gap-0.5 whitespace-nowrap tabular-nums"
                >
                  <template v-if="remisePour(l.idStockBouteille)">
                    <span class="text-xs text-muted-foreground line-through">
                      {{ prixFr(l.sousTotal) }}
                    </span>
                    <span class="font-semibold text-primary">
                      {{
                        prixFr(
                          l.sousTotal - remisePour(l.idStockBouteille)!.montant,
                        )
                      }}
                    </span>
                  </template>
                  <span v-else class="font-medium">{{
                    prixFr(l.sousTotal)
                  }}</span>
                </span>
              </div>
              <ProduitFormat
                class="mt-0.5"
                :contenant="l.contenant"
                :packaging="l.packaging"
                nowrap
              />
              <Badge
                v-if="l.historique"
                variant="secondary"
                class="mt-0.5 w-fit"
              >
                Hors catalogue
              </Badge>
              <span class="text-muted-foreground">
                {{ l.quantite }} × {{ prixFr(l.prixUnitaireHT) }} HT
              </span>
            </div>

            <div
              v-if="remisePour(l.idStockBouteille)"
              class="flex items-center justify-between gap-3 rounded-md bg-primary/5 px-2.5 py-2 text-xs text-primary"
            >
              <Badge
                variant="secondary"
                class="border border-primary/15 bg-background text-primary"
              >
                Remise {{ remisePour(l.idStockBouteille)!.remiseLabel }}
              </Badge>
              <span class="shrink-0 whitespace-nowrap font-medium tabular-nums">
                − {{ prixFr(remisePour(l.idStockBouteille)!.montant) }}
              </span>
            </div>

            <div
              v-if="editable"
              class="flex items-center justify-between gap-2"
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
                  :disabled="
                    l.quantiteMaximum != null && l.quantite >= l.quantiteMaximum
                  "
                  :class="
                    l.quantiteMaximum != null && l.quantite >= l.quantiteMaximum
                      ? 'cursor-not-allowed opacity-35'
                      : ''
                  "
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
              class="text-xs text-muted-foreground"
            >
              Par {{ l.pas }} cartons
            </div>
            <p
              v-if="editable && l.quantiteMaximum != null"
              class="text-xs text-muted-foreground"
            >
              Ce produit n'est plus proposé actuellement : sa quantité peut être
              réduite, mais pas augmentée.
            </p>
          </li>
        </TransitionGroup>
      </ul>
      <div
        v-if="defilementContraint && listeDeborde && !listeEnBas"
        class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/95 to-transparent px-2 pt-8 pb-1"
        aria-hidden="true"
      >
        <span
          class="rounded-full border bg-background px-2.5 py-1 text-[0.68rem] font-medium text-muted-foreground shadow-sm"
        >
          Faites défiler pour voir les autres produits ↓
        </span>
      </div>
    </div>
    <ul
      v-if="lignes.length"
      class="relative z-10 grid shrink-0 gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-3 text-sm"
    >
      <li
        class="flex items-baseline justify-between gap-3"
        :class="aRemise ? 'text-sm' : 'font-semibold'"
      >
        <span>{{ aRemise ? "Sous-total HT" : "Total HT" }}</span>
        <span class="shrink-0 whitespace-nowrap tabular-nums">{{
          prixFr(totalHT)
        }}</span>
      </li>
      <template v-if="aRemise">
        <li class="flex items-baseline justify-between gap-3 text-primary">
          <span class="min-w-0 flex-1">Total des remises</span>
          <span class="shrink-0 whitespace-nowrap font-medium tabular-nums"
            >− {{ prixFr(remiseMontant!) }}</span
          >
        </li>
        <li class="flex items-baseline justify-between gap-3 font-semibold">
          <span>Total HT</span>
          <span class="shrink-0 whitespace-nowrap tabular-nums">{{
            prixFr(totalApresRemise)
          }}</span>
        </li>
      </template>
      <li
        class="flex items-baseline justify-between gap-3 text-muted-foreground"
      >
        <span>TVA (5,5 %)</span>
        <span class="shrink-0 whitespace-nowrap tabular-nums">{{
          prixFr(montantTVA)
        }}</span>
      </li>
      <li class="flex items-baseline justify-between gap-3 font-semibold">
        <span>Total TTC</span>
        <span class="shrink-0 whitespace-nowrap tabular-nums">{{
          prixFr(totalTTC)
        }}</span>
      </li>
    </ul>
    <div
      v-if="recapBouteilles.length"
      class="relative z-10 flex shrink-0 items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-950"
    >
      <Info class="mt-0.5 size-3.5 shrink-0 text-blue-600" />
      <p v-if="recapBouteilles.length === 1">
        <strong>{{ recapBouteilles[0].nbBouteilles }} bouteilles</strong>
        de {{ volumeFr(recapBouteilles[0].contenanceLitres) }}, soit
        <strong>{{ volumeFr(totalLitresBouteilles) }}</strong> de nectar divin
        au total.
      </p>
      <div v-else class="grid gap-1">
        <ul class="grid gap-0.5">
          <li v-for="ligne in recapBouteilles" :key="ligne.contenanceLitres">
            {{ ligne.nbBouteilles }} bouteilles de
            {{ volumeFr(ligne.contenanceLitres) }}
          </li>
        </ul>
        <p class="font-medium">
          Soit {{ volumeFr(totalLitresBouteilles) }} de nectar divin au total.
        </p>
      </div>
    </div>
    <p v-if="sousMinimum && minimum != null" class="text-xs text-destructive">
      Minimum de commande : {{ prixFr(minimum) }} HT
    </p>
    <p
      v-for="erreur in erreursConditionnement"
      :key="erreur"
      class="text-xs text-destructive"
    >
      {{ erreur }}
    </p>
    <slot />
  </div>
</template>

<style scoped>
.panier-ligne-enter-active,
.panier-ligne-leave-active,
.panier-ligne-move {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.panier-ligne-enter-from,
.panier-ligne-leave-to {
  opacity: 0;
  transform: translateX(10px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .panier-ligne-enter-active,
  .panier-ligne-leave-active,
  .panier-ligne-move {
    transition: none;
  }
}
</style>
