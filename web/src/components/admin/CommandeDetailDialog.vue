<script setup lang="ts">
/**
 * Dialog de détail d'une commande côté admin : lignes, totaux HT/TVA/TTC,
 * documents téléchargeables. Ouvert en passant un idCommande (null = fermé).
 */
import { computed, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CommandeDetail } from '@/lib/types'
import { decomposerTotaux, prixFr } from '@/lib/format'
import { easybeerLien } from '@/lib/easybeer'
import { useEasybeerBan } from '@/composables/useEasybeerBan'
import EasybeerLink from '@/components/admin/EasybeerLink.vue'
import EtatBadge from '@/components/EtatBadge.vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const props = defineProps<{ idCommande: number | null; easybeerAppUrl?: string }>()
const emit = defineEmits<{ 'update:idCommande': [value: number | null] }>()

const ouvert = computed({
  get: () => props.idCommande != null,
  set: (v) => {
    if (!v) emit('update:idCommande', null)
  },
})

const idCommande = computed(() => props.idCommande)
const { data, isPending, isError, error, refetch, isFetching } = useQuery({
  queryKey: ['admin', 'commande', idCommande],
  queryFn: () => api.get<CommandeDetail>(`/admin/commandes/${props.idCommande}`),
  enabled: computed(() => props.idCommande != null),
  retry: false,
})

const { banni, secondesRestantes } = useEasybeerBan()

const totaux = computed(() => (data.value ? decomposerTotaux(data.value) : []))

const telechargementEnCours = ref<number | null>(null)

async function telecharger(doc: CommandeDetail['documents'][number]) {
  if (props.idCommande == null) return
  telechargementEnCours.value = doc.idCommandeDocument
  try {
    await api.telecharger(
      `/admin/commandes/${props.idCommande}/documents/${doc.idCommandeDocument}/pdf`,
      doc.nomFichier,
    )
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    telechargementEnCours.value = null
  }
}

watch(
  () => props.idCommande,
  () => {
    telechargementEnCours.value = null
  },
)
</script>

<template>
  <Dialog v-model:open="ouvert">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader class="relative pr-20">
        <EasybeerLink
          v-if="idCommande != null"
          :href="easybeerLien.commandeDetail(easybeerAppUrl, idCommande)"
          label="Ouvrir la commande dans Easybeer"
          class="absolute top-0 right-10 text-muted-foreground"
        />
        <DialogTitle class="flex items-center gap-2">
          Commande n° {{ data?.numero ?? idCommande }}
          <EtatBadge v-if="data?.etat" :etat="data.etat" />
        </DialogTitle>
        <DialogDescription v-if="data?.reference">Réf. {{ data.reference }}</DialogDescription>
      </DialogHeader>

      <div v-if="isPending" class="grid gap-2">
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-16 w-full" />
      </div>

      <!-- Ban Easybeer : message doux + réessai, plutôt qu'une erreur rouge -->
      <div v-else-if="isError && banni" class="grid justify-items-center gap-3 py-4 text-center">
        <p class="text-sm text-muted-foreground">
          Le détail est lu en direct dans Easybeer, momentanément saturé.
          Réessayez dans {{ secondesRestantes }} s.
        </p>
        <Button variant="outline" size="sm" :disabled="isFetching || banni" @click="refetch()">
          {{ isFetching ? 'Chargement…' : `Réessayez dans ${secondesRestantes} s` }}
        </Button>
      </div>

      <div v-else-if="isError" class="grid justify-items-center gap-3 py-4 text-center">
        <p class="text-sm text-destructive">{{ (error as Error)?.message }}</p>
        <Button variant="outline" size="sm" :disabled="isFetching" @click="refetch()">Réessayer</Button>
      </div>

      <div v-else-if="data" class="grid gap-4">
        <div class="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader class="[&_tr]:bg-muted">
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead class="text-right">Qté</TableHead>
                <TableHead class="text-right">Total HT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="(l, i) in data.lignes" :key="i" class="odd:bg-background even:bg-muted/45">
                <TableCell class="font-medium">{{ l.designation }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ l.quantite }}</TableCell>
                <TableCell class="text-right tabular-nums text-muted-foreground">
                  {{ l.prixUnitaireHT != null ? prixFr(l.prixUnitaireHT * l.quantite) : '—' }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <dl class="grid gap-1 border-t pt-3 text-sm">
          <div
            v-for="t in totaux"
            :key="t.label"
            class="flex items-baseline justify-between gap-3"
            :class="t.fort ? 'font-semibold' : 'text-muted-foreground'"
          >
            <dt>{{ t.label }}</dt>
            <dd class="tabular-nums">{{ t.valeur }}</dd>
          </div>
        </dl>

        <p v-if="data.commentaire" class="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground italic">
          « {{ data.commentaire }} »
        </p>

        <div v-if="data.documents.length" class="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button
            v-for="doc in data.documents"
            :key="doc.idCommandeDocument"
            variant="outline"
            size="sm"
            :disabled="telechargementEnCours === doc.idCommandeDocument"
            @click="telecharger(doc)"
          >
            ⤓ {{ doc.libelle }} {{ doc.code }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
