<script setup lang="ts">
import { useMe } from '@/composables/useMe'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const { data, isPending, isError, error } = useMe()
</script>

<template>
  <div class="mx-auto grid w-full max-w-xl gap-4">
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Mon compte</CardTitle>
        <CardDescription>Informations lues depuis Easybeer</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="isPending" class="grid gap-2">
          <Skeleton class="h-5 w-2/3" />
          <Skeleton class="h-4 w-1/2" />
          <Skeleton class="h-4 w-1/3" />
        </div>
        <p v-else-if="isError" class="text-sm text-destructive">
          Impossible de charger votre compte : {{ (error as Error)?.message }}
        </p>
        <dl v-else-if="data?.client" class="grid gap-2 text-sm">
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">Commerce</dt>
            <dd class="text-right font-medium">{{ data.client.nom ?? data.client.raisonSociale }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">N° client</dt>
            <dd class="text-right">{{ data.client.numero }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">Catégorie</dt>
            <dd class="text-right">{{ data.client.type?.libelle ?? '—' }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">Compte</dt>
            <dd class="text-right">{{ data.user.email }}</dd>
          </div>
        </dl>
        <p v-else class="text-sm text-muted-foreground">
          Votre compte n'est pas encore relié à une fiche client — contactez GOA.
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Catalogue &amp; commande</CardTitle>
        <CardDescription>Bientôt disponible — étapes 4 et 5 du développement.</CardDescription>
      </CardHeader>
    </Card>
  </div>
</template>
