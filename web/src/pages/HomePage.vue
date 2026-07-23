<script setup lang="ts">
import { computed, ref, watch, watchEffect } from "vue";
import { useRouter } from "vue-router";
import {
  Loader2,
  RotateCcw,
  Store,
  TriangleAlert,
} from "@lucide/vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useMediaQuery, useScrollLock } from "@vueuse/core";
import { toast } from "vue-sonner";
import { api } from "@/lib/api";
import type {
  CatalogueClientResponse,
  CommandeResultat,
  CommandeResume,
  CommandesClientResponse,
  ProduitCatalogueClient,
} from "@/lib/types";
import { dateFr, prixFr } from "@/lib/format";
import { estimerRemisesCommande } from "@/lib/remises";
import { groupesConditionnementPostalInvalides } from "@/lib/livraisonPostale";
import { useMe } from "@/composables/useMe";
import { usePanier } from "@/composables/usePanier";
import ProduitCard from "@/components/catalogue/ProduitCard.vue";
import PanierRecap from "@/components/catalogue/PanierRecap.vue";
import RecommanderDialog from "@/components/catalogue/RecommanderDialog.vue";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";

const router = useRouter();
const { data, isPending, isError, error } = useMe();
const {
  quantites,
  changer,
  fixer,
  vider,
  modification,
  nbCartons,
  lignes,
} = usePanier();

// L'admin n'a pas d'espace boutique : direction l'administration.
watchEffect(() => {
  if (data.value?.user.role === "admin") router.replace("/admin");
});

const catalogue = useQuery({
  queryKey: computed(() => ["catalogue", modification.value?.idCommande ?? null]),
  queryFn: () =>
    api.get<CatalogueClientResponse>(
      modification.value ? `/catalogue?commande=${modification.value.idCommande}` : "/catalogue",
    ),
  // Cache client en préparation (compte tout juste activé) : les prix arrivent
  // en tâche de fond → on re-sonde jusqu'à ce qu'ils soient là.
  refetchInterval: (query) =>
    query.state.data?.cacheEnPreparation
      ? 4000
      : query.state.data?.revalidationEnCours
        ? 30000
        : false,
});

// Compte fraîchement activé ou cache client incomplet : les tarifs se préparent côté serveur.
const compteSansTarifs = computed(
  () => data.value?.client != null && data.value.idGrilleTarifaire == null,
);
const comptePreparation = computed(
  () =>
    compteSansTarifs.value ||
    Boolean(data.value?.cacheEnPreparation) ||
    Boolean(catalogue.data.value?.cacheEnPreparation),
);

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

// --- Panier ---

const produitsParId = computed(() => {
  const map = new Map<number, ProduitCatalogueClient>();
  for (const p of catalogue.data.value?.produits ?? [])
    map.set(p.idStockBouteille, p);
  return map;
});

const lignesDetail = computed(() =>
  lignes.value
    .map((l) => {
      const produit = produitsParId.value.get(l.idStockBouteille);
      return produit
        ? {
            ...l,
            libelle: produit.libelle,
            contenant: produit.contenant,
            packaging: produit.packaging,
            photoUrl: produit.photoUrl,
            prixUnitaireHT: produit.prixHT ?? 0,
            pas: produit.pas,
            idProduit: produit.idProduit,
            idContenant: produit.idContenant,
            idLot: produit.idLot,
            produit,
            historique: produit.historique,
            sousTotal: (produit.prixHT ?? 0) * l.quantite,
            quantiteMaximum: produit.historique
              ? modification.value?.quantitesInitiales?.[l.idStockBouteille] ?? l.quantite
              : undefined,
          }
        : null;
    })
    .filter((l): l is NonNullable<typeof l> => l !== null),
);

const totalHT = computed(() =>
  lignesDetail.value.reduce((somme, l) => somme + l.sousTotal, 0),
);
const minimum = computed(() => data.value?.client?.minimumCommande ?? null);
const sousMinimum = computed(
  () => minimum.value != null && totalHT.value < minimum.value,
);
// Une remise par ligne : ciblée produit si applicable, sinon remise globale principale.
const remisesDetail = computed(() =>
  estimerRemisesCommande(lignesDetail.value, data.value?.client),
);
const remiseMontant = computed(() =>
  remisesDetail.value.reduce((total, d) => total + d.montant, 0),
);
const lignesPrixExpires = computed(() =>
  lignesDetail.value.filter((l) => !l.produit.prixEstFrais),
);
const commandeBloqueeParPrix = computed(
  () => lignesPrixExpires.value.length > 0,
);
const panierVisible = computed(
  () => nbCartons.value > 0 || modification.value != null,
);
const tagsClient = computed(() => {
  const tags = data.value?.client?.tags;
  if (!tags) return [];
  return (Array.isArray(tags) ? tags : String(tags).split(","))
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
});
const livraisonPostale = computed(() => tagsClient.value.includes("laposte"));
const groupesPostauxInvalides = computed(() =>
  livraisonPostale.value
    ? groupesConditionnementPostalInvalides(lignesDetail.value)
    : [],
);
const erreursConditionnementPostal = computed(() =>
  groupesPostauxInvalides.value.map((groupe) => {
    const cartons = groupe.manque > 1 ? "cartons" : "carton";
    return `Livraison La Poste : ajoutez ${groupe.manque} ${cartons} en ${groupe.contenant} · ${groupe.packaging}, avec le ou les goûts de votre choix.`;
  }),
);
const commandeBloqueeParConditionnement = computed(
  () => groupesPostauxInvalides.value.length > 0,
);
/** Volet détail de la barre mobile. */
const barreDepliee = ref(false);
const affichageMobile = useMediaQuery("(max-width: 1023px)");
const scrollPageVerrouille = useScrollLock(() =>
  typeof document === "undefined" ? null : document.body,
);
watchEffect(() => {
  scrollPageVerrouille.value = barreDepliee.value && affichageMobile.value;
});

// --- Envoi de la commande ---

const queryClient = useQueryClient();
const dialogOuvert = ref(false);
const commentaire = ref("");
const erreurEnvoi = ref<{
  titre: string;
  message: string;
  aide?: string;
} | null>(null);
const confirmation = ref<{
  numero?: number | null;
  totalHT: number;
  totalTTC: number | null;
  remiseTotale: number | null;
  totauxReels: boolean;
  modification: boolean;
} | null>(null);

// En mode modification, on repart du commentaire existant de la commande.
watch(
  modification,
  (m) => {
    if (m) commentaire.value = m.commentaire;
  },
  { immediate: true },
);

function erreurCommandeLisible(message: string) {
  const normalise = message.toLowerCase();
  if (normalise.includes("grille tarifaire introuvable")) {
    return {
      titre: "Nous n'avons pas pu finaliser la commande",
      message: "",
    };
  }
  if (normalise.includes("compte est en cours de préparation")) {
    return {
      titre: "Compte en préparation",
      message: "Vos tarifs sont encore en cours de chargement.",
      aide: "Réessayez dans une minute.",
    };
  }
  if (normalise.includes("minimum de commande")) {
    return {
      titre: "Minimum de commande non atteint",
      message,
    };
  }
  return {
    titre: "Commande non envoyée",
    message,
    aide: "Vérifiez votre panier ou contactez GOA si le problème persiste.",
  };
}

const envoi = useMutation({
  mutationFn: () => {
    if (!lignes.value.length) {
      throw new Error("Votre panier est vide.");
    }
    if (lignesDetail.value.length !== lignes.value.length) {
      throw new Error(
        "Un produit du panier n'est plus disponible au catalogue. Retirez-le puis réessayez.",
      );
    }
    if (commandeBloqueeParPrix.value) {
      throw new Error(
        "Un ou plusieurs tarifs doivent être vérifiés avant l'envoi.",
      );
    }
    if (comptePreparation.value) {
      throw new Error("Votre compte est en cours de préparation.");
    }
    if (sousMinimum.value && minimum.value != null) {
      throw new Error(`Minimum de commande : ${prixFr(minimum.value)} HT.`);
    }
    if (commandeBloqueeParConditionnement.value) {
      throw new Error(erreursConditionnementPostal.value[0]);
    }
    const body = { commentaire: commentaire.value, lignes: lignes.value };
    return modification.value
      ? api.put<CommandeResultat>(
          `/commandes/${modification.value.idCommande}`,
          body,
        )
      : api.post<CommandeResultat>("/commandes", body);
  },
  onSuccess: (res) => {
    const confirmationCommande = {
      numero: res.easybeer.numero ?? modification.value?.numero ?? null,
      totalHT: res.totalHT,
      totalTTC: res.totalTTC,
      remiseTotale: res.remiseTotale,
      totauxReels: res.totauxReels,
      modification: modification.value != null,
    };
    sessionStorage.setItem(
      "goa-commande-confirmation",
      JSON.stringify(confirmationCommande),
    );
    vider();
    commentaire.value = "";
    barreDepliee.value = false;
    dialogOuvert.value = false;
    confirmation.value = null;
    queryClient.invalidateQueries({ queryKey: ["commandes"] });
    router.push("/commandes");
  },
  onError: (e) => {
    const erreur = erreurCommandeLisible((e as Error).message);
    erreurEnvoi.value = erreur;
    toast.error(erreur.titre, {
      description: erreur.message,
      duration: 7000,
    });
  },
});

function ouvrirRecap() {
  confirmation.value = null;
  erreurEnvoi.value = null;
  dialogOuvert.value = true;
}

function annulerModification() {
  vider();
  commentaire.value = "";
  barreDepliee.value = false;
}

function supprimerLignePanier(idStockBouteille: number) {
  fixer(idStockBouteille, 0);
}
</script>

<template>
  <div
    class="grid items-start gap-4 pb-28 lg:grid-cols-[minmax(0,1fr)_20rem] lg:pb-4"
  >
    <!-- Colonne principale -->
    <div class="grid gap-4">
      <!-- Compte fraîchement activé : les prix se préparent -->
      <div
        v-if="comptePreparation"
        class="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <span
          class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-background text-amber-700 shadow-xs"
        >
          <Store class="size-4" />
        </span>
        <div class="grid gap-0.5">
          <p class="font-medium">Votre compte se prépare…</p>
          <p>
            Vos tarifs sont en cours de chargement. Patientez quelques instants
            : la page se met à jour automatiquement. Si rien ne change,
            rafraîchissez la page.
          </p>
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
          <CardTitle class="text-lg">
            {{
              modification
                ? `Modification #${modification.numero ?? modification.idCommande}`
                : "Votre commande"
            }}
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
              {{ modification ? "Mettre à jour" : "Commander" }}
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
          <div class="mb-3 flex shrink-0 items-baseline justify-between gap-3">
            <h2 class="font-semibold">Votre commande</h2>
            <span class="text-xs text-muted-foreground">
              {{ nbCartons }} carton{{ nbCartons > 1 ? "s" : "" }}
            </span>
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
            {{ modification ? "Mettre à jour" : "Commander" }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Confirmation -->
    <Dialog v-model:open="dialogOuvert">
      <DialogContent
        class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-md"
      >
        <template v-if="envoi.isPending.value">
          <div class="grid justify-items-center gap-4 py-8 text-center">
            <span
              class="grid size-14 place-items-center rounded-full bg-primary/10 text-primary"
            >
              <Loader2 class="size-7 animate-spin" />
            </span>
            <div class="grid gap-1">
              <DialogTitle>
                {{
                  modification
                    ? "Mise à jour en cours"
                    : "Commande en cours de traitement"
                }}
              </DialogTitle>
              <DialogDescription>
                Cette étape peut prendre quelques secondes.
              </DialogDescription>
            </div>
            <Button class="w-full" size="lg" disabled>
              <Loader2 class="size-4 animate-spin" />
              {{ modification ? "Mise à jour…" : "Envoi…" }}
            </Button>
          </div>
        </template>

        <template v-else-if="!confirmation">
          <DialogHeader class="shrink-0">
            <DialogTitle>
              {{
                modification
                  ? `Modifier la commande #${modification.numero ?? modification.idCommande}`
                  : "Récapitulatif de votre commande"
              }}
            </DialogTitle>
            <DialogDescription>
              {{
                modification
                  ? "Cette version annule et remplace la précédente."
                  : "Vérifiez les quantités avant l'envoi."
              }}
            </DialogDescription>
          </DialogHeader>
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
          />
          <div class="grid shrink-0 gap-1.5">
            <Label for="commentaire">Commentaire (facultatif)</Label>
            <Textarea
              id="commentaire"
              v-model="commentaire"
              placeholder="Précisions de livraison, demandes particulières…"
              rows="3"
            />
          </div>
          <div
            v-if="
              commandeBloqueeParPrix ||
              (sousMinimum && minimum != null) ||
              erreurEnvoi
            "
            class="grid shrink-0 gap-2"
          >
            <p v-if="commandeBloqueeParPrix" class="text-xs text-amber-700">
              Un ou plusieurs tarifs doivent être vérifiés avant l'envoi.
            </p>
            <p
              v-if="sousMinimum && minimum != null"
              class="text-xs text-amber-700"
            >
              Minimum de commande : {{ prixFr(minimum) }} HT.
            </p>
            <div
              v-if="erreurEnvoi"
              class="flex gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive"
              role="alert"
            >
              <TriangleAlert class="mt-0.5 size-4 shrink-0" />
              <div class="min-w-0">
                <p class="font-semibold">{{ erreurEnvoi.titre }}</p>
                <p
                  v-if="erreurEnvoi.message"
                  class="mt-1 leading-snug break-words"
                >
                  {{ erreurEnvoi.message }}
                </p>
                <p
                  v-if="erreurEnvoi.aide"
                  class="mt-1 text-xs text-destructive/80"
                >
                  {{ erreurEnvoi.aide }}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter class="shrink-0">
            <Button
              class="w-full"
              size="lg"
              :disabled="
                envoi.isPending.value ||
                commandeBloqueeParPrix ||
                commandeBloqueeParConditionnement ||
                comptePreparation ||
                sousMinimum ||
                nbCartons === 0
              "
              @click="envoi.mutate()"
            >
              {{
                envoi.isPending.value
                  ? "Envoi…"
                  : modification
                    ? "Confirmer la modification"
                    : "Confirmer la commande"
              }}
            </Button>
          </DialogFooter>
        </template>

        <template v-else>
          <DialogHeader>
            <DialogTitle>{{
              confirmation.modification
                ? "Commande mise à jour ✓"
                : "Commande envoyée ✓"
            }}</DialogTitle>
            <DialogDescription>
              Votre commande a bien été transmise à GOA<template
                v-if="confirmation.numero"
              >
                (#{{ confirmation.numero }})</template
              >.
            </DialogDescription>
          </DialogHeader>

          <!-- Totaux relus d'Easybeer quand disponibles. -->
          <dl class="grid gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
            <div
              v-if="confirmation.remiseTotale"
              class="flex justify-between text-muted-foreground"
            >
              <dt>Remise</dt>
              <dd class="tabular-nums">
                − {{ prixFr(confirmation.remiseTotale) }}
              </dd>
            </div>
            <div class="flex justify-between font-semibold">
              <dt>
                {{ confirmation.totalTTC != null ? "Total TTC" : "Total HT" }}
              </dt>
              <dd class="tabular-nums">
                {{ prixFr(confirmation.totalTTC ?? confirmation.totalHT) }}
              </dd>
            </div>
          </dl>
          <DialogFooter>
            <Button class="w-full" @click="dialogOuvert = false">Fermer</Button>
          </DialogFooter>
        </template>
      </DialogContent>
    </Dialog>

    <RecommanderDialog
      v-model:open="recommandeOuvert"
      :commande="derniereCommande"
      sur-catalogue
    />
  </div>
</template>
