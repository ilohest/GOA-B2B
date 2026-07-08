<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { CommandeEdition, CommandeResume } from '@/lib/types'
import { usePanier } from '@/composables/usePanier'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const router = useRouter()
const { chargerCommande } = usePanier()

const { data, isPending, isError, error } = useQuery({
  queryKey: ['commandes'],
  queryFn: () => api.get<{ commandes: CommandeResume[] }>('/commandes'),
})

const prixFr = (v: number) => v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const dateFr = (ts: number | null) =>
  ts ? new Date(ts).toLocaleDateString('fr-FR', { dateStyle: 'medium' }) : '—'

const chargement = ref<number | null>(null)

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
        Historique lu depuis Easybeer. Une commande reste modifiable tant qu'elle n'est pas
        livrée — la nouvelle version annule et remplace la précédente.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="isPending" class="grid gap-2">
        <Skeleton v-for="i in 4" :key="i" class="h-14 w-full" />
      </div>

      <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

      <p v-else-if="!data?.commandes.length" class="text-sm text-muted-foreground">
        Aucune commande pour l'instant.
      </p>

      <ul v-else class="divide-y">
        <li
          v-for="cmd in data.commandes"
          :key="cmd.idCommande"
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <div>
            <p class="text-sm font-medium">Commande n° {{ cmd.numero ?? cmd.idCommande }}</p>
            <p class="text-xs text-muted-foreground">{{ dateFr(cmd.dateCreation) }}</p>
          </div>
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
          </div>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
