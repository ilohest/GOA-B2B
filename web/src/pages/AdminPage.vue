<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FlexRender,
  getCoreRowModel,
  useVueTable,
  type ColumnDef,
} from '@tanstack/vue-table'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { AdminClientsResponse, ClientEasybeer, InvitationResponse, SyncReport } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// --- Liste des clients Easybeer (pagination serveur) ---

const page = ref(1)
const rechercheInput = ref('')
const recherche = ref('')

const { data, isPending, isError, error } = useQuery({
  queryKey: ['admin', 'clients', page, recherche],
  queryFn: () =>
    api.get<AdminClientsResponse>(
      `/admin/clients?page=${page.value}${recherche.value ? `&q=${encodeURIComponent(recherche.value)}` : ''}`,
    ),
  placeholderData: (prev) => prev,
})

function lancerRecherche() {
  page.value = 1
  recherche.value = rechercheInput.value.trim()
}

// --- Invitation ---

const queryClient = useQueryClient()
const dialogOuvert = ref(false)
const cible = ref<ClientEasybeer | null>(null)
const emailInvitation = ref('')
const resultat = ref<InvitationResponse | null>(null)

function ouvrirInvitation(client: ClientEasybeer) {
  cible.value = client
  emailInvitation.value = client.emailPrincipal ?? ''
  resultat.value = null
  dialogOuvert.value = true
}

const invitation = useMutation({
  mutationFn: (input: { easybeerIdClient: number; email?: string }) =>
    api.post<InvitationResponse>('/admin/invitations', input),
  onSuccess: (res) => {
    resultat.value = res
    queryClient.invalidateQueries({ queryKey: ['admin', 'clients'] })
  },
  onError: (e) => toast.error((e as Error).message),
})

function envoyerInvitation() {
  if (!cible.value?.idClient) return
  invitation.mutate({
    easybeerIdClient: cible.value.idClient,
    email: emailInvitation.value.trim() || undefined,
  })
}

async function copierLien() {
  if (!resultat.value) return
  await navigator.clipboard.writeText(resultat.value.lien)
  toast.success('Lien copié — envoyez-le au client.')
}

// --- Synchro du cache Easybeer ---

const { data: syncMeta } = useQuery({
  queryKey: ['admin', 'sync'],
  queryFn: () => api.get<{ dernierSync: SyncReport | null }>('/admin/sync'),
})

const synchro = useMutation({
  mutationFn: () => api.post<{ ok: boolean; report: SyncReport }>('/admin/sync'),
  onSuccess: ({ report }) => {
    toast.success(
      `Synchro terminée : ${report.produits} produits, ${report.clients.length} client(s), ${Math.round(report.dureeMs / 1000)} s.`,
    )
    queryClient.invalidateQueries()
  },
  onError: (e) => toast.error((e as Error).message),
})

const dernierSync = computed(() => synchro.data.value?.report ?? syncMeta.value?.dernierSync ?? null)

const formatDate = (ts: number) =>
  new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

// --- Table (TanStack) ---

const compteDe = (c: ClientEasybeer) =>
  c.idClient != null ? data.value?.comptes?.[c.idClient] : undefined

const columns: ColumnDef<ClientEasybeer>[] = [
  {
    id: 'commerce',
    header: 'Commerce',
    cell: ({ row }) =>
      h('div', { class: 'min-w-40' }, [
        h('p', { class: 'font-medium' }, row.original.nom ?? row.original.raisonSociale ?? '—'),
        h('p', { class: 'text-xs text-muted-foreground' }, row.original.numero ?? ''),
      ]),
  },
  {
    id: 'email',
    header: 'Email',
    cell: ({ row }) =>
      h('span', { class: 'text-sm text-muted-foreground' }, row.original.emailPrincipal || '—'),
  },
  {
    id: 'type',
    header: 'Catégorie',
    cell: ({ row }) => h('span', { class: 'text-sm' }, row.original.type?.libelle ?? '—'),
  },
  {
    id: 'compte',
    header: 'Compte',
    cell: ({ row }) => {
      const compte = compteDe(row.original)
      if (!compte) return h('span', { class: 'text-sm text-muted-foreground' }, '—')
      return compte.statut === 'active'
        ? h(Badge, () => 'Actif')
        : h(Badge, { variant: 'secondary' }, () => 'Invité')
    },
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => {
      const compte = compteDe(row.original)
      return h(
        'div',
        { class: 'text-right' },
        h(
          Button,
          {
            variant: compte ? 'ghost' : 'outline',
            size: 'sm',
            onClick: () => ouvrirInvitation(row.original),
          },
          () => (compte ? 'Ré-inviter' : 'Inviter'),
        ),
      )
    },
  },
]

const table = useVueTable({
  get data() {
    return data.value?.liste ?? []
  },
  columns,
  getCoreRowModel: getCoreRowModel(),
  manualPagination: true,
})

const totalPages = computed(() => data.value?.totalPages ?? 1)
</script>

<template>
  <div class="grid gap-4">
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Synchronisation Easybeer</CardTitle>
        <CardDescription>
          Le catalogue et les paramètres clients sont lus depuis un cache, resynchronisé
          périodiquement (jamais d'appel Easybeer en direct côté client).
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted-foreground">
          <template v-if="dernierSync">
            Dernière synchro : {{ formatDate(dernierSync.syncedAt) }} —
            {{ dernierSync.produits }} produits, {{ dernierSync.clients.length }} client(s)
            <span v-if="dernierSync.clients.some((c) => c.erreur)" class="text-destructive">
              ({{ dernierSync.clients.filter((c) => c.erreur).length }} en erreur)
            </span>
          </template>
          <template v-else>Aucune synchro complète pour l'instant.</template>
        </p>
        <Button :disabled="synchro.isPending.value" variant="secondary" @click="synchro.mutate()">
          {{ synchro.isPending.value ? 'Synchronisation…' : 'Synchroniser maintenant' }}
        </Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Clients</CardTitle>
        <CardDescription>
          Liste lue depuis Easybeer. Invitez un client pour lui créer un accès à la plateforme.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <form class="flex gap-2" @submit.prevent="lancerRecherche">
          <Input
            v-model="rechercheInput"
            placeholder="Rechercher un commerce…"
            class="max-w-xs"
            :aria-label="'Rechercher un client'"
          />
          <Button type="submit" variant="secondary">Rechercher</Button>
        </form>

        <div v-if="isPending" class="grid gap-2">
          <Skeleton v-for="i in 6" :key="i" class="h-10 w-full" />
        </div>

        <p v-else-if="isError" class="text-sm text-destructive">
          {{ (error as Error)?.message }}
        </p>

        <template v-else>
          <div class="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
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
                <TableRow v-for="row in table.getRowModel().rows" :key="row.id">
                  <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
                    <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
                  </TableCell>
                </TableRow>
                <TableRow v-if="!table.getRowModel().rows.length">
                  <TableCell :colspan="columns.length" class="h-16 text-center text-muted-foreground">
                    Aucun client trouvé.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div class="flex items-center justify-between text-sm text-muted-foreground">
            <span>{{ data?.totalElements ?? 0 }} clients — page {{ page }} / {{ totalPages }}</span>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" :disabled="page <= 1" @click="page--">
                Précédent
              </Button>
              <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="page++">
                Suivant
              </Button>
            </div>
          </div>
        </template>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOuvert">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Inviter {{ cible?.nom ?? cible?.raisonSociale }}</DialogTitle>
          <DialogDescription>
            Un lien « créez votre mot de passe » sera généré pour ce client
            ({{ cible?.numero }}).
          </DialogDescription>
        </DialogHeader>

        <div v-if="!resultat" class="grid gap-4">
          <div class="grid gap-1.5">
            <Label for="email-invitation">Email du compte</Label>
            <Input
              id="email-invitation"
              v-model="emailInvitation"
              type="email"
              placeholder="email@commerce.fr"
            />
            <p class="text-xs text-muted-foreground">
              Pré-rempli avec l'email Easybeer du client. Modifiable (ex. autre acheteur du
              même commerce).
            </p>
          </div>
          <DialogFooter>
            <Button :disabled="invitation.isPending.value" @click="envoyerInvitation">
              {{ invitation.isPending.value ? 'Création…' : "Générer l'invitation" }}
            </Button>
          </DialogFooter>
        </div>

        <div v-else class="grid gap-4">
          <p class="text-sm">
            Invitation prête pour <span class="font-medium">{{ resultat.email }}</span>
            <template v-if="resultat.dejaActif">
              — ce compte est déjà actif, le lien réinitialisera son mot de passe.
            </template>
          </p>
          <div class="rounded-lg border bg-muted/50 p-3">
            <p class="text-xs break-all text-muted-foreground">{{ resultat.lien }}</p>
          </div>
          <DialogFooter class="gap-2">
            <Button variant="secondary" @click="dialogOuvert = false">Fermer</Button>
            <Button @click="copierLien">Copier le lien</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
