<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ClipboardList, RotateCcw } from "@lucide/vue";
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

function recommander(commande: CommandeResume) {
  if (recommandeBloquee.value) {
    toast.info(
      `Vous modifiez la commande #${modification.value?.numero ?? modification.value?.idCommande}.`,
      { description: "Validez ou annulez cette modification avant d'en recommander une autre." },
    );
    return;
  }
  commandeARecommander.value = commande;
  recommandeOuvert.value = true;
}

// --- Détail en popup, identique à l'administration ---

const commandeOuverte = ref<number | null>(null);

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
    if (!edition.lignes.length || edition.lignes.some((ligne) => ligne.idStockBouteille == null)) {
      toast.error("Cette commande ne peut pas être chargée dans le panier.", {
        description: "Un produit de la commande n'est plus identifiable dans Easybeer.",
      });
      return;
    }
    chargerCommande(edition);
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
    <CardHeader>
      <CardTitle class="flex items-center gap-2 text-lg">
        <ClipboardList class="size-5 text-muted-foreground" />
        Mes commandes
      </CardTitle>
      <CardDescription> </CardDescription>
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
          Historique Easybeer temporairement indisponible. Affichage des
          commandes envoyées depuis cette plateforme.
        </p>

        <p
          v-if="data?.indisponible && !data.commandes.length"
          class="text-sm text-muted-foreground"
        >
          Votre historique sera disponible dès qu'Easybeer répondra à nouveau.
        </p>

        <p
          v-else-if="!data?.commandes.length"
          class="text-sm text-muted-foreground"
        >
          Aucune commande pour l'instant.
        </p>

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
                <Button
                  v-if="data?.source !== 'local'"
                  variant="outline"
                  size="sm"
                  :disabled="recommandeBloquee"
                  :title="
                    recommandeBloquee
                      ? 'Terminez la modification en cours pour recommander'
                      : 'Remettre cette commande dans le panier'
                  "
                  @click.stop="recommander(cmd)"
                >
                  <RotateCcw class="size-4" />
                  Recommander
                </Button>
                <Button
                  v-if="cmd.modifiable"
                  variant="outline"
                  size="sm"
                  :disabled="chargement === cmd.idCommande"
                  @click.stop="modifier(cmd)"
                >
                  {{
                    chargement === cmd.idCommande ? "Chargement…" : "Modifier"
                  }}
                </Button>
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

  <CommandeDetailDialog
    v-model:id-commande="commandeOuverte"
    contexte="client"
    :ids-commandes="data?.commandes.map((commande) => commande.idCommande) ?? []"
  />

  <RecommanderDialog
    v-model:open="recommandeOuvert"
    :commande="commandeARecommander"
  />

  <Dialog v-model:open="confirmationOuverte">
    <DialogContent class="sm:max-w-md">
      <template v-if="confirmation">
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
