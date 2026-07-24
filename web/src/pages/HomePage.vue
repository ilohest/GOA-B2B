<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Loader2, RotateCcw, Store } from "@lucide/vue";
import { useQuery } from "@tanstack/vue-query";
import { useMediaQuery, useScrollLock } from "@vueuse/core";
import { toast } from "vue-sonner";
import { api } from "@/lib/api";
import type {
  CommandeResume,
  CommandesClientResponse,
} from "@/lib/types";
import { dateFr, prixFr } from "@/lib/format";
import { useCommandeCourante } from "@/composables/useCommandeCourante";
import ProduitCard from "@/components/catalogue/ProduitCard.vue";
import PanierRecap from "@/components/catalogue/PanierRecap.vue";
import RecommanderDialog from "@/components/catalogue/RecommanderDialog.vue";
import ToastAnnulationPanier from "@/components/catalogue/ToastAnnulationPanier.vue";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const router = useRouter();
const route = useRoute();
const modeApercu = computed(() => route.name === "admin-boutique-apercu");
const {
  data,
  isPending,
  isError,
  error,
  catalogue,
  comptePreparation,
  quantites,
  changer,
  fixer,
  vider,
  modification,
  nbCartons,
  produitsParId,
  lignesDetail,
  totalHT,
  minimum,
  sousMinimum,
  remisesDetail,
  remiseMontant,
  commandeBloqueeParPrix,
  erreursConditionnementPostal,
  commandeBloqueeParConditionnement,
} = useCommandeCourante(modeApercu);

// Hors route d'aperçu explicite, l'admin reste dans son espace.
watchEffect(() => {
  if (data.value?.user.role === "admin" && !modeApercu.value)
    router.replace("/admin");
  if (data.value?.user.role === "client" && modeApercu.value)
    router.replace("/");
});

// --- Reprise de la dernière commande ---

// Même clé que « Mes commandes » : l'historique est mutualisé entre les deux pages.
const commandes = useQuery({
  queryKey: ["commandes"],
  queryFn: () => api.get<CommandesClientResponse>("/commandes"),
  enabled: computed(() => data.value?.user.role === "client"),
});

const derniereCommande = computed<CommandeResume | null>(() => {
  const liste = commandes.data.value?.commandes ?? [];
  if (!liste.length || commandes.data.value?.source === "local") return null;
  return liste.reduce((recente, cmd) =>
    (cmd.dateCreation ?? 0) > (recente.dateCreation ?? 0) ? cmd : recente,
  );
});

const recommandeOuvert = ref(false);
// Le raccourci ne s'affiche que sur un panier vierge : dès qu'une quantité est
// saisie, ou en pleine modification de commande, il disparaît.
const rappelDerniereCommande = computed(
  () =>
    derniereCommande.value != null &&
    nbCartons.value === 0 &&
    modification.value == null &&
    !comptePreparation.value,
);

// --- Filtres du catalogue ---

const filtreContenant = ref("tous");
const filtrePackaging = ref("tous");
const rechercheProduit = ref("");
const normaliserRecherche = (valeur: string) =>
  valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .trim();
const produitsCatalogue = computed(() =>
  (catalogue.data.value?.produits ?? []).filter((produit) => !produit.historique),
);
const contenantsDisponibles = computed(() =>
  [
    ...new Set(
      produitsCatalogue.value
        .map((p) => p.contenant)
        .filter((v): v is string => Boolean(v)),
    ),
  ].sort((a, b) => a.localeCompare(b, "fr")),
);
const packagingsDisponibles = computed(() =>
  [
    ...new Set(
      produitsCatalogue.value
        .map((p) => p.packaging)
        .filter((v): v is string => Boolean(v)),
    ),
  ].sort((a, b) => a.localeCompare(b, "fr")),
);
const produitsFiltres = computed(() =>
  produitsCatalogue.value.filter(
    (p) =>
      (!normaliserRecherche(rechercheProduit.value) ||
        normaliserRecherche(
          `${p.libelle} ${p.contenant ?? ""} ${p.packaging ?? ""}`,
        ).includes(normaliserRecherche(rechercheProduit.value))) &&
      (filtreContenant.value === "tous" ||
        p.contenant === filtreContenant.value) &&
      (filtrePackaging.value === "tous" ||
        p.packaging === filtrePackaging.value),
  ),
);
const filtresCatalogueActifs = computed(
  () =>
    Boolean(rechercheProduit.value.trim()) ||
    filtreContenant.value !== "tous" ||
    filtrePackaging.value !== "tous",
);

function reinitialiserFiltresCatalogue() {
  rechercheProduit.value = "";
  filtreContenant.value = "tous";
  filtrePackaging.value = "tous";
}

const panierVisible = computed(
  () => nbCartons.value > 0 || modification.value != null,
);
/** Volet détail de la barre mobile. */
const barreDepliee = ref(false);
const affichageMobile = useMediaQuery("(max-width: 1023px)");
const scrollPageVerrouille = useScrollLock(() =>
  typeof document === "undefined" ? null : document.body,
);
watchEffect(() => {
  scrollPageVerrouille.value =
    comptePreparation.value || (barreDepliee.value && affichageMobile.value);
});

function ouvrirRecap() {
  router.push({
    name: modeApercu.value
      ? "admin-boutique-confirmation"
      : "confirmation-commande",
  });
}

function annulerModification() {
  vider();
  barreDepliee.value = false;
}

function supprimerLignePanier(idStockBouteille: number) {
  const quantiteSupprimee = quantites.value[idStockBouteille] ?? 0;
  if (!quantiteSupprimee) return;
  const libelle = produitsParId.value.get(idStockBouteille)?.libelle ?? "Produit";
  fixer(idStockBouteille, 0);
  toast.info(`${libelle} retiré du panier.`, {
    class: "panier-toast-annulation overflow-hidden",
    description: ToastAnnulationPanier,
    duration: 7000,
    action: {
      label: "Annuler",
      onClick: () =>
        fixer(
          idStockBouteille,
          (quantites.value[idStockBouteille] ?? 0) + quantiteSupprimee,
        ),
    },
  });
}

function viderPanierAvecAnnulation() {
  const quantitesSupprimees = { ...quantites.value };
  const nbLignes = Object.keys(quantitesSupprimees).length;
  if (!nbLignes) return;
  for (const id of Object.keys(quantitesSupprimees)) fixer(Number(id), 0);
  toast.info("Panier vidé.", {
    class: "panier-toast-annulation overflow-hidden",
    description: ToastAnnulationPanier,
    componentProps: {
      texte: `${nbLignes} produit${nbLignes > 1 ? "s" : ""} retiré${nbLignes > 1 ? "s" : ""}.`,
    },
    duration: 7000,
    action: {
      label: "Annuler",
      onClick: () => {
        for (const [id, quantite] of Object.entries(quantitesSupprimees)) {
          fixer(Number(id), (quantites.value[Number(id)] ?? 0) + quantite);
        }
      },
    },
  });
}
</script>

<template>
  <div
    class="grid items-start gap-4 pb-28 lg:grid-cols-[minmax(0,1fr)_20rem] lg:pb-4"
  >
    <!-- Colonne principale -->
    <div class="grid gap-4">
      <div
        v-if="modeApercu"
        class="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/95 px-4 py-3 text-sm text-blue-950 shadow-sm backdrop-blur"
      >
        <div class="flex items-start gap-2.5">
          <Store class="mt-0.5 size-4 shrink-0 text-blue-600" />
          <p>
            <span class="font-semibold">Mode aperçu de la boutique</span>
            <span class="text-blue-800"> — le panier peut être testé, mais aucune commande ne sera envoyée.</span>
          </p>
        </div>
        <Button variant="outline" size="sm" class="border-blue-200 bg-white" @click="router.push('/admin')">
          Quitter l’aperçu
        </Button>
      </div>

      <!-- Compte fraîchement activé : overlay bloquant tant que les prix se
           préparent. Il se ferme seul dès que le cache client est prêt (la
           requête /me & catalogue rafraîchit automatiquement). -->
      <div
        v-if="comptePreparation"
        class="fixed inset-0 z-50 grid place-items-center bg-background/85 p-4 backdrop-blur-sm"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div
          class="grid max-w-sm justify-items-center gap-4 rounded-2xl border bg-card px-6 py-8 text-center shadow-lg"
        >
          <span
            class="grid size-14 place-items-center rounded-full bg-primary/10 text-primary"
          >
            <Loader2 class="size-7 animate-spin" />
          </span>
          <div class="grid gap-1.5">
            <p class="text-base font-semibold">Votre compte se prépare…</p>
            <p class="text-sm text-muted-foreground">
              Nous chargeons vos tarifs personnalisés. Votre boutique s’ouvre
              dans un instant — inutile de rafraîchir, la page se met à jour
              toute seule.
            </p>
          </div>
        </div>
      </div>

      <!-- Bandeau mode modification -->
      <div
        v-if="modification"
        class="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-background/95 px-4 py-3 shadow-sm backdrop-blur"
      >
        <p class="min-w-0 flex-1 text-sm">
          <span class="font-semibold text-primary">
            Modification de la commande
            #{{ modification.numero ?? modification.idCommande }}
          </span>
          <span class="text-muted-foreground">
            — ajustez les quantités ci-dessous puis validez. La nouvelle version
            annule et remplace la précédente.
          </span>
        </p>
        <div class="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" @click="annulerModification">
            Annuler
          </Button>
          <Button
            size="sm"
            :disabled="
              sousMinimum ||
              commandeBloqueeParConditionnement ||
              commandeBloqueeParPrix ||
              comptePreparation ||
              nbCartons === 0
            "
            @click="ouvrirRecap"
          >
            Mettre à jour
          </Button>
        </div>
      </div>

      <section>
        <div class="mb-5">
          <h1
            class="flex items-center gap-2 text-2xl font-semibold tracking-tight"
          >
            <Store class="size-5 text-muted-foreground" />
            Produits
          </h1>
        </div>

        <div
          v-if="catalogue.isPending.value || isPending"
          class="grid gap-5"
          aria-label="Chargement du catalogue"
          aria-busy="true"
        >
          <div class="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:flex">
            <div
              v-for="i in 2"
              :key="`filtre-${i}`"
              class="grid gap-1.5 sm:w-56"
            >
              <Skeleton class="h-3 w-24" />
              <Skeleton class="h-9 w-full rounded-md" />
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            <article
              v-for="i in 6"
              :key="i"
              class="overflow-hidden rounded-lg border bg-card"
            >
              <div class="flex gap-3 p-3">
                <Skeleton class="size-16 shrink-0 rounded-md" />
                <div class="grid flex-1 content-start gap-2">
                  <Skeleton class="h-4 w-3/4" />
                  <div class="flex gap-1.5">
                    <Skeleton class="h-6 w-16 rounded-full" />
                    <Skeleton class="h-6 w-20 rounded-full" />
                  </div>
                </div>
              </div>
              <div class="grid gap-2 border-t p-3">
                <div class="flex items-center justify-between">
                  <Skeleton class="h-3 w-20" />
                  <Skeleton class="h-5 w-16" />
                </div>
                <Skeleton class="h-10 w-full rounded-full" />
              </div>
            </article>
          </div>
        </div>

        <p v-else-if="catalogue.isError.value" class="text-sm text-destructive">
          Impossible de charger le catalogue :
          {{ (catalogue.error.value as Error)?.message }}
        </p>
        <p v-else-if="isError" class="text-sm text-destructive">
          Impossible de charger votre compte : {{ (error as Error)?.message }}
        </p>

        <p
          v-else-if="!catalogue.data.value?.produits.length"
          class="text-sm text-muted-foreground"
        >
          Le catalogue n'est pas encore disponible — revenez bientôt.
        </p>

        <template v-else>
          <div
            class="mb-5 grid gap-3 rounded-xl border bg-muted/20 p-3 sm:flex sm:flex-wrap sm:items-end"
          >
            <div class="grid gap-1.5 sm:min-w-64 sm:flex-1">
              <Label for="recherche-produit" class="text-xs text-muted-foreground">
                Rechercher un produit
              </Label>
              <Input
                id="recherche-produit"
                v-model="rechercheProduit"
                type="search"
                class="bg-background"
                placeholder="Nom, format ou conditionnement"
              />
            </div>

            <div class="grid gap-1.5 sm:w-56">
              <Label class="text-xs text-muted-foreground">Contenant</Label>
              <Select v-model="filtreContenant">
                <SelectTrigger
                  class="w-full bg-background"
                  aria-label="Filtrer par contenant"
                >
                  <SelectValue placeholder="Tous les contenants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous">Tous les contenants</SelectItem>
                  <SelectItem
                    v-for="valeur in contenantsDisponibles"
                    :key="valeur"
                    :value="valeur"
                  >
                    {{ valeur }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="grid gap-1.5 sm:w-56">
              <Label class="text-xs text-muted-foreground"
                >Conditionnement</Label
              >
              <Select v-model="filtrePackaging">
                <SelectTrigger
                  class="w-full bg-background"
                  aria-label="Filtrer par conditionnement"
                >
                  <SelectValue placeholder="Tous les conditionnements" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous"
                    >Tous les conditionnements</SelectItem
                  >
                  <SelectItem
                    v-for="valeur in packagingsDisponibles"
                    :key="valeur"
                    :value="valeur"
                  >
                    {{ valeur }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              v-if="filtresCatalogueActifs"
              type="button"
              variant="ghost"
              class="sm:mb-0"
              @click="reinitialiserFiltresCatalogue"
            >
              Réinitialiser
            </Button>
          </div>

          <div
            v-if="!produitsFiltres.length"
            class="grid justify-items-start gap-3 rounded-xl border border-dashed p-5"
          >
            <p class="text-sm text-muted-foreground">
              Aucun produit ne correspond à ces filtres.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              @click="reinitialiserFiltresCatalogue"
            >
              Afficher tous les produits
            </Button>
          </div>

          <div
            v-else
            class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          >
            <ProduitCard
              v-for="p in produitsFiltres"
              :key="p.idStockBouteille"
              :produit="p"
              :quantite="quantites[p.idStockBouteille] ?? 0"
              @changer="(delta) => changer(p.idStockBouteille, delta)"
              @fixer="(quantite) => fixer(p.idStockBouteille, quantite)"
            />
          </div>
        </template>
      </section>
    </div>

    <!-- Colonne récap. Le raccourci « recommander » y vit aussi, au-dessus du
         panier ; sur mobile la colonne remonte en tête (le panier, lui, reste
         la barre fixe du bas). -->
    <aside
      class="order-first content-start gap-4 lg:fixed lg:top-[4.5rem] lg:right-4 lg:z-10 lg:flex lg:max-h-[calc(100dvh-5.5rem)] lg:w-80 lg:flex-col"
      :class="rappelDerniereCommande ? 'grid' : 'hidden'"
    >
      <!-- Raccourci : reprendre la dernière commande (panier vierge seulement) -->
      <div
        v-if="rappelDerniereCommande && derniereCommande"
        class="grid gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm"
      >
        <div class="flex min-w-0 items-start gap-3">
          <span
            class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-background text-muted-foreground shadow-xs"
          >
            <RotateCcw class="size-4" />
          </span>
          <p class="grid min-w-0 gap-0.5">
            <span class="font-medium text-foreground">
              Votre dernière commande
            </span>
            <span class="text-muted-foreground">
              {{ dateFr(derniereCommande.dateCreation) }}
              <template v-if="derniereCommande.totalTTC != null">
                · {{ prixFr(derniereCommande.totalTTC) }} TTC
              </template>
            </span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="w-full"
          @click="recommandeOuvert = true"
        >
          Recommander
        </Button>
      </div>

      <Card
        class="hidden min-h-0 flex-[0_1_auto] flex-col overflow-hidden lg:flex"
      >
        <CardHeader class="shrink-0">
          <CardTitle class="flex items-baseline gap-1.5 text-lg">
            <span>{{
              modification
                ? `Modification #${modification.numero ?? modification.idCommande}`
                : "Votre commande"
            }}</span>
            <span class="text-sm font-normal text-muted-foreground">
              ({{ nbCartons }} article{{ nbCartons === 1 ? "" : "s" }})
            </span>
          </CardTitle>
          <CardDescription v-if="modification"> </CardDescription>
        </CardHeader>
        <CardContent class="flex min-h-0 flex-1 flex-col">
          <PanierRecap
            class="min-h-0 flex-1"
            :lignes="lignesDetail"
            :total-h-t="totalHT"
            :minimum="minimum"
            :sous-minimum="sousMinimum"
            :erreurs-conditionnement="erreursConditionnementPostal"
            :remise-montant="remiseMontant"
            :remises-detail="remisesDetail"
            defilement-contraint
            editable
            @changer="changer"
            @supprimer="supprimerLignePanier"
            @vider="viderPanierAvecAnnulation"
          >
            <p v-if="commandeBloqueeParPrix" class="text-xs text-amber-700">
              Un ou plusieurs tarifs doivent être vérifiés avant l'envoi.
            </p>
            <Button
              class="mt-2 w-full"
              size="lg"
              :disabled="
                sousMinimum ||
                commandeBloqueeParConditionnement ||
                commandeBloqueeParPrix ||
                comptePreparation ||
                nbCartons === 0
              "
              @click="ouvrirRecap"
            >
              {{ modeApercu ? "Voir le récapitulatif" : modification ? "Mettre à jour" : "Commander" }}
            </Button>
            <Button
              v-if="modification"
              variant="ghost"
              class="w-full text-muted-foreground"
              @click="annulerModification"
            >
              Annuler la modification
            </Button>
          </PanierRecap>
        </CardContent>
      </Card>
    </aside>

    <!-- Barre panier (mobile) : résumé + volet détail dépliable -->
    <div
      v-if="panierVisible"
      class="fixed inset-x-0 bottom-0 z-20 px-4 pb-4 lg:hidden"
    >
      <div
        class="mx-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-lg"
      >
        <div
          v-if="barreDepliee"
          class="flex min-h-0 flex-1 flex-col border-b p-4"
        >
          <div class="mb-3 flex shrink-0 items-baseline gap-3">
            <h2 class="flex items-baseline gap-1.5 font-semibold">
              Votre commande
              <span class="text-xs font-normal text-muted-foreground">
                ({{ nbCartons }} article{{ nbCartons === 1 ? "" : "s" }})
              </span>
            </h2>
          </div>
          <p v-if="modification" class="mb-2 text-xs font-medium text-primary">
            Modification de la commande
            #{{ modification.numero ?? modification.idCommande }} — la nouvelle
            version annule et remplace la précédente.
          </p>
          <PanierRecap
            class="min-h-0 flex-1"
            :lignes="lignesDetail"
            :total-h-t="totalHT"
            :minimum="minimum"
            :sous-minimum="sousMinimum"
            :erreurs-conditionnement="erreursConditionnementPostal"
            :remise-montant="remiseMontant"
            :remises-detail="remisesDetail"
            defilement-contraint
            editable
            @changer="changer"
            @supprimer="supprimerLignePanier"
            @vider="viderPanierAvecAnnulation"
          >
            <p v-if="commandeBloqueeParPrix" class="text-xs text-amber-700">
              Un ou plusieurs tarifs doivent être vérifiés avant l'envoi.
            </p>
            <button
              v-if="modification"
              class="justify-self-start text-xs text-muted-foreground underline underline-offset-2"
              @click="annulerModification"
            >
              Annuler la modification
            </button>
          </PanierRecap>
        </div>
        <div class="flex shrink-0 items-center justify-between gap-3 p-3">
          <button
            class="min-w-0 flex-1 text-left"
            :aria-expanded="barreDepliee"
            aria-label="Voir le détail du panier"
            @click="barreDepliee = !barreDepliee"
          >
            <p v-if="modification" class="text-xs font-medium text-primary">
              Modification #{{ modification.numero ?? modification.idCommande }}
            </p>
            <p class="text-sm font-semibold">
              {{ nbCartons }} carton{{ nbCartons > 1 ? "s" : "" }} —
              {{ prixFr(totalHT) }} HT
              <span class="ml-1 text-muted-foreground">{{
                barreDepliee ? "▾" : "▴"
              }}</span>
            </p>
            <p v-if="sousMinimum" class="text-xs text-destructive">
              Minimum : {{ prixFr(minimum!) }} HT
            </p>
            <p
              v-if="commandeBloqueeParConditionnement"
              class="text-xs text-destructive"
            >
              Conditionnement La Poste incomplet
            </p>
          </button>
          <Button
            size="lg"
            :disabled="
              sousMinimum ||
              commandeBloqueeParConditionnement ||
              commandeBloqueeParPrix ||
              comptePreparation ||
              nbCartons === 0
            "
            @click="ouvrirRecap"
          >
            {{ modeApercu ? "Voir le récapitulatif" : modification ? "Mettre à jour" : "Commander" }}
          </Button>
        </div>
      </div>
    </div>

    <RecommanderDialog
      v-model:open="recommandeOuvert"
      :commande="derniereCommande"
      sur-catalogue
    />
  </div>
</template>
