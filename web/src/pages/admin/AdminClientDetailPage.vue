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
  { label: "Remise spéciale", valeur: client.value?.remise },
  {
    label: "Remise 2",
    valeur: client.value?.remise2
      ? `${client.value.remise2}${client.value.typeRemise2 ? ` (${client.value.typeRemise2.toLowerCase()})` : ""}`
      : null,
  },
]);

const remisesCiblees = computed(() => client.value?.remisesCiblees ?? []);

function metaRemiseCiblee(remise: AdminClientDetail["client"]["remisesCiblees"][number]) {
  const elements = [
    remise.quantite != null ? `Quantité minimale : ${remise.quantite}` : null,
  ].filter(Boolean);
  return elements.join(" · ");
}

function periodeRemiseCiblee(remise: AdminClientDetail["client"]["remisesCiblees"][number]) {
  if (!remise.dateDebut && !remise.dateFin) return null;
  const debut = remise.dateDebut ? dateFr(new Date(remise.dateDebut).getTime()) : "…";
  const fin = remise.dateFin ? dateFr(new Date(remise.dateFin).getTime()) : "…";
  return `${debut} → ${fin}`;
}
</script>

<template>
  <div class="grid gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <RouterLink
          to="/admin/clients"
          class="text-sm text-muted-foreground hover:underline"
        >
          ← Clients
        </RouterLink>
        <h1 class="flex items-center gap-2 text-xl font-semibold">
          <UserRound class="size-5 text-muted-foreground" />
          {{ client?.nom ?? client?.raisonSociale ?? "…" }}
          <span class="ml-2 text-sm font-normal text-muted-foreground">{{
            client?.numero
          }}</span>
        </h1>
      </div>
      <EasybeerLink
        :href="easybeerLien.clients(data?.easybeerAppUrl)"
        label="Ouvrir le client dans Easybeer"
        class="text-muted-foreground"
      />
    </div>

    <div v-if="isPending" class="grid gap-3">
      <Skeleton class="h-40 w-full" />
      <Skeleton class="h-40 w-full" />
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
                  <dd>{{ c.valeur || "—" }}</dd>
                </div>
                <div class="grid gap-0.5 sm:grid-cols-[12rem_1fr]">
                  <dt class="text-muted-foreground">
                    Remises ciblées (produit/lot)
                  </dt>
                  <dd v-if="remisesCiblees.length" class="grid gap-2">
                    <div
                      v-for="(remise, index) in remisesCiblees"
                      :key="index"
                      class="rounded-lg border bg-muted/30 p-3 text-sm"
                    >
                      <div class="flex flex-wrap items-center justify-between gap-2">
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
                        <Badge v-if="remise.remise" variant="secondary">
                          {{ remise.remise }}
                        </Badge>
                      </div>
                      <p v-if="metaRemiseCiblee(remise)" class="mt-1 text-xs text-muted-foreground">
                        {{ metaRemiseCiblee(remise) }}
                      </p>
                      <p v-if="periodeRemiseCiblee(remise)" class="mt-1 text-xs text-muted-foreground">
                        {{ periodeRemiseCiblee(remise) }}
                      </p>
                    </div>
                  </dd>
                  <dd v-else>—</dd>
                </div>
              </dl>
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
