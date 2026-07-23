<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ClipboardList, RotateCcw } from "@lucide/vue";
import { useQuery } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { api } from "@/lib/api";
import type {
  CommandeDetail,
  CommandeEdition,
  CommandeResume,
  CommandesClientResponse,
} from "@/lib/types";
import { dateFr, prixFr } from "@/lib/format";
import EtatBadge from "@/components/EtatBadge.vue";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const router = useRouter();
const { chargerCommande, modification } = usePanier();

const { data, isPending, isError, error, refetch } = useQuery({
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

// --- Détail dépliable (lignes + documents) ---

const detailOuvert = ref<number | null>(null);
const details = ref<Record<number, CommandeDetail | "chargement" | "erreur">>(
  {},
);

async function basculerDetail(idCommande: number) {
  if (detailOuvert.value === idCommande) {
    detailOuvert.value = null;
    return;
  }
  detailOuvert.value = idCommande;
  if (details.value[idCommande] && details.value[idCommande] !== "erreur")
    return;
  details.value[idCommande] = "chargement";
  try {
    details.value[idCommande] = await api.get<CommandeDetail>(
      `/commandes/${idCommande}`,
    );
  } catch (e) {
    details.value[idCommande] = "erreur";
    if ((e as Error).message.toLowerCase().includes("introuvable")) {
      toast.info(
        "Cette commande n’existe plus dans Easybeer. La liste a été actualisée.",
      );
      detailOuvert.value = null;
      await refetch();
      return;
    }
    toast.error((e as Error).message);
  }
}

const telechargementEnCours = ref<number | null>(null);

/** Décomposition des totaux : sous-total HT, remise, TVA (TTC − HT), total TTC. */
function lignesTotaux(detail: CommandeDetail) {
  const lignes: {
    label: string;
    valeur: string;
    classe?: string;
    remiseLabels?: string[];
  }[] = [];
  const muted = "text-muted-foreground";
  if (detail.totalHT != null)
    lignes.push({
      label: "Sous-total HT",
      valeur: prixFr(detail.totalHT),
      classe: muted,
    });
  if (detail.remiseTotale) {
    const remisesLignes = [
      ...new Set(
        detail.lignes
          .map((ligne) => ligne.remiseLabel)
          .filter((label): label is string => Boolean(label)),
      ),
    ];
    lignes.push({
      label: "Votre remise",
      valeur: `− ${prixFr(detail.remiseTotale)}`,
      classe: "text-green-700",
      remiseLabels: remisesLignes.length
        ? remisesLignes
        : detail.remiseLabel
          ? [detail.remiseLabel]
          : [],
    });
  }
  if (detail.totalHT != null && detail.totalTTC != null) {
    lignes.push({
      label: "TVA (5,5 %)",
      valeur: prixFr(Math.max(0, detail.totalTTC - detail.totalHT)),
      classe: muted,
    });
  }
  if (detail.totalTTC != null)
    lignes.push({
      label: "Total TTC",
      valeur: prixFr(detail.totalTTC),
      classe: "font-semibold",
    });
  return lignes;
}

async function telechargerDocument(
  idCommande: number,
  doc: CommandeDetail["documents"][number],
) {
  telechargementEnCours.value = doc.idCommandeDocument;
  try {
    await api.telecharger(
      `/commandes/${idCommande}/documents/${doc.idCommandeDocument}/pdf`,
      doc.nomFichier,
    );
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    telechargementEnCours.value = null;
  }
}

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
                  : basculerDetail(cmd.idCommande)
              "
            >
              <span class="grid gap-1">
                <span class="flex items-center gap-2 text-sm font-medium">
                  Commande #{{ cmd.numero ?? cmd.idCommande }}
                  <EtatBadge :etat="cmd.etat" />
                  <span
                    v-if="data?.source !== 'local'"
                    class="text-xs text-muted-foreground"
                  >
                    {{ detailOuvert === cmd.idCommande ? "▲" : "▼" }}
                  </span>
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

            <div
              v-if="data?.source !== 'local' && detailOuvert === cmd.idCommande"
              class="mt-3 rounded-lg bg-muted/50 p-3"
            >
              <div
                v-if="details[cmd.idCommande] === 'chargement'"
                class="grid gap-2"
                aria-label="Chargement du détail de la commande"
                aria-busy="true"
              >
                <div class="hidden grid-cols-[1fr_3rem_7rem_5rem_5rem_6rem] gap-3 md:grid">
                  <Skeleton v-for="i in 6" :key="`entete-${i}`" class="h-4" />
                </div>
                <div
                  v-for="ligne in 2"
                  :key="ligne"
                  class="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-[1fr_3rem_7rem_5rem_5rem_6rem] md:items-center md:border-0 md:p-2"
                >
                  <Skeleton class="h-4 w-3/4" />
                  <Skeleton v-for="i in 5" :key="i" class="h-4 w-full" />
                </div>
                <div class="ml-auto grid w-44 gap-2 pt-2">
                  <Skeleton class="h-4 w-full" />
                  <Skeleton class="h-5 w-full" />
                </div>
              </div>
              <p
                v-else-if="details[cmd.idCommande] === 'erreur'"
                class="text-sm text-destructive"
              >
                Impossible de charger le détail.
              </p>
              <template v-else-if="typeof details[cmd.idCommande] === 'object'">
                <dl
                  v-if="(details[cmd.idCommande] as CommandeDetail).modeLivraison"
                  class="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border bg-background px-3 py-2 text-sm"
                >
                  <dt class="text-muted-foreground">Mode de livraison</dt>
                  <dd class="font-medium">
                    {{ (details[cmd.idCommande] as CommandeDetail).modeLivraison }}
                  </dd>
                </dl>
                <div class="overflow-hidden rounded-lg border bg-background">
                  <Table>
                    <TableHeader class="[&_tr]:bg-muted">
                      <TableRow>
                        <TableHead>Produit</TableHead>
                        <TableHead class="text-right">Qté</TableHead>
                        <TableHead class="text-right"
                          >Prix unitaire HT</TableHead
                        >
                        <TableHead class="text-right">Remise</TableHead>
                        <TableHead class="text-right">TVA</TableHead>
                        <TableHead class="text-right">Total HT</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow
                        v-for="(l, i) in (
                          details[cmd.idCommande] as CommandeDetail
                        ).lignes"
                        :key="i"
                        class="odd:bg-background even:bg-muted/45"
                      >
                        <TableCell class="font-medium">{{
                          l.designation
                        }}</TableCell>
                        <TableCell class="text-right tabular-nums">{{
                          l.quantite
                        }}</TableCell>
                        <TableCell
                          class="text-right tabular-nums text-muted-foreground"
                        >
                          {{
                            l.prixUnitaireHT != null
                              ? prixFr(l.prixUnitaireHT)
                              : "—"
                          }}
                        </TableCell>
                        <TableCell class="text-right tabular-nums">
                          <span
                            v-if="l.remiseLabel || l.remiseMontant"
                            class="inline-grid justify-items-end gap-1"
                          >
                            <Badge
                              v-if="l.remiseLabel"
                              variant="secondary"
                              class="border border-green-200 bg-green-50 text-green-700"
                            >
                              {{ l.remiseLabel }}
                            </Badge>
                            <span v-if="l.remiseMontant" class="text-green-700"
                              >− {{ prixFr(l.remiseMontant) }}</span
                            >
                          </span>
                          <span v-else class="text-muted-foreground">—</span>
                        </TableCell>
                        <TableCell
                          class="text-right tabular-nums text-muted-foreground"
                        >
                          {{ l.tvaLigne != null ? prixFr(l.tvaLigne) : "—" }}
                        </TableCell>
                        <TableCell
                          class="text-right tabular-nums text-muted-foreground"
                        >
                          <span>{{
                            l.totalHT != null ? prixFr(l.totalHT) : "—"
                          }}</span>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <!-- Totaux : HT / remise / TVA / TTC -->
                <dl
                  v-if="
                    (details[cmd.idCommande] as CommandeDetail).totalTTC != null
                  "
                  class="mt-3 grid gap-1 border-t pt-3 text-sm"
                >
                  <template
                    v-for="ligne in lignesTotaux(
                      details[cmd.idCommande] as CommandeDetail,
                    )"
                    :key="ligne.label"
                  >
                    <div
                      class="flex items-baseline justify-between gap-3"
                      :class="ligne.classe"
                    >
                      <dt>
                        {{ ligne.label }}
                        <Badge
                          v-for="remiseLabel in ligne.remiseLabels ?? []"
                          :key="remiseLabel"
                          variant="secondary"
                          class="ml-1 align-middle border border-green-200 bg-green-50 text-green-700"
                        >
                          {{ remiseLabel }}
                        </Badge>
                      </dt>
                      <dd class="tabular-nums">{{ ligne.valeur }}</dd>
                    </div>
                  </template>
                </dl>
                <p
                  v-if="(details[cmd.idCommande] as CommandeDetail).commentaire"
                  class="mt-2 text-xs text-muted-foreground italic"
                >
                  «
                  {{
                    (details[cmd.idCommande] as CommandeDetail).commentaire
                  }}
                  »
                </p>
                <div
                  v-if="
                    (details[cmd.idCommande] as CommandeDetail).documents.length
                  "
                  class="mt-3 flex flex-wrap justify-end gap-2 border-t pt-3"
                >
                  <Button
                    v-for="doc in (details[cmd.idCommande] as CommandeDetail)
                      .documents"
                    :key="doc.idCommandeDocument"
                    variant="outline"
                    size="sm"
                    :disabled="telechargementEnCours === doc.idCommandeDocument"
                    @click="telechargerDocument(cmd.idCommande, doc)"
                  >
                    ⤓ {{ doc.libelle }} {{ doc.code }}
                  </Button>
                </div>
                <p
                  v-else
                  class="mt-3 border-t pt-3 text-xs text-muted-foreground"
                >
                  Aucun document pour cette commande.
                </p>
              </template>
            </div>
          </li>
        </ul>
      </template>
    </CardContent>
  </Card>

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
