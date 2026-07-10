<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CommandeDetail, CommandeEdition, CommandeResume, CommandesClientResponse } from '@/lib/types'
import { dateFr, prixFr } from '@/lib/format'
import EtatBadge from '@/components/EtatBadge.vue'
import { usePanier } from '@/composables/usePanier'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const router = useRouter()
const { chargerCommande } = usePanier()

const { data, isPending, isError, error } = useQuery({
  queryKey: ['commandes'],
  queryFn: () => api.get<CommandesClientResponse>('/commandes'),
})

const chargement = ref<number | null>(null)

// --- Détail dépliable (lignes + documents) ---

const detailOuvert = ref<number | null>(null)
const details = ref<Record<number, CommandeDetail | 'chargement' | 'erreur'>>({})

async function basculerDetail(idCommande: number) {
  if (detailOuvert.value === idCommande) {
    detailOuvert.value = null
    return
  }
  detailOuvert.value = idCommande
  if (details.value[idCommande] && details.value[idCommande] !== 'erreur') return
  details.value[idCommande] = 'chargement'
  try {
    details.value[idCommande] = await api.get<CommandeDetail>(`/commandes/${idCommande}`)
  } catch (e) {
    details.value[idCommande] = 'erreur'
    toast.error((e as Error).message)
  }
}

const telechargementEnCours = ref<number | null>(null)

/** Décomposition des totaux : sous-total HT, remise, TVA (TTC − HT), consigne, total TTC. */
function lignesTotaux(detail: CommandeDetail) {
  const lignes: { label: string; valeur: string; classe?: string }[] = []
  const muted = 'text-muted-foreground'
  if (detail.totalHT != null) lignes.push({ label: 'Sous-total HT', valeur: prixFr(detail.totalHT), classe: muted })
  if (detail.remiseTotale) lignes.push({ label: 'Remise', valeur: `− ${prixFr(detail.remiseTotale)}`, classe: muted })
  if (detail.totalHT != null && detail.totalTTC != null) {
    lignes.push({
      label: 'TVA (5,5 %)',
      valeur: prixFr(Math.max(0, detail.totalTTC - detail.totalHT)),
      classe: muted,
    })
  }
  if (detail.totalConsigne) lignes.push({ label: 'dont consigne', valeur: prixFr(detail.totalConsigne), classe: muted })
  if (detail.totalTTC != null) lignes.push({ label: 'Total TTC', valeur: prixFr(detail.totalTTC), classe: 'font-semibold' })
  return lignes
}

async function telechargerDocument(idCommande: number, doc: CommandeDetail['documents'][number]) {
  telechargementEnCours.value = doc.idCommandeDocument
  try {
    await api.telecharger(`/commandes/${idCommande}/documents/${doc.idCommandeDocument}/pdf`, doc.nomFichier)
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    telechargementEnCours.value = null
  }
}

async function modifier(commande: CommandeResume) {
  chargement.value = commande.idCommande
  try {
    const edition = await api.get<CommandeEdition>(`/commandes/${commande.idCommande}/edition`)
    if (!edition.modifiable) {
      toast.error('Cette commande ne peut plus être modifiée.')
      return
    }
    chargerCommande(edition)
    toast.info('Commande chargée dans le panier — ajustez puis validez.')
    router.push('/')
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    chargement.value = null
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Mes commandes</CardTitle>
      <CardDescription>
        Vos commandes passées via la plateforme restent visibles même si Easybeer est temporairement indisponible.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="isPending" class="grid gap-2">
        <Skeleton v-for="i in 4" :key="i" class="h-14 w-full" />
      </div>

      <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

      <template v-else>
        <p v-if="data?.indisponible && data.source === 'local'" class="mb-3 text-xs text-muted-foreground">
          Historique Easybeer temporairement indisponible. Affichage des commandes envoyées depuis cette plateforme.
        </p>

        <p v-if="data?.indisponible && !data.commandes.length" class="text-sm text-muted-foreground">
          Votre historique sera disponible après la prochaine synchronisation.
        </p>

        <p v-else-if="!data?.commandes.length" class="text-sm text-muted-foreground">
          Aucune commande pour l'instant.
        </p>

        <ul v-else class="divide-y">
          <li v-for="cmd in data.commandes" :key="cmd.idCommande" class="py-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <button
              class="text-left"
              :class="data?.source === 'local' ? 'cursor-default' : ''"
              @click="data?.source === 'local' ? undefined : basculerDetail(cmd.idCommande)"
            >
              <p class="flex items-center gap-2 text-sm font-medium">
                Commande n° {{ cmd.numero ?? cmd.idCommande }}
                <EtatBadge :etat="cmd.etat" />
                <span v-if="data?.source !== 'local'" class="text-xs text-muted-foreground">
                  {{ detailOuvert === cmd.idCommande ? '▲' : '▼' }}
                </span>
              </p>
              <p class="text-xs text-muted-foreground">{{ dateFr(cmd.dateCreation) }}</p>
            </button>
            <div class="flex items-center gap-3">
              <p class="text-sm font-semibold tabular-nums">
                {{ cmd.totalTTC != null ? `${prixFr(cmd.totalTTC)} TTC` : '—' }}
              </p>
              <Button
                v-if="cmd.modifiable"
                variant="outline"
                size="sm"
                :disabled="chargement === cmd.idCommande"
                @click="modifier(cmd)"
              >
                {{ chargement === cmd.idCommande ? 'Chargement…' : 'Modifier' }}
              </Button>
              <p v-else class="text-xs text-muted-foreground">
                {{ data?.source === 'local' ? 'Détail indisponible' : 'Non modifiable' }}
              </p>
            </div>
          </div>

          <div v-if="data?.source !== 'local' && detailOuvert === cmd.idCommande" class="mt-3 rounded-lg bg-muted/50 p-3">
            <Skeleton v-if="details[cmd.idCommande] === 'chargement'" class="h-16 w-full" />
            <p v-else-if="details[cmd.idCommande] === 'erreur'" class="text-sm text-destructive">
              Impossible de charger le détail.
            </p>
            <template v-else-if="typeof details[cmd.idCommande] === 'object'">
              <ul class="grid gap-1 text-sm">
                <li
                  v-for="(l, i) in (details[cmd.idCommande] as CommandeDetail).lignes"
                  :key="i"
                  class="flex items-baseline justify-between gap-3"
                >
                  <span>{{ l.designation }} × {{ l.quantite }}</span>
                  <span v-if="l.prixUnitaireHT != null" class="tabular-nums text-muted-foreground">
                    {{ prixFr(l.prixUnitaireHT * l.quantite) }} HT
                  </span>
                </li>
              </ul>
              <!-- Totaux : HT / remise / TVA / TTC -->
              <dl
                v-if="(details[cmd.idCommande] as CommandeDetail).totalTTC != null"
                class="mt-3 grid gap-1 border-t pt-3 text-sm"
              >
                <template v-for="ligne in lignesTotaux(details[cmd.idCommande] as CommandeDetail)" :key="ligne.label">
                  <div class="flex items-baseline justify-between gap-3" :class="ligne.classe">
                    <dt>{{ ligne.label }}</dt>
                    <dd class="tabular-nums">{{ ligne.valeur }}</dd>
                  </div>
                </template>
              </dl>
              <p
                v-if="(details[cmd.idCommande] as CommandeDetail).commentaire"
                class="mt-2 text-xs text-muted-foreground italic"
              >
                « {{ (details[cmd.idCommande] as CommandeDetail).commentaire }} »
              </p>
              <div
                v-if="(details[cmd.idCommande] as CommandeDetail).documents.length"
                class="mt-3 flex flex-wrap gap-2 border-t pt-3"
              >
                <Button
                  v-for="doc in (details[cmd.idCommande] as CommandeDetail).documents"
                  :key="doc.idCommandeDocument"
                  variant="outline"
                  size="sm"
                  :disabled="telechargementEnCours === doc.idCommandeDocument"
                  @click="telechargerDocument(cmd.idCommande, doc)"
                >
                  ⤓ {{ doc.libelle }} {{ doc.code }}
                </Button>
              </div>
              <p v-else class="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Aucun document pour cette commande.
              </p>
            </template>
          </div>
          </li>
        </ul>
      </template>
    </CardContent>
  </Card>
</template>
