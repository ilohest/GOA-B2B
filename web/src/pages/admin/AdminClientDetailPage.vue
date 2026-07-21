<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { UserRound } from "@lucide/vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { api } from "@/lib/api";
import type { AdminClientDetail, InvitationResponse } from "@/lib/types";
import { dateFr, prixFr } from "@/lib/format";
import { easybeerLien } from "@/lib/easybeer";
import EtatBadge from "@/components/EtatBadge.vue";
import CommandeDetailDialog from "@/components/admin/CommandeDetailDialog.vue";
import EasybeerLink from "@/components/admin/EasybeerLink.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const route = useRoute();
const idClient = computed(() => Number(route.params.id));

const commandeOuverte = ref<number | null>(null);

const queryClient = useQueryClient();

const { data, isPending, isError, error } = useQuery({
  queryKey: ["admin", "client", idClient],
  queryFn: () => api.get<AdminClientDetail>(`/admin/clients/${idClient.value}`),
});

const client = computed(() => data.value?.client);

// --- Invitation (même flux que « Inviter la sélection ») ---
const resultatInvit = ref<InvitationResponse | null>(null);

const invitation = useMutation({
  mutationFn: () =>
    api.post<InvitationResponse>("/admin/invitations", {
      easybeerIdClient: idClient.value,
    }),
  onSuccess: (res) => {
    resultatInvit.value = res;
    if (res.envoye) toast.success(`Invitation envoyée à ${res.email}.`);
    else
      toast.message(
        `Lien généré pour ${res.email} — à copier (email non envoyé).`,
      );
    queryClient.invalidateQueries({ queryKey: ["admin", "client", idClient] });
  },
  onError: (e) => toast.error((e as Error).message),
});

async function copierLien(texte: string) {
  await navigator.clipboard.writeText(texte);
  toast.success("Lien copié.");
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
  { label: "Email", valeur: client.value?.emailPrincipal },
  { label: "Téléphone", valeur: client.value?.telephonePrincipal },
  { label: "Adresse de facturation", valeur: client.value?.adresseFacturation },
  { label: "Adresse de livraison", valeur: client.value?.adresseLivraison },
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
  {
    label: "Frais de livraison",
    valeur:
      client.value?.fraisLivraisonHT != null
        ? `${prixFr(client.value.fraisLivraisonHT)} HT`
        : null,
  },
]);

const remisesCiblees = computed(() => client.value?.remisesCiblees ?? []);
const remisesType = computed(() => client.value?.remisesType ?? []);

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
        <RouterLink
          to="/admin/clients"
          class="text-sm text-muted-foreground hover:underline"
        >
          ← Clients
        </RouterLink>
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
              <Skeleton class="h-4" :class="i % 3 === 0 ? 'w-4/5' : 'w-2/3'" />
            </div>
          </CardContent>
        </Card>

        <div class="grid gap-4">
          <Card>
            <CardHeader>
              <Skeleton class="h-5 w-44" />
            </CardHeader>
            <CardContent class="grid gap-4">
              <div class="grid gap-3">
                <div
                  v-for="i in 2"
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
                <dd>{{ i.valeur || "—" }}</dd>
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

        <div class="grid gap-4">
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
                    class="grid grid-cols-[7rem_1fr_1fr] bg-muted/70 text-xs font-medium text-muted-foreground"
                  >
                    <div class="border-r px-3 py-2"></div>
                    <div class="border-r px-3 py-2">Client individuel</div>
                    <div class="px-3 py-2">Type de client</div>
                  </div>

                  <div class="grid grid-cols-[7rem_1fr_1fr] border-t">
                    <div
                      class="border-r bg-muted/35 px-3 py-3 font-medium text-muted-foreground"
                    >
                      Commande
                    </div>
                    <div class="border-r px-3 py-3">
                      <Badge
                        v-if="formatRemise(client.remise)"
                        variant="secondary"
                      >
                        {{ formatRemise(client.remise) }}
                      </Badge>
                      <span v-else class="text-muted-foreground">—</span>
                    </div>
                    <div class="grid gap-2 px-3 py-3">
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

                  <div class="grid grid-cols-[7rem_1fr_1fr] border-t">
                    <div
                      class="border-r bg-muted/35 px-3 py-3 font-medium text-muted-foreground"
                    >
                      Produit
                    </div>
                    <div class="grid gap-2 border-r px-3 py-3">
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
                  :key="c.email"
                  class="flex items-center justify-between gap-3"
                >
                  <span>{{ c.email }}</span>
                  <Badge
                    :variant="c.status === 'active' ? 'default' : 'secondary'"
                  >
                    {{ c.status === "active" ? "Actif" : "Invité" }}
                  </Badge>
                </li>
              </ul>

              <div class="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  :variant="data?.comptes.length ? 'outline' : 'default'"
                  :disabled="
                    invitation.isPending.value || !client?.emailPrincipal
                  "
                  @click="invitation.mutate()"
                >
                  {{
                    invitation.isPending.value
                      ? "Envoi…"
                      : data?.comptes.length
                        ? "Renvoyer l'invitation"
                        : "Envoyer l'invitation"
                  }}
                </Button>
                <span
                  v-if="!client?.emailPrincipal"
                  class="text-xs text-destructive"
                >
                  Pas d'email sur la fiche Easybeer.
                </span>
              </div>

              <div
                v-if="resultatInvit"
                class="grid gap-2 rounded-lg border bg-muted/50 p-3"
              >
                <p class="text-xs text-muted-foreground">
                  <template v-if="resultatInvit.envoye">
                    Email envoyé à {{ resultatInvit.email }}. Lien&nbsp;:
                  </template>
                  <template v-else>
                    Email non envoyé — copiez le lien sécurisé pour
                    {{ resultatInvit.email }}&nbsp;:
                  </template>
                </p>
                <p class="text-xs break-all text-muted-foreground">
                  {{ resultatInvit.lien }}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  class="justify-self-start"
                  @click="copierLien(resultatInvit.lien)"
                >
                  Copier le lien sécurisé
                </Button>
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
                    n° {{ cmd.numero ?? cmd.idCommande }}
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
    />
  </div>
</template>
