<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Download,
  Pencil,
  RotateCcw,
  Store,
} from "@lucide/vue";
import { useQuery } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { api } from "@/lib/api";
import type {
  CommandeEdition,
  CommandeResume,
  CommandesClientResponse,
} from "@/lib/types";
import { dateFr, prixFr } from "@/lib/format";
import EtatBadge from "@/components/EtatBadge.vue";
import CommandeDetailDialog from "@/components/CommandeDetailDialog.vue";
import { usePanier } from "@/composables/usePanier";
import RecommanderDialog from "@/components/catalogue/RecommanderDialog.vue";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const router = useRouter();
const { chargerCommande, modification } = usePanier();

const { data, isPending, isError, error } = useQuery({
  queryKey: ["commandes"],
  queryFn: () => api.get<CommandesClientResponse>("/commandes"),
});

const chargement = ref<number | null>(null);
const telechargementFactures = ref(false);
const anneeFactures = ref<number | null>(null);
const archivesFacturesOuvertes = ref(false);

const anneesFacturesQuery = useQuery({
  queryKey: ["factures", "annees"],
  queryFn: () => api.get<{ annees: number[] }>("/commandes/factures/annees"),
  staleTime: 5 * 60 * 1000,
  retry: false,
});

const anneesCommandes = computed(() => {
  return anneesFacturesQuery.data.value?.annees ?? [];
});

watch(
  anneesCommandes,
  (annees) => {
    if (
      anneeFactures.value == null ||
      !annees.includes(anneeFactures.value)
    ) {
      anneeFactures.value = annees[0] ?? null;
    }
  },
  { immediate: true },
);

const disponibiliteFactures = useQuery({
  queryKey: computed(() => [
    "factures",
    "disponibilite",
    anneeFactures.value,
  ]),
  queryFn: () =>
    api.get<{ disponible: boolean }>(
      `/commandes/factures/disponibilite?annee=${anneeFactures.value}`,
    ),
  enabled: computed(() => anneeFactures.value != null),
  staleTime: 5 * 60 * 1000,
  retry: false,
});

async function telechargerFacturesAnnuelles() {
  if (
    anneeFactures.value == null ||
    !disponibiliteFactures.data.value?.disponible
  )
    return;
  telechargementFactures.value = true;
  try {
    await api.telecharger(
      `/commandes/factures/archive?annee=${anneeFactures.value}`,
      `factures-goa-${anneeFactures.value}.zip`,
    );
    archivesFacturesOuvertes.value = false;
    toast.success(`Archive ${anneeFactures.value} téléchargée.`, {
      description: "Toutes les factures disponibles sont regroupées dans le ZIP.",
    });
  } catch (e) {
    toast.error("Impossible de préparer l’archive.", {
      description: (e as Error).message,
    });
  } finally {
    telechargementFactures.value = false;
  }
}

const confirmationOuverte = ref(false);
const confirmation = ref<{
  numero?: number | null;
  totalHT: number;
  totalTTC: number | null;
  remiseTotale: number | null;
  totauxReels: boolean;
  modification: boolean;
} | null>(null);

onMounted(() => {
  const brut = sessionStorage.getItem("goa-commande-confirmation");
  if (!brut) return;
  sessionStorage.removeItem("goa-commande-confirmation");
  try {
    confirmation.value = JSON.parse(brut);
    confirmationOuverte.value = true;
  } catch {
    confirmation.value = null;
  }
});

// --- Recommander (reprise d'une commande passée dans une nouvelle) ---

const recommandeOuvert = ref(false);
const commandeARecommander = ref<CommandeResume | null>(null);
// Une modification en cours arme un upsert Easybeer : mélanger les deux modes
// ferait écraser la commande éditée par une reprise d'historique.
const recommandeBloquee = computed(() => modification.value != null);

async function recommander(commande: CommandeResume) {
  if (recommandeBloquee.value) {
    toast.info(
      `Vous modifiez la commande #${modification.value?.numero ?? modification.value?.idCommande}.`,
      {
        description:
          "Validez ou annulez cette modification avant d'en recommander une autre.",
      },
    );
    return;
  }
  commandeOuverte.value = null;
  await nextTick();
  commandeARecommander.value = commande;
  recommandeOuvert.value = true;
}

// --- Détail en popup, identique à l'administration ---

const commandeOuverte = ref<number | null>(null);
const commandeSelectionnee = computed(() =>
  data.value?.commandes.find(
    (commande) => commande.idCommande === commandeOuverte.value,
  ),
);

async function modifier(commande: CommandeResume) {
  chargement.value = commande.idCommande;
  try {
    const edition = await api.get<CommandeEdition>(
      `/commandes/${commande.idCommande}/edition`,
    );
    if (!edition.modifiable) {
      toast.error("Cette commande ne peut plus être modifiée.");
      return;
    }
    if (
      !edition.lignes.length ||
      edition.lignes.some((ligne) => ligne.idStockBouteille == null)
    ) {
      toast.error("Cette commande ne peut pas être chargée dans le panier.", {
        description:
          "Un produit de cette commande n'est plus disponible au catalogue.",
      });
      return;
    }
    chargerCommande(edition);
    commandeOuverte.value = null;
    toast.info("Commande chargée dans le panier — ajustez puis validez.");
    router.push("/");
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    chargement.value = null;
  }
}
</script>

<template>
  <Card>
    <CardHeader class="gap-1.5">
      <div class="flex items-center justify-between gap-3">
        <CardTitle class="flex items-center gap-2 text-lg">
          <ClipboardList class="size-5 text-muted-foreground" />
          Mes commandes
        </CardTitle>

        <Button
          v-if="
            anneesFacturesQuery.isPending.value || anneesCommandes.length > 0
          "
          type="button"
          variant="outline"
          size="sm"
          class="shrink-0"
          :disabled="anneesFacturesQuery.isPending.value"
          @click="archivesFacturesOuvertes = true"
        >
          <Download class="size-4" />
          <span class="sm:hidden">
            {{ anneesFacturesQuery.isPending.value ? "Chargement…" : "Factures" }}
          </span>
          <span class="hidden sm:inline">
            {{
              anneesFacturesQuery.isPending.value
                ? "Chargement des factures…"
                : "Télécharger mes factures"
            }}
          </span>
        </Button>
      </div>
      <CardDescription>
        Consultez vos commandes et retrouvez vos documents.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div
        v-if="isPending"
        class="divide-y"
        aria-label="Chargement des commandes"
        aria-busy="true"
      >
        <div
          v-for="i in 4"
          :key="i"
          class="flex flex-wrap items-center justify-between gap-3 py-5 first:pt-0"
        >
          <div class="grid gap-2">
            <div class="flex items-center gap-2">
              <Skeleton class="h-4 w-32" />
              <Skeleton class="h-5 w-20 rounded-full" />
            </div>
            <Skeleton class="h-3 w-24" />
          </div>
          <div class="flex items-center gap-3">
            <Skeleton class="h-4 w-20" />
            <Skeleton class="h-8 w-20 rounded-md" />
          </div>
        </div>
      </div>

      <p v-else-if="isError" class="text-sm text-destructive">
        {{ (error as Error)?.message }}
      </p>

      <template v-else>
        <p
          v-if="data?.indisponible && data.source === 'local'"
          class="mb-3 text-xs text-muted-foreground"
        >
          Vos commandes les plus récentes s’affichent. La liste complète se met
          à jour dans un instant.
        </p>

        <div
          v-if="!data?.commandes.length"
          class="grid justify-items-center gap-4 py-10 text-center"
        >
          <span
            class="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"
          >
            <ClipboardList class="size-6" />
          </span>
          <div class="grid gap-1">
            <p class="font-medium">Aucune commande pour l’instant.</p>
            <p class="text-sm text-muted-foreground">
              Parcourez la boutique et composez votre première commande.
            </p>
          </div>
          <Button as-child>
            <RouterLink :to="{ name: 'boutique' }">
              <Store aria-hidden="true" />
              Découvrir la boutique
            </RouterLink>
          </Button>
        </div>

        <ul v-else class="divide-y">
          <li v-for="cmd in data.commandes" :key="cmd.idCommande" class="py-3">
            <button
              class="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg p-2 text-left transition-colors"
              :class="
                data?.source === 'local'
                  ? 'cursor-default'
                  : 'hover:bg-muted/60'
              "
              @click="
                data?.source === 'local'
                  ? undefined
                  : (commandeOuverte = cmd.idCommande)
              "
            >
              <span class="grid gap-1">
                <span class="flex items-center gap-2 text-sm font-medium">
                  Commande #{{ cmd.numero ?? cmd.idCommande }}
                  <EtatBadge :etat="cmd.etat" />
                </span>
                <span class="text-xs text-muted-foreground">{{
                  dateFr(cmd.dateCreation)
                }}</span>
              </span>
              <span class="flex items-center gap-3">
                <span class="text-sm font-semibold tabular-nums">
                  {{
                    cmd.totalTTC != null ? `${prixFr(cmd.totalTTC)} TTC` : "—"
                  }}
                </span>
                <ChevronRight
                  v-if="data?.source !== 'local'"
                  class="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <span
                  v-else-if="data?.source === 'local'"
                  class="text-xs text-muted-foreground"
                >
                  Détail indisponible
                </span>
              </span>
            </button>
          </li>
        </ul>
      </template>
    </CardContent>
  </Card>

  <Dialog v-model:open="archivesFacturesOuvertes">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Télécharger mes factures</DialogTitle>
        <DialogDescription>
          Regroupez toutes les factures d’une année dans une archive ZIP.
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-1">
        <div class="grid gap-2">
          <label for="annee-factures" class="text-sm font-medium">
            Année de facturation
          </label>
          <select
            id="annee-factures"
            v-model.number="anneeFactures"
            class="h-10 w-full rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option v-for="annee in anneesCommandes" :key="annee" :value="annee">
              {{ annee }}
            </option>
          </select>
        </div>

        <div class="rounded-lg border bg-muted/30 p-3 text-sm">
          <p
            v-if="disponibiliteFactures.isPending.value"
            class="text-muted-foreground"
          >
            Vérification des factures disponibles…
          </p>
          <p
            v-else-if="disponibiliteFactures.data.value?.disponible"
            class="font-medium text-foreground"
          >
            Vos factures {{ anneeFactures }} sont prêtes à être regroupées.
          </p>
          <p
            v-else-if="disponibiliteFactures.isError.value"
            class="text-destructive"
          >
            Disponibilité momentanément impossible à vérifier.
          </p>
          <p v-else class="text-muted-foreground">
            Aucune facture disponible pour {{ anneeFactures }}.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button
          type="button"
          class="w-full"
          :disabled="
            telechargementFactures ||
            disponibiliteFactures.isPending.value ||
            disponibiliteFactures.isError.value ||
            !disponibiliteFactures.data.value?.disponible
          "
          @click="telechargerFacturesAnnuelles"
        >
          <Download class="size-4" />
          {{
            telechargementFactures
              ? "Préparation de l’archive…"
              : "Télécharger le ZIP"
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <CommandeDetailDialog
    v-model:id-commande="commandeOuverte"
    contexte="client"
    :ids-commandes="
      data?.commandes.map((commande) => commande.idCommande) ?? []
    "
  >
    <template v-if="commandeSelectionnee" #actions>
      <div class="grid gap-2 sm:flex sm:justify-end">
        <div class="grid gap-2 sm:flex">
          <Button
            class="transition-transform duration-200 active:scale-[0.97]"
            :disabled="recommandeBloquee"
            :title="
              recommandeBloquee
                ? 'Terminez la modification en cours pour recommander'
                : 'Remettre cette commande dans le panier'
            "
            @click="recommander(commandeSelectionnee)"
          >
            <RotateCcw class="size-4" />
            Recommander
          </Button>
          <Button
            v-if="commandeSelectionnee.modifiable"
            variant="secondary"
            :disabled="chargement === commandeSelectionnee.idCommande"
            @click="modifier(commandeSelectionnee)"
          >
            <Pencil class="size-4" />
            {{
              chargement === commandeSelectionnee.idCommande
                ? "Chargement…"
                : "Modifier"
            }}
          </Button>
        </div>
      </div>
    </template>
  </CommandeDetailDialog>

  <RecommanderDialog
    v-model:open="recommandeOuvert"
    :commande="commandeARecommander"
  />

  <Dialog v-model:open="confirmationOuverte">
    <DialogContent class="sm:max-w-md">
      <template v-if="confirmation">
        <div
          class="confirmation-succes mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <CircleCheck class="size-6" />
        </div>
        <DialogHeader class="text-center sm:text-center">
          <DialogTitle>{{
            confirmation.modification
              ? "Commande mise à jour"
              : "Commande envoyée"
          }}</DialogTitle>
          <DialogDescription>
            Votre commande a bien été transmise à GOA<template
              v-if="confirmation.numero"
            >
              (#{{ confirmation.numero }})</template
            >.
          </DialogDescription>
        </DialogHeader>

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
          <Button class="w-full" @click="confirmationOuverte = false"
            >Fermer</Button
          >
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.confirmation-succes {
  animation: confirmation-succes 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

@keyframes confirmation-succes {
  0% {
    opacity: 0;
    transform: scale(0.82);
  }

  62% {
    transform: scale(1.04);
  }

  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .confirmation-succes {
    animation: none;
  }
}
</style>
