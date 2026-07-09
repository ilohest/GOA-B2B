<script setup lang="ts">
import { computed } from 'vue'
import { useMe } from '@/composables/useMe'
import { prixFr } from '@/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const { data, isPending, isError, error } = useMe()

const lignes = computed(() => {
  const client = data.value?.client
  if (!client) return []
  return [
    { label: 'Commerce', valeur: client.nom ?? client.raisonSociale },
    { label: 'N° client', valeur: client.numero },
    { label: 'Catégorie', valeur: client.type?.libelle },
    {
      label: 'Minimum de commande',
      valeur: client.minimumCommande != null ? `${prixFr(client.minimumCommande)} HT` : null,
    },
    { label: 'Email du compte', valeur: data.value?.user.email },
  ]
})
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Mon compte</CardTitle>
      <CardDescription>
        Informations lues depuis Easybeer. Pour toute modification (adresse, conditions…),
        contactez GOA.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="isPending" class="grid gap-2">
        <Skeleton class="h-5 w-2/3" />
        <Skeleton class="h-4 w-1/2" />
      </div>
      <p v-else-if="isError" class="text-sm text-destructive">
        Impossible de charger votre compte : {{ (error as Error)?.message }}
      </p>
      <dl v-else-if="lignes.length" class="grid gap-3 text-sm">
        <div v-for="l in lignes" :key="l.label" class="grid gap-0.5 sm:grid-cols-[14rem_1fr]">
          <dt class="text-muted-foreground">{{ l.label }}</dt>
          <dd class="font-medium">{{ l.valeur ?? '—' }}</dd>
        </div>
      </dl>
      <p v-else class="text-sm text-muted-foreground">
        Votre compte n'est pas encore relié à une fiche client — contactez GOA.
      </p>
    </CardContent>
  </Card>
</template>
