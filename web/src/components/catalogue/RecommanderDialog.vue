<script setup lang="ts">
/**
 * Récap « Recommander » : montre au client ce qui sera réellement remis au
 * panier avant d'y toucher. Une commande n'est jamais réinjectée en silence —
 * cf. `reconcilierCommande` pour les motifs d'écart.
 */
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { Info, RotateCcw, TriangleAlert, X } from "@lucide/vue";
import { toast } from "vue-sonner";
import { api } from "@/lib/api";
import type {
  CatalogueClientResponse,
  CommandeRecommande,
  ProduitCatalogueClient,
} from "@/lib/types";
import { dateFr, prixFr } from "@/lib/format";
import { LIBELLES_MOTIF, reconcilierCommande } from "@/lib/recommander";
import { usePanier } from "@/composables/usePanier";
import ProduitFormat from "@/components/catalogue/ProduitFormat.vue";
import ProduitVignette from "@/components/catalogue/ProduitVignette.vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

const props = defineProps<{
  open: boolean;
  commande: {
    idCommande: number;
    numero: number | null;
    dateCreation: number | null;
  } | null;
  /** true quand le dialog est ouvert depuis le catalogue (pas de navigation). */
  surCatalogue?: boolean;
}>();
const emit = defineEmits<{ "update:open": [boolean] }>();

const router = useRouter();
const queryClient = useQueryClient();
const { nbCartons, appliquerCommande } = usePanier();

const mode = ref<"remplacer" | "ajouter">("remplacer");
const panierNonVide = computed(() => nbCartons.value > 0);

// Réinitialise le choix à chaque ouverture : « remplacer » est le défaut sûr.
watch(
  () => props.open,
  (ouvert) => {
    if (ouvert) mode.value = "remplacer";
  },
);

const idCommande = computed(() => props.commande?.idCommande ?? null);

const edition = useQuery({
  queryKey: computed(() => ["commande-recommande", idCommande.value]),
  queryFn: () =>
    api.get<CommandeRecommande>(
      `/commandes/${idCommande.value}/edition?pour=recommande`,
    ),
  enabled: computed(() => props.open && idCommande.value != null),
});

// Même clé que le catalogue de la page d'accueil (hors mode modification) :
// ouvert depuis le catalogue, le récap est instantané.
const catalogue = useQuery({
  queryKey: ["catalogue", null],
  queryFn: () => api.get<CatalogueClientResponse>("/catalogue"),
  enabled: computed(() => props.open),
});

const chargement = computed(
  () => edition.isPending.value || catalogue.isPending.value,
);
const erreur = computed(
  () =>
    (edition.error.value as Error | null)?.message ??
    (catalogue.error.value as Error | null)?.message ??
    null,
);

const recap = computed(() => {
  if (!edition.data.value || !catalogue.data.value) return null;
  return reconcilierCommande(
    edition.data.value,
    catalogue.data.value.produits as ProduitCatalogueClient[],
  );
});

function fermer() {
  emit("update:open", false);
}

function confirmer() {
  const resultat = recap.value;
  if (!resultat?.reprises.length) return;
  appliquerCommande(
    resultat.reprises.map((l) => ({
      idStockBouteille: l.idStockBouteille as number,
      quantite: l.quantite,
    })),
    panierNonVide.value ? mode.value : "remplacer",
  );
  // Le catalogue passe de la clé « modification » à la clé nue : on invalide
  // pour que la page d'accueil reparte sur des tarifs à jour.
  queryClient.invalidateQueries({ queryKey: ["catalogue"] });
  const nb = resultat.nbCartons;
  toast.success(
    `${nb} carton${nb > 1 ? "s" : ""} ajouté${nb > 1 ? "s" : ""} au panier`,
    { description: "Ajustez les quantités puis validez votre commande." },
  );
  fermer();
  if (!props.surCatalogue) router.push("/");
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogScrollContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <RotateCcw class="size-5 text-muted-foreground" />
          Recommander la commande n°
          {{ props.commande?.numero ?? props.commande?.idCommande }}
        </DialogTitle>
        <DialogDescription>
          Passée le {{ dateFr(props.commande?.dateCreation) }} — aux tarifs et
          disponibilités du jour.
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="chargement"
        class="grid gap-2"
        aria-label="Chargement du récapitulatif"
        aria-busy="true"
      >
        <Skeleton v-for="i in 4" :key="i" class="h-12 w-full rounded-lg" />
      </div>

      <p v-else-if="erreur" class="text-sm text-destructive">{{ erreur }}</p>

      <template v-else-if="recap">
        <ul class="grid gap-1.5">
          <li
            v-for="(ligne, i) in recap.lignes"
            :key="`${ligne.idStockBouteille ?? 'x'}-${i}`"
            class="flex items-start gap-3 rounded-lg border px-3 py-2 text-sm"
            :class="
              ligne.motif
                ? 'border-dashed bg-muted/40 text-muted-foreground'
                : 'bg-background'
            "
          >
            <ProduitVignette
              :photo-url="ligne.produit?.photoUrl"
              :libelle="ligne.designation"
              taille="size-11"
              taille-repli="size-6"
              :grise="ligne.motif != null"
            />
            <span class="grid min-w-0 flex-1 gap-1">
              <span
                class="font-medium"
                :class="ligne.motif ? 'line-through' : 'text-foreground'"
              >
                {{ ligne.designation }}
              </span>
              <!-- Deux unités d'un même produit ne se distinguent que par là. -->
              <ProduitFormat
                v-if="ligne.produit"
                :contenant="ligne.produit.contenant"
                :packaging="ligne.produit.packaging"
              />
              <!-- Seuls les écarts portent un marqueur : une ligne reprise
                   telle quelle n'a rien à signaler. -->
              <span v-if="ligne.motif" class="flex items-center gap-1.5 text-xs">
                <X class="size-3.5 shrink-0" />
                {{ LIBELLES_MOTIF[ligne.motif] }} — non ajouté
              </span>
              <span
                v-else-if="ligne.quantiteAjustee"
                class="flex items-center gap-1.5 text-xs text-amber-700"
              >
                <TriangleAlert class="size-3.5 shrink-0" />
                quantité ajustée au pas de commande ({{ ligne.quantiteInitiale }}
                → {{ ligne.quantite }} cartons)
              </span>
            </span>
            <span v-if="!ligne.motif" class="shrink-0 text-right tabular-nums">
              <span class="block font-medium text-foreground">
                {{ ligne.quantite }} carton{{ ligne.quantite > 1 ? "s" : "" }}
              </span>
              <span class="block text-xs text-muted-foreground">
                {{ ligne.prixHT != null ? `${prixFr(ligne.prixHT)} HT` : "—" }}
              </span>
            </span>
          </li>
        </ul>

        <p
          v-if="!recap.reprises.length"
          class="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
        >
          Aucun produit de cette commande n'est disponible aujourd'hui. Composez
          votre panier depuis le catalogue.
        </p>
        <div
          v-else
          class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-sm"
        >
          <span>
            <span class="font-medium text-foreground">
              {{ recap.nbCartons }} carton{{ recap.nbCartons > 1 ? "s" : "" }}
            </span>
            <span class="text-muted-foreground">
              à ajouter<template v-if="recap.ecartees.length">
                · {{ recap.ecartees.length }} ligne{{
                  recap.ecartees.length > 1 ? "s" : ""
                }}
                écartée{{ recap.ecartees.length > 1 ? "s" : "" }}</template
              >
            </span>
          </span>
          <span class="font-semibold tabular-nums">
            {{ prixFr(recap.totalHT) }} HT
          </span>
        </div>

        <div
          v-if="panierNonVide && recap.reprises.length"
          class="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-50/60 px-3 py-2.5 text-sm dark:bg-amber-950/20"
        >
          <p class="text-muted-foreground">
            Votre panier contient déjà
            {{ nbCartons }} carton{{ nbCartons > 1 ? "s" : "" }}.
          </p>
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              :variant="mode === 'remplacer' ? 'default' : 'outline'"
              @click="mode = 'remplacer'"
            >
              Remplacer le panier
            </Button>
            <Button
              size="sm"
              :variant="mode === 'ajouter' ? 'default' : 'outline'"
              @click="mode = 'ajouter'"
            >
              Ajouter aux quantités
            </Button>
          </div>
        </div>

        <!-- Rien n'est envoyé ici : le lever le doute évite l'hésitation
             devant un bouton qui a l'air d'engager la commande. -->
        <p
          v-if="recap.reprises.length"
          class="flex items-start gap-2 text-xs text-muted-foreground"
        >
          <Info class="mt-px size-3.5 shrink-0" />
          Aucune commande n'est envoyée à cette étape : vous pourrez ajouter,
          retirer ou modifier les quantités dans votre panier avant de valider.
        </p>
      </template>

      <DialogFooter>
        <Button variant="outline" @click="fermer">Annuler</Button>
        <Button
          :disabled="chargement || !recap?.reprises.length"
          @click="confirmer"
        >
          Ajouter au panier
        </Button>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>
