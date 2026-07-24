<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft, Check, Copy, Info, Mail, UserRound } from "@lucide/vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { api } from "@/lib/api";
import { copierDansPressePapiers } from "@/lib/clipboard";
import type { AdminClientDetail, InvitationResponse } from "@/lib/types";
import { dateFr, dateHeureFr, prixFr } from "@/lib/format";
import { easybeerLien } from "@/lib/easybeer";
import EtatBadge from "@/components/EtatBadge.vue";
import CommandeDetailDialog from "@/components/CommandeDetailDialog.vue";
import EasybeerLink from "@/components/admin/EasybeerLink.vue";
import IconTooltip from "@/components/admin/IconTooltip.vue";
import ProduitFormat from "@/components/catalogue/ProduitFormat.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const route = useRoute();
const idClient = computed(() => Number(route.params.id));
const retour = computed(() =>
  route.query.retour === "commandes"
    ? { to: "/admin/commandes", label: "Commandes" }
    : { to: "/admin/clients", label: "Clients" },
);

const commandeOuverte = ref<number | null>(null);
const informationCopiee = ref<string | null>(null);

const queryClient = useQueryClient();

const { data, isPending, isError, error } = useQuery({
  queryKey: ["admin", "client", idClient],
  queryFn: () => api.get<AdminClientDetail>(`/admin/clients/${idClient.value}`),
});

const client = computed(() => data.value?.client);

const invitation = useMutation({
  mutationFn: (envoyerEmail: boolean) =>
    api.post<InvitationResponse>("/admin/invitations", {
      easybeerIdClient: idClient.value,
      envoyerEmail,
    }),
  onSuccess: async (res, envoyerEmail) => {
    if (envoyerEmail && res.envoye) {
      toast.success(`Invitation envoyée à ${res.email}.`);
    } else if (envoyerEmail) {
      toast.message(
        `Lien créé, mais l’email n’a pas pu être envoyé${res.email ? ` à ${res.email}` : ""}.`,
      );
    } else if (await copierDansPressePapiers(res.lien)) {
      toast.success("Lien sécurisé copié.");
    } else {
      toast.error(
        "Lien créé, mais impossible de le copier dans le presse-papiers.",
      );
    }
    queryClient.invalidateQueries({ queryKey: ["admin", "client", idClient] });
    queryClient.invalidateQueries({ queryKey: ["admin", "clients"] });
  },
  onError: (e) => toast.error((e as Error).message),
});

const peutInviter = computed(() => {
  const comptes = data.value?.comptes ?? [];
  return comptes.length === 0 || comptes.every((c) => c.status === "invited");
});

function invitationEnCours(envoyerEmail: boolean) {
  return (
    invitation.isPending.value && invitation.variables.value === envoyerEmail
  );
}

async function copierLienInvitation() {
  const existante = data.value?.invitation;
  if (existante?.etat === "valide") {
    if (await copierDansPressePapiers(existante.lien)) {
      toast.success("Lien sécurisé copié.");
    } else {
      toast.error("Impossible de copier dans le presse-papiers.");
    }
    return;
  }
  invitation.mutate(false);
}

function libelleEtatInvitation() {
  switch (data.value?.invitation?.etat) {
    case "valide":
      return "Valable";
    case "utilise":
      return "Utilisé";
    case "expire":
      return "Périmé";
    case "revoque":
      return "Révoqué";
    default:
      return "Non généré";
  }
}

function detailEtatInvitation() {
  const lien = data.value?.invitation;
  if (!lien) return "Aucun lien d’invitation n’a encore été généré.";
  if (lien.etat === "valide")
    return `Valable jusqu’au ${dateHeureFr(lien.expiresAt)}.`;
  if (lien.etat === "utilise")
    return lien.usedAt
      ? `Utilisé le ${dateHeureFr(lien.usedAt)}.`
      : "Ce lien a déjà été utilisé.";
  if (lien.etat === "expire")
    return `Arrivé à expiration le ${dateHeureFr(lien.expiresAt)}.`;
  return "Ce lien a été remplacé par une invitation plus récente.";
}

const statutCompte = useMutation({
  mutationFn: ({ uid, revoked }: { uid: string; revoked: boolean }) =>
    api.put<{ ok: true; status: "active" | "revoked" }>(
      `/admin/accounts/${encodeURIComponent(uid)}/status`,
      { revoked },
    ),
  onSuccess: (_res, variables) => {
    toast.success(
      variables.revoked
        ? "Compte révoqué. L’accès à la plateforme est bloqué."
        : "Compte réactivé. Le client peut de nouveau se connecter.",
    );
    queryClient.invalidateQueries({ queryKey: ["admin", "client", idClient] });
    queryClient.invalidateQueries({ queryKey: ["admin", "clients"] });
  },
  onError: (e) => toast.error((e as Error).message),
});

function compteEnModification(uid: string) {
  return (
    statutCompte.isPending.value && statutCompte.variables.value?.uid === uid
  );
}

async function copierTexte(
  texte: string,
  confirmation: string,
  identifiant?: string,
) {
  if (await copierDansPressePapiers(texte)) {
    if (identifiant) {
      informationCopiee.value = identifiant;
      window.setTimeout(() => {
        if (informationCopiee.value === identifiant) {
          informationCopiee.value = null;
        }
      }, 2000);
    }
    toast.success(confirmation);
    return;
  }
  toast.error("Impossible de copier dans le presse-papiers.");
}

const tags = computed(() => {
  const t = client.value?.tags;
  if (t == null) return [];
  return Array.isArray(t)
    ? t
    : String(t)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
});

/** Paires libellé/valeur affichées telles quelles (— si absent). */
const infos = computed(() => [
  {
    label: "Numéro client",
    valeur: client.value?.numero,
    confirmationCopie: "Numéro client copié.",
  },
  {
    label: "Email",
    valeur: client.value?.emailPrincipal,
    confirmationCopie: "Adresse e-mail copiée.",
  },
  {
    label: "Téléphone",
    valeur: client.value?.telephonePrincipal,
    confirmationCopie: "Numéro de téléphone copié.",
  },
  {
    label: "Adresse de facturation",
    valeur: client.value?.adresseFacturation,
    confirmationCopie: "Adresse de facturation copiée.",
  },
  {
    label: "Adresse de livraison",
    valeur: client.value?.adresseLivraison,
    confirmationCopie: "Adresse de livraison copiée.",
  },
  { label: "Catégorie", valeur: client.value?.categorie },
  { label: "Mode de livraison", valeur: client.value?.typeLivraisonFav },
  { label: "Tournée", valeur: client.value?.tournee },
]);

const conditions = computed(() => [
  {
    label: "Minimum de commande",
    valeur:
      client.value?.minimumCommande != null
        ? `${prixFr(client.value.minimumCommande)} HT`
        : null,
  },
]);

const remisesCiblees = computed(() => client.value?.remisesCiblees ?? []);
const remisesType = computed(() => client.value?.remisesType ?? []);
const tarifsPersonnalises = computed(
  () => client.value?.tarifsPersonnalises ?? [],
);

function formatRemise(remise: string | null | undefined) {
  if (!remise) return null;
  const texte = remise.trim();
  if (!texte) return null;
  if (texte.includes("%") || texte.includes("€")) return texte;
  const valeur = Number.parseFloat(texte.replace(",", "."));
  if (!Number.isFinite(valeur)) return texte;
  return prixFr(valeur);
}

function metaRemiseCiblee(
  remise: AdminClientDetail["client"]["remisesCiblees"][number],
) {
  const elements = [
    remise.quantite != null ? `Quantité minimale : ${remise.quantite}` : null,
  ].filter(Boolean);
  return elements.join(" · ");
}

function periodeRemiseCiblee(
  remise: AdminClientDetail["client"]["remisesCiblees"][number],
) {
  if (!remise.dateDebut && !remise.dateFin) return null;
  const debut = remise.dateDebut
    ? dateFr(new Date(remise.dateDebut).getTime())
    : "…";
  const fin = remise.dateFin ? dateFr(new Date(remise.dateFin).getTime()) : "…";
  return `${debut} → ${fin}`;
}
</script>

<template>
  <div class="grid gap-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-3 mb-1 h-9 gap-2 px-3 text-muted-foreground"
          as-child
        >
          <RouterLink :to="retour.to">
            <ArrowLeft class="size-4" />
            {{ retour.label }}
          </RouterLink>
        </Button>
        <div
          v-if="isPending"
          class="mt-1 flex items-center gap-2"
          aria-hidden="true"
        >
          <Skeleton class="size-5 rounded-full" />
          <Skeleton class="h-6 w-48 sm:w-64" />
          <Skeleton class="h-4 w-14" />
        </div>
        <h1 v-else class="flex items-center gap-2 text-xl font-semibold">
          <UserRound class="size-5 text-muted-foreground" />
          {{ client?.nom ?? client?.raisonSociale ?? "…" }}
          <span class="ml-2 text-sm font-normal text-muted-foreground">{{
            client?.numero
          }}</span>
        </h1>
      </div>
      <div class="shrink-0">
        <Skeleton v-if="isPending" class="size-8 rounded-full" />
        <EasybeerLink
          v-else
          :href="easybeerLien.clients(data?.easybeerAppUrl)"
          label="Ouvrir le client dans Easybeer"
          class="text-muted-foreground"
        />
      </div>
    </div>

    <div
      v-if="isPending"
      class="grid gap-4"
      aria-label="Chargement de la fiche client"
      aria-busy="true"
    >
      <div class="grid items-start gap-4 lg:grid-cols-2">
        <div class="grid content-start gap-4">
          <Card>
            <CardHeader>
              <Skeleton class="h-5 w-28" />
            </CardHeader>
            <CardContent class="grid gap-3">
              <div
                v-for="i in 7"
                :key="`info-${i}`"
                class="grid gap-1.5 sm:grid-cols-[12rem_1fr] sm:items-center"
              >
                <Skeleton class="h-3.5 w-28" />
                <Skeleton
                  class="h-4"
                  :class="i % 3 === 0 ? 'w-4/5' : 'w-2/3'"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div class="flex items-center justify-between gap-3">
                <Skeleton class="h-5 w-40" />
                <Skeleton class="h-5 w-8 rounded-full" />
              </div>
            </CardHeader>
            <CardContent class="grid gap-3">
              <Skeleton class="h-3.5 w-4/5" />
              <div
                v-for="i in 2"
                :key="`tarif-${i}`"
                class="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div class="grid flex-1 gap-2">
                  <Skeleton class="h-4 w-40 max-w-[80%]" />
                  <div class="flex gap-2">
                    <Skeleton class="h-6 w-28 rounded-full" />
                    <Skeleton class="h-6 w-24 rounded-full" />
                  </div>
                </div>
                <div class="grid justify-items-end gap-1">
                  <Skeleton class="h-4 w-16" />
                  <Skeleton class="h-3 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div class="grid content-start gap-4">
          <Card>
            <CardHeader>
              <Skeleton class="h-5 w-44" />
            </CardHeader>
            <CardContent class="grid gap-4">
              <div class="grid gap-3">
                <div
                  v-for="i in 1"
                  :key="`condition-${i}`"
                  class="grid gap-1.5 sm:grid-cols-[12rem_1fr]"
                >
                  <Skeleton class="h-3.5 w-32" />
                  <Skeleton class="h-4 w-24" />
                </div>
              </div>
              <div class="grid gap-2">
                <Skeleton class="h-4 w-20" />
                <Skeleton class="h-3 w-64 max-w-full" />
                <Skeleton class="h-32 w-full rounded-lg" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Skeleton class="h-5 w-36" />
            </CardHeader>
            <CardContent class="grid gap-3">
              <div
                v-for="i in 2"
                :key="`compte-${i}`"
                class="flex items-center justify-between gap-3"
              >
                <Skeleton class="h-4 w-48 max-w-[70%]" />
                <Skeleton class="h-5 w-14 rounded-full" />
              </div>
              <Skeleton class="mt-1 h-8 w-36 rounded-md" />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <Skeleton class="h-5 w-32" />
        </CardHeader>
        <CardContent class="grid gap-3">
          <div
            v-for="i in 4"
            :key="`commande-${i}`"
            class="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
          >
            <div class="flex items-center gap-2">
              <Skeleton class="h-4 w-20" />
              <Skeleton class="h-5 w-16 rounded-full" />
            </div>
            <div class="flex items-center gap-4">
              <Skeleton class="hidden h-4 w-20 sm:block" />
              <Skeleton class="h-4 w-16" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <p v-else-if="isError" class="text-sm text-destructive">
      {{ (error as Error)?.message }}
    </p>

    <template v-else-if="client">
      <div class="grid items-start gap-4 lg:grid-cols-2">
        <div class="grid content-start gap-4">
          <Card>
            <CardHeader
              ><CardTitle class="text-base">Informations</CardTitle></CardHeader
            >
            <CardContent>
              <dl class="grid gap-2 text-sm">
                <div
                  v-for="i in infos"
                  :key="i.label"
                  class="grid gap-0.5 sm:grid-cols-[12rem_1fr]"
                >
                  <dt class="text-muted-foreground">{{ i.label }}</dt>
                  <dd class="min-w-0">
                    <IconTooltip
                      v-if="i.valeur && i.confirmationCopie"
                      :text="
                        informationCopiee === i.label
                          ? 'Copié !'
                          : `Copier ${i.label.toLowerCase()}`
                      "
                      class="w-full"
                      show-on-focus
                    >
                      <button
                        type="button"
                        class="group -mx-2 -my-1 flex min-h-7 w-[calc(100%+1rem)] cursor-pointer items-center gap-1.5 rounded-sm px-2 text-left outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        :aria-label="`Copier ${i.label.toLowerCase()}`"
                        @click="
                          copierTexte(i.valeur, i.confirmationCopie, i.label)
                        "
                      >
                        <span class="min-w-0 break-words">{{ i.valeur }}</span>
                        <Check
                          v-if="informationCopiee === i.label"
                          class="size-3.5 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <Copy
                          v-else
                          class="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                          aria-hidden="true"
                        />
                      </button>
                    </IconTooltip>
                    <span v-else class="min-w-0 break-words">{{
                      i.valeur || "—"
                    }}</span>
                  </dd>
                </div>
                <div
                  v-if="tags.length"
                  class="grid gap-0.5 sm:grid-cols-[12rem_1fr]"
                >
                  <dt class="text-muted-foreground">Tags</dt>
                  <dd class="flex flex-wrap gap-1">
                    <Badge v-for="t in tags" :key="t" variant="secondary">{{
                      t
                    }}</Badge>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card class="overflow-visible">
            <CardHeader>
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-1.5">
                  <CardTitle class="text-base">Tarifs personnalisés</CardTitle>
                  <IconTooltip
                    text="Prix définis spécialement pour ce client dans Easybeer. Ils remplacent le tarif habituel avant l'application des remises."
                    content-class="right-auto left-1/2 max-w-72 -translate-x-1/2 whitespace-normal"
                    arrow-class="right-auto left-1/2 -translate-x-1/2"
                    show-on-focus
                  >
                    <button
                      type="button"
                      class="flex size-6 cursor-help items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-label="Explication des tarifs personnalisés"
                    >
                      <Info class="size-3.5" aria-hidden="true" />
                    </button>
                  </IconTooltip>
                </div>
                <Badge variant="secondary">{{
                  tarifsPersonnalises.length
                }}</Badge>
              </div>
            </CardHeader>
            <CardContent class="grid gap-3">
              <p
                v-if="!tarifsPersonnalises.length"
                class="text-sm text-muted-foreground"
              >
                Aucun tarif personnalisé pour ce client.
              </p>
              <ul v-else class="grid gap-2">
                <li
                  v-for="tarif in tarifsPersonnalises"
                  :key="
                    tarif.id ??
                    `${tarif.idProduit}-${tarif.idContenant}-${tarif.idLot}`
                  "
                  class="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-background p-3"
                >
                  <div class="grid min-w-0 gap-1.5">
                    <p class="text-sm font-medium">
                      {{ tarif.produit || "Produit" }}
                    </p>
                    <ProduitFormat
                      :contenant="tarif.contenant"
                      :packaging="tarif.packaging"
                    />
                  </div>
                  <div class="text-right">
                    <p class="font-semibold tabular-nums">
                      {{ prixFr(tarif.prixHT) }}
                    </p>
                    <p class="text-xs text-muted-foreground">HT</p>
                  </div>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <div class="grid content-start gap-4">
          <Card>
            <CardHeader
              ><CardTitle class="text-base"
                >Conditions commerciales</CardTitle
              ></CardHeader
            >
            <CardContent>
              <dl class="grid gap-2 text-sm">
                <div
                  v-for="c in conditions"
                  :key="c.label"
                  class="grid gap-0.5 sm:grid-cols-[12rem_1fr]"
                >
                  <dt class="text-muted-foreground">{{ c.label }}</dt>
                  <dd>
                    {{ c.valeur || "—" }}
                  </dd>
                </div>
              </dl>

              <div class="mt-4 grid gap-2">
                <div>
                  <h3 class="text-sm font-medium">Remises</h3>
                </div>
                <div class="overflow-hidden rounded-lg border text-sm">
                  <div
                    class="hidden grid-cols-[7rem_1fr_1fr] bg-muted/70 text-xs font-medium text-muted-foreground xl:grid"
                  >
                    <div class="border-r px-3 py-2"></div>
                    <div class="border-r px-3 py-2">Client individuel</div>
                    <div class="px-3 py-2">Type de client</div>
                  </div>

                  <div class="grid border-t xl:grid-cols-[7rem_1fr_1fr]">
                    <div
                      class="border-b bg-muted/35 px-3 py-2 font-medium text-muted-foreground xl:border-r xl:border-b-0 xl:py-3"
                    >
                      Commande
                    </div>
                    <div class="border-b px-3 py-3 xl:border-r xl:border-b-0">
                      <p
                        class="mb-2 text-xs font-medium text-muted-foreground xl:hidden"
                      >
                        Client individuel
                      </p>
                      <Badge
                        v-if="formatRemise(client.remise)"
                        variant="secondary"
                      >
                        {{ formatRemise(client.remise) }}
                      </Badge>
                      <span v-else class="text-muted-foreground">—</span>
                    </div>
                    <div class="grid gap-2 px-3 py-3">
                      <p
                        class="text-xs font-medium text-muted-foreground xl:hidden"
                      >
                        Type de client
                      </p>
                      <template
                        v-if="
                          remisesType.some((type) => formatRemise(type.remise))
                        "
                      >
                        <div
                          v-for="type in remisesType.filter((type) =>
                            formatRemise(type.remise),
                          )"
                          :key="`commande-${type.idClientType ?? type.libelle ?? 'type'}`"
                          class="flex flex-wrap items-center justify-between gap-2"
                        >
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="font-medium">{{
                              type.libelle || "Type de client"
                            }}</span>
                          </div>
                          <Badge variant="secondary">{{
                            formatRemise(type.remise)
                          }}</Badge>
                        </div>
                      </template>
                      <span v-else class="text-muted-foreground">—</span>
                    </div>
                  </div>

                  <div class="grid border-t xl:grid-cols-[7rem_1fr_1fr]">
                    <div
                      class="border-b bg-muted/35 px-3 py-2 font-medium text-muted-foreground xl:border-r xl:border-b-0 xl:py-3"
                    >
                      Produit
                    </div>
                    <div
                      class="grid gap-2 border-b px-3 py-3 xl:border-r xl:border-b-0"
                    >
                      <p
                        class="text-xs font-medium text-muted-foreground xl:hidden"
                      >
                        Client individuel
                      </p>
                      <template v-if="remisesCiblees.length">
                        <div
                          v-for="(remise, index) in remisesCiblees"
                          :key="index"
                          class="rounded-md border bg-background p-2"
                        >
                          <div
                            class="flex flex-wrap items-center justify-between gap-2"
                          >
                            <div class="flex flex-wrap items-center gap-2">
                              <p class="font-medium">
                                {{ remise.produit || "Produit ciblé" }}
                              </p>
                              <Badge v-if="remise.contenant" variant="outline">
                                {{ remise.contenant }}
                              </Badge>
                              <Badge v-if="remise.lot" variant="outline">
                                {{ remise.lot }}
                              </Badge>
                            </div>
                            <Badge
                              v-if="formatRemise(remise.remise)"
                              variant="secondary"
                            >
                              {{ formatRemise(remise.remise) }}
                            </Badge>
                          </div>
                          <p
                            v-if="metaRemiseCiblee(remise)"
                            class="mt-1 text-xs text-muted-foreground"
                          >
                            {{ metaRemiseCiblee(remise) }}
                          </p>
                          <p
                            v-if="periodeRemiseCiblee(remise)"
                            class="mt-1 text-xs text-muted-foreground"
                          >
                            {{ periodeRemiseCiblee(remise) }}
                          </p>
                        </div>
                      </template>
                      <span v-else class="text-muted-foreground">—</span>
                    </div>
                    <div class="grid gap-2 px-3 py-3">
                      <p
                        class="text-xs font-medium text-muted-foreground xl:hidden"
                      >
                        Type de client
                      </p>
                      <template
                        v-if="
                          remisesType.some((type) => type.remisesCiblees.length)
                        "
                      >
                        <template
                          v-for="type in remisesType.filter(
                            (type) => type.remisesCiblees.length,
                          )"
                          :key="`produits-${type.idClientType ?? type.libelle ?? 'type'}`"
                        >
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="font-medium">{{
                              type.libelle || "Type de client"
                            }}</span>
                          </div>
                          <div
                            v-for="(remise, index) in type.remisesCiblees"
                            :key="`${type.idClientType ?? type.libelle}-${index}`"
                            class="rounded-md border bg-background p-2"
                          >
                            <div
                              class="flex flex-wrap items-center justify-between gap-2"
                            >
                              <div class="flex flex-wrap items-center gap-2">
                                <p class="font-medium">
                                  {{ remise.produit || "Produit ciblé" }}
                                </p>
                                <Badge
                                  v-if="remise.contenant"
                                  variant="outline"
                                >
                                  {{ remise.contenant }}
                                </Badge>
                                <Badge v-if="remise.lot" variant="outline">
                                  {{ remise.lot }}
                                </Badge>
                              </div>
                              <Badge
                                v-if="formatRemise(remise.remise)"
                                variant="secondary"
                              >
                                {{ formatRemise(remise.remise) }}
                              </Badge>
                            </div>
                            <p
                              v-if="metaRemiseCiblee(remise)"
                              class="mt-1 text-xs text-muted-foreground"
                            >
                              {{ metaRemiseCiblee(remise) }}
                            </p>
                            <p
                              v-if="periodeRemiseCiblee(remise)"
                              class="mt-1 text-xs text-muted-foreground"
                            >
                              {{ periodeRemiseCiblee(remise) }}
                            </p>
                          </div>
                        </template>
                      </template>
                      <span v-else class="text-muted-foreground">—</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              ><CardTitle class="text-base"
                >Comptes plateforme</CardTitle
              ></CardHeader
            >
            <CardContent class="grid gap-3">
              <p
                v-if="!data?.comptes.length"
                class="text-sm text-muted-foreground"
              >
                Aucun compte plateforme pour ce client.
              </p>
              <ul v-else class="grid gap-1.5 text-sm">
                <li
                  v-for="c in data.comptes"
                  :key="c.uid"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="min-w-0 break-all">{{ c.email }}</span>
                  <div class="flex shrink-0 items-center gap-2">
                    <Badge
                      :variant="
                        c.status === 'active'
                          ? 'default'
                          : c.status === 'revoked'
                            ? 'destructive'
                            : 'secondary'
                      "
                    >
                      {{
                        c.status === "active"
                          ? "Actif"
                          : c.status === "revoked"
                            ? "Révoqué"
                            : "Invité"
                      }}
                    </Badge>
                    <Button
                      v-if="c.status === 'active'"
                      type="button"
                      size="xs"
                      variant="destructive"
                      :disabled="compteEnModification(c.uid)"
                      @click="
                        statutCompte.mutate({ uid: c.uid, revoked: true })
                      "
                    >
                      {{
                        compteEnModification(c.uid) ? "Révocation…" : "Révoquer"
                      }}
                    </Button>
                    <Button
                      v-else-if="c.status === 'revoked'"
                      type="button"
                      size="xs"
                      variant="outline"
                      :disabled="compteEnModification(c.uid)"
                      @click="
                        statutCompte.mutate({ uid: c.uid, revoked: false })
                      "
                    >
                      {{
                        compteEnModification(c.uid)
                          ? "Réactivation…"
                          : "Réactiver"
                      }}
                    </Button>
                  </div>
                </li>
              </ul>

              <div
                class="flex items-start justify-between gap-3 rounded-lg border bg-muted/40 p-3"
              >
                <div class="grid gap-0.5">
                  <p class="text-sm font-medium">Lien sécurisé d’invitation</p>
                  <p class="text-xs text-muted-foreground">
                    {{ detailEtatInvitation() }}
                  </p>
                </div>
                <Badge
                  :variant="
                    data?.invitation?.etat === 'valide'
                      ? 'default'
                      : data?.invitation?.etat === 'expire'
                        ? 'destructive'
                        : 'secondary'
                  "
                >
                  {{ libelleEtatInvitation() }}
                </Badge>
              </div>

              <div v-if="peutInviter" class="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  :disabled="
                    invitation.isPending.value || !client?.emailPrincipal
                  "
                  @click="invitation.mutate(true)"
                >
                  <Mail aria-hidden="true" />
                  {{
                    invitationEnCours(true)
                      ? "Envoi…"
                      : "Envoyer l’invitation par mail"
                  }}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  :disabled="invitation.isPending.value"
                  @click="copierLienInvitation"
                >
                  <Copy aria-hidden="true" />
                  {{
                    invitationEnCours(false)
                      ? "Génération…"
                      : "Copier le lien sécurisé"
                  }}
                </Button>
                <span class="basis-full text-xs text-muted-foreground">
                  Le lien est personnel, expirant et utilisable une seule fois.
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          ><CardTitle class="text-base"
            >Commandes ({{ data?.commandes.length ?? 0 }})</CardTitle
          ></CardHeader
        >
        <CardContent>
          <p
            v-if="!data?.commandes.length"
            class="text-sm text-muted-foreground"
          >
            Aucune commande.
          </p>
          <ul v-else class="divide-y">
            <li v-for="cmd in data.commandes" :key="cmd.idCommande">
              <button
                class="flex w-full flex-wrap items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                @click="commandeOuverte = cmd.idCommande"
              >
                <div class="flex items-center gap-2">
                  <p class="text-sm font-medium">
                    #{{ cmd.numero ?? cmd.idCommande }}
                  </p>
                  <EtatBadge :etat="cmd.etat" />
                </div>
                <div class="flex items-center gap-4 text-sm">
                  <span class="text-muted-foreground">{{
                    dateFr(cmd.dateCreation)
                  }}</span>
                  <span class="font-medium tabular-nums">
                    {{
                      cmd.totalTTC != null ? `${prixFr(cmd.totalTTC)} TTC` : "—"
                    }}
                  </span>
                </div>
              </button>
            </li>
          </ul>
        </CardContent>
      </Card>
    </template>

    <CommandeDetailDialog
      v-model:id-commande="commandeOuverte"
      :easybeer-app-url="data?.easybeerAppUrl"
      :ids-commandes="
        data?.commandes.map((commande) => commande.idCommande) ?? []
      "
    />
  </div>
</template>
