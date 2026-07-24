<script setup lang="ts">
import { computed, h, reactive, ref, watch } from "vue";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Info,
  MailX,
  Users,
} from "@lucide/vue";
import { useRouter } from "vue-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  FlexRender,
  getCoreRowModel,
  useVueTable,
  type ColumnDef,
} from "@tanstack/vue-table";
import { toast } from "vue-sonner";
import { api } from "@/lib/api";
import type {
  AdminClientsResponse,
  ClientResume,
  InvitationBulkResultat,
  Tournee,
} from "@/lib/types";
import { dateHeureFr, prixFr } from "@/lib/format";
import { easybeerLien } from "@/lib/easybeer";
import BoutonActualiser from "@/components/admin/BoutonActualiser.vue";
import EasybeerLink from "@/components/admin/EasybeerLink.vue";
import EasybeerIndisponible from "@/components/admin/EasybeerIndisponible.vue";
import { signalerBanEasybeer } from "@/composables/useEasybeerBan";
import { useTriPersistant } from "@/composables/useTriPersistant";
import { useSyncEnCours } from "@/composables/useSyncEnCours";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const router = useRouter();
const queryClient = useQueryClient();

// --- Clients : servis depuis le CACHE serveur (recherche/pagination locales) ---

const { data, isPending, isError, error } = useQuery({
  queryKey: ["admin", "clients"],
  queryFn: () => api.get<AdminClientsResponse>("/admin/clients"),
  // Liste ancienne rendue tout de suite pendant que le serveur revalide en fond.
  refetchInterval: (query) =>
    query.state.data?.revalidationEnCours ? 30000 : false,
});

watch(data, (d) => {
  if (d?.indisponible && d.retryAfterSeconds)
    signalerBanEasybeer(d.retryAfterSeconds);
});

const { syncEnCours } = useSyncEnCours();

const actualisation = useMutation({
  mutationFn: () => api.get<AdminClientsResponse>("/admin/clients?refresh=1"),
  onSuccess: (res) => {
    queryClient.setQueryData(["admin", "clients"], res);
    if (res.revalidationEchouee) {
      toast.warning("Actualisation Easybeer impossible.", {
        description: "La dernière liste en cache reste affichée.",
      });
      return;
    }
    if (res.revalidationEnCours) {
      toast.info("Une actualisation est déjà en cours.");
      return;
    }
    toast.success("Clients actualisés.", {
      description: "Les données clients ont été mises à jour.",
    });
  },
  onError: (e) => toast.error((e as Error).message),
});

const recherche = ref("");
const page = ref(1);
const optionsLignesParPage = [10, 25, 50, 100];
const lignesParPage = ref(25);
type CleTriClient = "commerce" | "email" | "categorie" | "compte";
const clesTriClient: CleTriClient[] = ["commerce", "email", "categorie", "compte"];
const tri = useTriPersistant<CleTriClient>(
  "goa-admin-clients-tri-v1",
  { cle: "commerce", direction: "asc" },
  clesTriClient,
);

const clientsFiltres = computed(() => {
  const q = recherche.value.trim().toLowerCase();
  const tous = data.value?.clients ?? [];
  if (!q) return tous;
  return tous.filter((c) =>
    [c.nom, c.raisonSociale, c.numero, c.emailPrincipal, c.categorie].some(
      (v) => v?.toLowerCase().includes(q),
    ),
  );
});

function valeurTriClient(client: ClientResume, cle: CleTriClient) {
  switch (cle) {
    case "commerce":
      return `${client.nom ?? client.raisonSociale ?? ""} ${client.numero ?? ""}`.toLowerCase();
    case "email":
      return client.emailPrincipal?.toLowerCase() ?? "";
    case "categorie":
      return client.categorie?.toLowerCase() ?? "";
    case "compte": {
      const compte = compteDe(client);
      return compte?.statut ?? "";
    }
  }
}

function basculerTri(cle: CleTriClient) {
  tri.value =
    tri.value.cle === cle
      ? { cle, direction: tri.value.direction === "asc" ? "desc" : "asc" }
      : { cle, direction: "asc" };
  page.value = 1;
}

const clientsTries = computed(() =>
  [...clientsFiltres.value].sort((a, b) => {
    const resultat = String(valeurTriClient(a, tri.value.cle)).localeCompare(
      String(valeurTriClient(b, tri.value.cle)),
      "fr",
      { numeric: true, sensitivity: "base" },
    );
    return tri.value.direction === "asc" ? resultat : -resultat;
  }),
);

const totalClients = computed(() => clientsTries.value.length);
const totalPages = computed(() =>
  Math.max(1, Math.ceil(totalClients.value / lignesParPage.value)),
);
const debutPagination = computed(() =>
  totalClients.value === 0 ? 0 : (page.value - 1) * lignesParPage.value + 1,
);
const finPagination = computed(() =>
  Math.min(totalClients.value, page.value * lignesParPage.value),
);
const clientsAffiches = computed(() => {
  const debut = (Math.min(page.value, totalPages.value) - 1) * lignesParPage.value;
  return clientsTries.value.slice(debut, debut + lignesParPage.value);
});

watch(totalPages, (pages) => {
  if (page.value > pages) page.value = pages;
});

function surRecherche() {
  page.value = 1;
}

function changerLignesParPage(valeur: unknown) {
  const prochaineValeur = Number(valeur);
  if (!Number.isFinite(prochaineValeur)) return;
  lignesParPage.value = prochaineValeur;
  page.value = 1;
}

function allerPage(delta: number) {
  page.value = Math.min(totalPages.value, Math.max(1, page.value + delta));
}

// --- Sélection (checkbox, conservée à travers pages et recherches) ---

const selection = reactive(new Set<number>());

const idsSelectionnables = computed(() =>
  clientsTries.value
    .map((c) => c.idClient)
    .filter((id): id is number => id != null),
);
const toutSelectionne = computed(
  () =>
    idsSelectionnables.value.length > 0 &&
    idsSelectionnables.value.every((id) => selection.has(id)),
);

const idsSelectionInvitation = computed(() =>
  [...selection].filter((id) => !data.value?.comptes?.[id]),
);

function basculerTout(coche: boolean) {
  for (const id of idsSelectionnables.value) {
    if (coche) selection.add(id);
    else selection.delete(id);
  }
}

// --- Invitations en masse ---

const dialogBulkInvitations = ref(false);
const resultatsBulk = ref<InvitationBulkResultat[] | null>(null);
const invitationsEnvoyees = computed(
  () => resultatsBulk.value?.filter((resultat) => resultat.ok && resultat.envoye) ?? [],
);
const invitationsNonEnvoyees = computed(
  () => resultatsBulk.value?.filter((resultat) => !resultat.ok || !resultat.envoye) ?? [],
);

function nomResultatInvitation(resultat: InvitationBulkResultat) {
  const client = data.value?.clients.find(
    (item) => item.idClient === resultat.easybeerIdClient,
  );
  return (
    resultat.client?.nom ??
    client?.nom ??
    client?.raisonSociale ??
    `Client ${resultat.easybeerIdClient}`
  );
}

function motifInvitationNonEnvoyee(resultat: InvitationBulkResultat) {
  if (resultat.erreur?.includes("pas d'email dans Easybeer")) {
    return "Aucune adresse e-mail renseignée dans Easybeer";
  }
  if (resultat.erreurEmail) return "L’e-mail n’a pas pu être envoyé";
  return resultat.erreur ?? "L’e-mail n’a pas pu être envoyé";
}

const bulkInvitations = useMutation({
  mutationFn: () =>
    api.post<{
      resultats: InvitationBulkResultat[];
      reussies: number;
      envoyees: number;
    }>("/admin/invitations/bulk", {
      invitations: idsSelectionInvitation.value.map((easybeerIdClient) => ({
        easybeerIdClient,
      })),
    }),
  onSuccess: (res) => {
    resultatsBulk.value = res.resultats;
    toast.success(
      `${res.envoyees}/${res.resultats.length} email(s) d'invitation envoyé(s).`,
    );
    selection.clear();
    queryClient.invalidateQueries({ queryKey: ["admin", "clients"] });
  },
  onError: (e) => toast.error((e as Error).message),
});

function ouvrirBulkInvitations() {
  resultatsBulk.value = null;
  dialogBulkInvitations.value = true;
}

// --- Paramètres en masse (tournée / mode de livraison / minimum) ---

const dialogParams = ref(false);
const typeParametreChoisi = ref<"tournee" | "livraison" | "minimum">("tournee");
const tourneeChoisie = ref<string>("");
const livraisonChoisie = ref<string>("");
const minimumSaisi = ref<string | number>("");
const minimumSaisiNormalise = computed(() => String(minimumSaisi.value).trim());
const progressionMinimum = ref<{ traites: number; total: number } | null>(null);

const referentiels = useQuery({
  queryKey: ["admin", "tournees"],
  queryFn: () =>
    api.get<{
      tournees: Tournee[];
      typesLivraison: { code: string; libelle: string }[];
    }>("/admin/tournees"),
  enabled: dialogParams,
});

function confirmationParametreEnCours() {
  if (typeParametreChoisi.value === "tournee") {
    const tournee = referentiels.data.value?.tournees.find(
      (item) => String(item.idClientTournee) === tourneeChoisie.value,
    );
    return {
      titre: "Tournée appliquée",
      valeur: tournee?.libelle ? `Tournée : ${tournee.libelle}` : "Tournée mise à jour",
    };
  }
  if (typeParametreChoisi.value === "livraison") {
    const livraison = referentiels.data.value?.typesLivraison.find(
      (item) => item.code === livraisonChoisie.value,
    );
    return {
      titre: "Mode de livraison appliqué",
      valeur: livraison?.libelle
        ? `Mode de livraison : ${livraison.libelle}`
        : "Mode de livraison mis à jour",
    };
  }
  return {
    titre: "Minimum de commande appliqué",
    valeur: `Minimum : ${prixFr(Number(minimumSaisi.value))} HT`,
  };
}

const bulkParams = useMutation({
  mutationFn: async () => {
    const idsClients = [...selection];
    const endpoint = "/admin/clients/bulk-params";
    const confirmation = confirmationParametreEnCours();

    if (typeParametreChoisi.value !== "minimum") {
      const resultat = await api.post<{ ok: boolean; clients: number; erreurs: string[] }>(endpoint, {
        idsClients,
        ...(typeParametreChoisi.value === "tournee" && tourneeChoisie.value
          ? { idClientTournee: Number(tourneeChoisie.value) }
          : {}),
        ...(typeParametreChoisi.value === "livraison" && livraisonChoisie.value
          ? { typeLivraison: livraisonChoisie.value }
          : {}),
      });
      return { ...resultat, confirmation, idsClients };
    }

    // Easybeer impose une mise à jour fiche par fiche pour le minimum. L'admin
    // garde une seule sélection/un seul clic ; le navigateur découpe le travail
    // en requêtes assez courtes pour éviter un timeout serveur.
    const tailleLot = 30;
    const erreurs: string[] = [];
    let traites = 0;
    progressionMinimum.value = { traites, total: idsClients.length };
    for (let debut = 0; debut < idsClients.length; debut += tailleLot) {
      const lot = idsClients.slice(debut, debut + tailleLot);
      const resultat = await api.post<{ ok: boolean; clients: number; erreurs: string[] }>(endpoint, {
        idsClients: lot,
        minimumCommande: Number(minimumSaisi.value),
      });
      erreurs.push(...resultat.erreurs);
      traites += lot.length;
      progressionMinimum.value = { traites, total: idsClients.length };
    }
    return { ok: erreurs.length === 0, clients: traites, erreurs, confirmation, idsClients };
  },
  onSuccess: (res) => {
    const clientsTraites = `${res.clients} client${res.clients > 1 ? "s" : ""} traité${res.clients > 1 ? "s" : ""}`;
    if (res.erreurs.length) {
      toast.warning(`${res.confirmation.titre} avec avertissement`, {
        description: `${res.confirmation.valeur} · ${clientsTraites}. ${res.erreurs.length} avertissement${res.erreurs.length > 1 ? "s" : ""} : ${res.erreurs[0]}`,
        duration: 7000,
      });
    } else {
      toast.success(res.confirmation.titre, {
        description: `${res.confirmation.valeur} · ${clientsTraites} dans Easybeer.`,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["admin", "clients"] });
    // Une fiche déjà consultée peut rester en mémoire pendant la navigation.
    // Toutes les fiches touchées sont marquées périmées afin que leur prochaine
    // ouverture relise immédiatement Easybeer et réaffiche les nouvelles valeurs.
    for (const idClient of res.idsClients) {
      queryClient.invalidateQueries({ queryKey: ["admin", "client", idClient] });
    }
    selection.clear();
    dialogParams.value = false;
    typeParametreChoisi.value = "tournee";
    tourneeChoisie.value = "";
    livraisonChoisie.value = "";
    minimumSaisi.value = "";
    progressionMinimum.value = null;
  },
  onError: (e) => {
    progressionMinimum.value = null;
    toast.error((e as Error).message);
  },
});

const bulkParamsValide = computed(
  () => {
    if (typeParametreChoisi.value === "tournee") return Boolean(tourneeChoisie.value);
    if (typeParametreChoisi.value === "livraison") return Boolean(livraisonChoisie.value);
    return minimumSaisiNormalise.value !== "" && Number(minimumSaisi.value) >= 0;
  },
);

// --- Table ---

function compteDe(c: ClientResume) {
  return c.idClient != null ? data.value?.comptes?.[c.idClient] : undefined;
}

function enteteTri(cle: CleTriClient, label: string) {
  const Icone =
    tri.value.cle === cle
      ? tri.value.direction === "asc"
        ? ArrowUp
        : ArrowDown
      : ArrowUpDown;
  return h(
    "button",
    {
      class:
        "inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground/80 transition-colors hover:bg-background/80",
      onClick: () => basculerTri(cle),
    },
    [
      label,
      h(Icone, {
        class:
          tri.value.cle === cle ? "size-3" : "size-3 text-muted-foreground",
      }),
    ],
  );
}

const columns: ColumnDef<ClientResume>[] = [
  {
    id: "selection",
    header: () =>
      h(Checkbox, {
        modelValue: toutSelectionne.value,
        "aria-label": "Tout sélectionner",
        "onUpdate:modelValue": (v: boolean | "indeterminate") =>
          basculerTout(v === true),
      }),
    cell: ({ row }) => {
      const id = row.original.idClient;
      if (id == null) return null;
      return h(Checkbox, {
        modelValue: selection.has(id),
        "aria-label": `Sélectionner ${row.original.nom}`,
        "onUpdate:modelValue": (v: boolean | "indeterminate") => {
          if (v === true) selection.add(id);
          else selection.delete(id);
        },
        onClick: (e: Event) => e.stopPropagation(),
      });
    },
  },
  {
    id: "commerce",
    header: () => enteteTri("commerce", "Commerce"),
    cell: ({ row }) =>
      h("div", { class: "min-w-40" }, [
        h(
          "p",
          { class: "font-medium" },
          row.original.nom ?? row.original.raisonSociale ?? "—",
        ),
        h(
          "p",
          { class: "text-xs text-muted-foreground" },
          row.original.numero ?? "",
        ),
      ]),
  },
  {
    id: "email",
    header: () => enteteTri("email", "Email"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "text-sm text-muted-foreground" },
        row.original.emailPrincipal || "—",
      ),
  },
  {
    id: "categorie",
    header: () => enteteTri("categorie", "Catégorie"),
    cell: ({ row }) =>
      h("span", { class: "text-sm" }, row.original.categorie ?? "—"),
  },
  {
    id: "compte",
    header: () => enteteTri("compte", "Compte"),
    cell: ({ row }) => {
      const compte = compteDe(row.original);
      if (!compte)
        return h("span", { class: "text-sm text-muted-foreground" }, "—");
      if (compte.statut === "active") return h(Badge, () => "Actif");
      if (compte.statut === "revoked")
        return h(Badge, { variant: "destructive" }, () => "Révoqué");
      return h(Badge, { variant: "secondary" }, () => "Invité");
    },
  },
];

const table = useVueTable({
  get data() {
    return clientsAffiches.value;
  },
  columns,
  getCoreRowModel: getCoreRowModel(),
});

function ouvrirFiche(client: ClientResume) {
  if (client.idClient != null) router.push(`/admin/clients/${client.idClient}`);
}
</script>

<template>
  <div class="grid gap-4">
    <Card>
      <CardHeader class="gap-3">
        <div class="grid gap-3 sm:flex sm:items-start sm:justify-between">
          <div class="flex min-w-0 items-center justify-between gap-3 sm:block">
            <CardTitle class="flex items-center gap-2 text-lg">
              <Users class="size-5 text-muted-foreground" />
              Clients
            </CardTitle>
            <EasybeerLink
              :href="easybeerLien.clients()"
              label="Ouvrir les clients dans Easybeer"
              class="shrink-0 text-muted-foreground sm:hidden"
            />
          </div>
          <div class="grid justify-items-start gap-2 sm:justify-items-end">
            <div class="flex items-center gap-2">
              <Skeleton v-if="isPending" class="h-3 w-36" />
              <p v-else-if="data?.syncedAt" class="text-xs whitespace-nowrap text-muted-foreground">
                Dernière mise à jour : {{ dateHeureFr(data.syncedAt) }}
              </p>
              <EasybeerLink
                :href="easybeerLien.clients()"
                label="Ouvrir les clients dans Easybeer"
                class="hidden text-muted-foreground sm:inline-flex"
              />
            </div>
            <BoutonActualiser
              label="Actualiser les clients"
              :pending="actualisation.isPending.value || syncEnCours"
              @click="actualisation.mutate()"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent class="grid gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <Input
            v-model="recherche"
            placeholder="Rechercher (nom, n°, email, catégorie)…"
            class="max-w-xs"
            @input="surRecherche"
          />
        </div>

        <!-- Barre d'actions en masse -->
        <div
          v-if="selection.size > 0"
          class="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2"
        >
          <p class="text-sm font-medium">{{ selection.size }} sélectionné(s)</p>
          <Button
            v-if="idsSelectionInvitation.length"
            size="sm"
            :disabled="bulkInvitations.isPending.value"
            @click="ouvrirBulkInvitations"
          >
            Inviter la sélection
          </Button>
          <Button size="sm" variant="outline" @click="dialogParams = true">
            Paramètres en masse
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="text-muted-foreground"
            @click="selection.clear()"
          >
            Tout désélectionner
          </Button>
        </div>

        <div
          v-if="isPending"
          class="grid gap-3"
          aria-label="Chargement des clients"
          aria-busy="true"
        >
          <div class="grid gap-3 md:hidden">
            <div v-for="i in 5" :key="i" class="grid gap-3 rounded-xl border p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="grid flex-1 gap-2">
                  <Skeleton class="h-4 w-2/3" />
                  <Skeleton class="h-3 w-24" />
                </div>
                <Skeleton class="size-5 rounded" />
              </div>
              <div class="grid grid-cols-2 gap-2">
                <Skeleton class="h-4 w-4/5" />
                <Skeleton class="h-4 w-3/4" />
                <Skeleton class="h-4 w-full" />
                <Skeleton class="h-5 w-16 rounded-full" />
              </div>
            </div>
          </div>
          <div class="hidden overflow-hidden rounded-lg border md:block">
            <div class="grid grid-cols-[2rem_1.2fr_.7fr_1.4fr_.8fr_.6fr] gap-4 bg-muted p-3">
              <Skeleton v-for="i in 6" :key="`head-${i}`" class="h-4" />
            </div>
            <div
              v-for="ligne in 6"
              :key="ligne"
              class="grid grid-cols-[2rem_1.2fr_.7fr_1.4fr_.8fr_.6fr] items-center gap-4 border-t p-3"
            >
              <Skeleton class="size-4 rounded" />
              <Skeleton class="h-4 w-4/5" />
              <Skeleton class="h-4 w-16" />
              <Skeleton class="h-4 w-5/6" />
              <Skeleton class="h-5 w-20 rounded-full" />
              <Skeleton class="h-7 w-16 rounded-md" />
            </div>
          </div>
          <div class="flex items-center justify-between gap-3">
            <Skeleton class="h-4 w-32" />
            <div class="flex gap-2">
              <Skeleton class="h-8 w-20 rounded-md" />
              <Skeleton class="h-8 w-20 rounded-md" />
            </div>
          </div>
        </div>

        <p v-else-if="isError" class="text-sm text-destructive">
          {{ (error as Error)?.message }}
        </p>

        <EasybeerIndisponible
          v-else-if="data?.indisponible"
          :pending="actualisation.isPending.value || syncEnCours"
          @reessayer="actualisation.mutate()"
        />

        <template v-else>
          <div class="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader class="[&_tr]:bg-muted">
                <TableRow v-for="hg in table.getHeaderGroups()" :key="hg.id">
                  <TableHead v-for="header in hg.headers" :key="header.id">
                    <FlexRender
                      v-if="!header.isPlaceholder"
                      :render="header.column.columnDef.header"
                      :props="header.getContext()"
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow
                  v-for="row in table.getRowModel().rows"
                  :key="row.id"
                  class="cursor-pointer"
                  @click="ouvrirFiche(row.original)"
                >
                  <TableCell
                    v-for="cell in row.getVisibleCells()"
                    :key="cell.id"
                  >
                    <FlexRender
                      :render="cell.column.columnDef.cell"
                      :props="cell.getContext()"
                    />
                  </TableCell>
                </TableRow>
                <TableRow v-if="!table.getRowModel().rows.length">
                  <TableCell
                    :colspan="columns.length"
                    class="h-16 text-center text-muted-foreground"
                  >
                    Aucun client trouvé.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div
            class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
          >
            <span>
              {{ debutPagination }}-{{ finPagination }} / {{ totalClients }} client(s)
            </span>

            <div class="flex flex-wrap items-center gap-2">
              <span class="whitespace-nowrap">Lignes par page</span>
              <Select :model-value="String(lignesParPage)" @update:model-value="changerLignesParPage">
                <SelectTrigger class="h-8 w-20 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in optionsLignesParPage"
                    :key="option"
                    :value="String(option)"
                  >
                    {{ option }}
                  </SelectItem>
                </SelectContent>
              </Select>

              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="page <= 1"
                  @click="allerPage(-1)"
                  >Précédent</Button
                >
                <span class="min-w-24 text-center tabular-nums">
                  Page {{ page }} / {{ totalPages }}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="page >= totalPages"
                  @click="allerPage(1)"
                  >Suivant</Button
                >
              </div>
            </div>
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- Invitations en masse -->
    <Dialog v-model:open="dialogBulkInvitations">
      <DialogContent
        class="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {{
              resultatsBulk
                ? "Résultat des invitations"
                : `Inviter ${idsSelectionInvitation.length} client(s)`
            }}
          </DialogTitle>
          <DialogDescription>
            <template v-if="resultatsBulk">
              L’envoi est terminé. Consultez le récapitulatif ci-dessous.
            </template>
            <template v-else>
              Les invitations seront envoyées aux adresses e-mail enregistrées
              dans Easybeer. Les clients sans adresse seront signalés après
              l’envoi.
            </template>
          </DialogDescription>
        </DialogHeader>

        <div v-if="!resultatsBulk" class="grid gap-4">
          <DialogFooter>
            <Button variant="secondary" @click="dialogBulkInvitations = false"
              >Annuler</Button
            >
            <Button
              :disabled="bulkInvitations.isPending.value"
              @click="bulkInvitations.mutate()"
            >
              {{
                bulkInvitations.isPending.value
                  ? "Envoi…"
                  : "Envoyer les invitations"
              }}
            </Button>
          </DialogFooter>
        </div>

        <div v-else class="grid gap-4">
          <div class="grid grid-cols-2 gap-2">
            <div
              class="rounded-xl border border-emerald-700/15 bg-emerald-50/70 p-3 text-emerald-900"
            >
              <CheckCircle2 class="mb-2 size-5" aria-hidden="true" />
              <p class="text-2xl font-semibold tabular-nums">
                {{ invitationsEnvoyees.length }}
              </p>
              <p class="text-xs font-medium">
                {{
                  invitationsEnvoyees.length > 1
                    ? "Invitations envoyées"
                    : "Invitation envoyée"
                }}
              </p>
            </div>
            <div
              class="rounded-xl border border-amber-700/15 bg-amber-50/70 p-3 text-amber-950"
            >
              <MailX class="mb-2 size-5" aria-hidden="true" />
              <p class="text-2xl font-semibold tabular-nums">
                {{ invitationsNonEnvoyees.length }}
              </p>
              <p class="text-xs font-medium">
                {{
                  invitationsNonEnvoyees.length > 1
                    ? "Non envoyées"
                    : "Non envoyée"
                }}
              </p>
            </div>
          </div>

          <div v-if="invitationsNonEnvoyees.length" class="grid gap-2">
            <p class="text-sm font-semibold">
              Clients à vérifier
            </p>
            <ul class="max-h-48 divide-y overflow-y-auto rounded-xl border">
              <li
                v-for="resultat in invitationsNonEnvoyees"
                :key="resultat.easybeerIdClient"
                class="grid gap-0.5 px-3 py-2.5 text-sm"
              >
                <p class="font-medium">
                  {{ nomResultatInvitation(resultat) }}
                </p>
                <p class="text-xs leading-relaxed text-muted-foreground">
                  {{ motifInvitationNonEnvoyee(resultat) }}
                </p>
              </li>
            </ul>
          </div>

          <div
            v-if="invitationsNonEnvoyees.length"
            class="flex items-start gap-2.5 rounded-xl bg-muted/60 p-3 text-sm"
          >
            <Info class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p class="leading-relaxed text-muted-foreground">
              Les clients sans adresse e-mail renseignée dans Easybeer n’ont
              reçu aucune invitation. La colonne <strong class="text-foreground">Compte</strong>
              permet de les repérer. Ouvrez ensuite leur fiche individuelle pour
              copier leur lien d’invitation unique et leur transmettre par un
              autre moyen.
            </p>
          </div>

          <DialogFooter>
            <Button @click="dialogBulkInvitations = false">Fermer</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Paramètres en masse -->
    <Dialog v-model:open="dialogParams">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Paramètres en masse</DialogTitle>
          <DialogDescription>
            Appliqués aux {{ selection.size }} client(s) sélectionné(s),
            directement dans Easybeer. Choisissez un seul paramètre à appliquer.
          </DialogDescription>
        </DialogHeader>

        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <Label>Paramètre à modifier</Label>
            <Select v-model="typeParametreChoisi">
              <SelectTrigger class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tournee">Tournée</SelectItem>
                <SelectItem value="livraison">Mode de livraison</SelectItem>
                <SelectItem value="minimum">Minimum de commande</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div v-if="typeParametreChoisi === 'tournee'" class="grid gap-1.5">
            <Label>Tournée</Label>
            <Select v-model="tourneeChoisie">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Choisir une tournée" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="t in referentiels.data.value?.tournees ?? []"
                  :key="t.idClientTournee"
                  :value="String(t.idClientTournee)"
                >
                  {{ t.libelle }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div v-if="typeParametreChoisi === 'livraison'" class="grid gap-1.5">
            <Label>Mode de livraison</Label>
            <Select v-model="livraisonChoisie">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Choisir un mode de livraison" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="t in referentiels.data.value?.typesLivraison ?? []"
                  :key="t.code"
                  :value="t.code"
                >
                  {{ t.libelle }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              Seuls les modes validés sur le compte Easybeer sont proposés.
            </p>
          </div>

          <div v-if="typeParametreChoisi === 'minimum'" class="grid gap-1.5">
            <Label for="minimum-bulk">Minimum de commande HT (€)</Label>
            <Input
              id="minimum-bulk"
              v-model="minimumSaisi"
              type="number"
              min="0"
              step="0.01"
              placeholder="Ex. 30"
            />
            <p class="text-xs text-muted-foreground">
              Tous les clients sélectionnés seront traités automatiquement. Pour une
              grande sélection, l'opération peut prendre plusieurs minutes.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" :disabled="bulkParams.isPending.value" @click="dialogParams = false"
            >Annuler</Button
          >
          <Button
            :disabled="!bulkParamsValide || bulkParams.isPending.value"
            @click="bulkParams.mutate()"
          >
            <template v-if="progressionMinimum">
              Application… {{ progressionMinimum.traites }}/{{ progressionMinimum.total }}
            </template>
            <template v-else>{{ bulkParams.isPending.value ? "Application…" : "Appliquer" }}</template>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
