<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { FlexRender, getCoreRowModel, useVueTable, type ColumnDef } from '@tanstack/vue-table'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type {
  AdminClientsResponse,
  ClientResume,
  InvitationBulkResultat,
  InvitationResponse,
  Tournee,
} from '@/lib/types'
import { dateHeureFr } from '@/lib/format'
import BoutonActualiser from '@/components/admin/BoutonActualiser.vue'
import EasybeerIndisponible from '@/components/admin/EasybeerIndisponible.vue'
import { signalerBanEasybeer } from '@/composables/useEasybeerBan'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const router = useRouter()
const queryClient = useQueryClient()

// --- Clients : servis depuis le CACHE serveur (recherche/pagination locales) ---

const { data, isPending, isError, error, refetch, isFetching } = useQuery({
  queryKey: ['admin', 'clients'],
  queryFn: () => api.get<AdminClientsResponse>('/admin/clients'),
})

watch(data, (d) => {
  if (d?.indisponible && d.retryAfterSeconds) signalerBanEasybeer(d.retryAfterSeconds)
})

const actualisation = useMutation({
  mutationFn: () => api.get<AdminClientsResponse>('/admin/clients?refresh=1'),
  onSuccess: (res) => {
    queryClient.setQueryData(['admin', 'clients'], res)
    toast.success('Liste resynchronisée depuis Easybeer.')
  },
  onError: (e) => toast.error((e as Error).message),
})

const recherche = ref('')
const toutAfficher = ref(false)
const PAR_PAGE = 25
const page = ref(1)

const clientsFiltres = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  const tous = data.value?.clients ?? []
  if (!q) return tous
  return tous.filter((c) =>
    [c.nom, c.raisonSociale, c.numero, c.emailPrincipal, c.categorie].some((v) =>
      v?.toLowerCase().includes(q),
    ),
  )
})

const totalPages = computed(() =>
  toutAfficher.value ? 1 : Math.max(1, Math.ceil(clientsFiltres.value.length / PAR_PAGE)),
)
const clientsAffiches = computed(() => {
  if (toutAfficher.value) return clientsFiltres.value
  const debut = (Math.min(page.value, totalPages.value) - 1) * PAR_PAGE
  return clientsFiltres.value.slice(debut, debut + PAR_PAGE)
})

function surRecherche() {
  page.value = 1
}

// --- Sélection (checkbox, conservée à travers pages et recherches) ---

const selection = reactive(new Set<number>())

const idsAffiches = computed(() =>
  clientsAffiches.value.map((c) => c.idClient).filter((id): id is number => id != null),
)
const toutSelectionne = computed(
  () => idsAffiches.value.length > 0 && idsAffiches.value.every((id) => selection.has(id)),
)

function basculerTout(coche: boolean) {
  for (const id of idsAffiches.value) {
    if (coche) selection.add(id)
    else selection.delete(id)
  }
}

// --- Invitation unitaire ---

const dialogOuvert = ref(false)
const cible = ref<ClientResume | null>(null)
const emailInvitation = ref('')
const resultat = ref<InvitationResponse | null>(null)

function ouvrirInvitation(client: ClientResume) {
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

async function copier(texte: string) {
  await navigator.clipboard.writeText(texte)
  toast.success('Lien copié — envoyez-le au client.')
}

// --- Invitations en masse ---

const dialogBulkInvitations = ref(false)
const resultatsBulk = ref<InvitationBulkResultat[] | null>(null)

const bulkInvitations = useMutation({
  mutationFn: () =>
    api.post<{ resultats: InvitationBulkResultat[]; reussies: number }>('/admin/invitations/bulk', {
      invitations: [...selection].map((easybeerIdClient) => ({ easybeerIdClient })),
    }),
  onSuccess: (res) => {
    resultatsBulk.value = res.resultats
    toast.success(`${res.reussies}/${res.resultats.length} invitation(s) générée(s).`)
    selection.clear()
    queryClient.invalidateQueries({ queryKey: ['admin', 'clients'] })
  },
  onError: (e) => toast.error((e as Error).message),
})

function ouvrirBulkInvitations() {
  resultatsBulk.value = null
  dialogBulkInvitations.value = true
}

// --- Paramètres en masse (tournée / mode de livraison / minimum) ---

const dialogParams = ref(false)
const tourneeChoisie = ref<string>('')
const livraisonChoisie = ref<string>('')
const minimumSaisi = ref<string>('')

const referentiels = useQuery({
  queryKey: ['admin', 'tournees'],
  queryFn: () =>
    api.get<{ tournees: Tournee[]; typesLivraison: { code: string; libelle: string }[] }>('/admin/tournees'),
  enabled: dialogParams,
})

const bulkParams = useMutation({
  mutationFn: () =>
    api.post<{ ok: boolean; clients: number; erreurs: string[] }>('/admin/clients/bulk-params', {
      idsClients: [...selection],
      ...(tourneeChoisie.value ? { idClientTournee: Number(tourneeChoisie.value) } : {}),
      ...(livraisonChoisie.value ? { typeLivraison: livraisonChoisie.value } : {}),
      ...(minimumSaisi.value.trim() !== '' ? { minimumCommande: Number(minimumSaisi.value) } : {}),
    }),
  onSuccess: (res) => {
    if (res.erreurs.length) {
      toast.warning(`Appliqué avec ${res.erreurs.length} avertissement(s) : ${res.erreurs[0]}`)
    } else {
      toast.success(`Paramètres appliqués à ${res.clients} client(s).`)
    }
    selection.clear()
    dialogParams.value = false
    tourneeChoisie.value = ''
    livraisonChoisie.value = ''
    minimumSaisi.value = ''
  },
  onError: (e) => toast.error((e as Error).message),
})

const bulkParamsValide = computed(
  () =>
    (tourneeChoisie.value || livraisonChoisie.value || minimumSaisi.value.trim() !== '') &&
    (minimumSaisi.value.trim() === '' || Number(minimumSaisi.value) >= 0) &&
    // Minimum = 2 appels Easybeer par client : lot limité à 30 (limite serveur).
    (minimumSaisi.value.trim() === '' || selection.size <= 30),
)

// --- Table ---

const compteDe = (c: ClientResume) =>
  c.idClient != null ? data.value?.comptes?.[c.idClient] : undefined

const columns: ColumnDef<ClientResume>[] = [
  {
    id: 'selection',
    header: () =>
      h(Checkbox, {
        modelValue: toutSelectionne.value,
        'aria-label': 'Tout sélectionner',
        'onUpdate:modelValue': (v: boolean | 'indeterminate') => basculerTout(v === true),
      }),
    cell: ({ row }) => {
      const id = row.original.idClient
      if (id == null) return null
      return h(Checkbox, {
        modelValue: selection.has(id),
        'aria-label': `Sélectionner ${row.original.nom}`,
        'onUpdate:modelValue': (v: boolean | 'indeterminate') => {
          if (v === true) selection.add(id)
          else selection.delete(id)
        },
        onClick: (e: Event) => e.stopPropagation(),
      })
    },
  },
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
    id: 'categorie',
    header: 'Catégorie',
    cell: ({ row }) => h('span', { class: 'text-sm' }, row.original.categorie ?? '—'),
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
            onClick: (e: Event) => {
              e.stopPropagation()
              ouvrirInvitation(row.original)
            },
          },
          () => (compte ? 'Ré-inviter' : 'Inviter'),
        ),
      )
    },
  },
]

const table = useVueTable({
  get data() {
    return clientsAffiches.value
  },
  columns,
  getCoreRowModel: getCoreRowModel(),
})

function ouvrirFiche(client: ClientResume) {
  if (client.idClient != null) router.push(`/admin/clients/${client.idClient}`)
}
</script>

<template>
  <div class="grid gap-4">
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Clients</CardTitle>
        <CardDescription>
          Liste servie depuis le cache
          <template v-if="data"> (à jour : {{ dateHeureFr(data.syncedAt) }})</template>.
          Cliquez sur un client pour sa fiche ; cochez pour les actions en masse.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <Input
            v-model="recherche"
            placeholder="Rechercher (nom, n°, email, catégorie)…"
            class="max-w-xs"
            @input="surRecherche"
          />
          <BoutonActualiser :pending="actualisation.isPending.value" @click="actualisation.mutate()" />
        </div>

        <!-- Barre d'actions en masse -->
        <div
          v-if="selection.size > 0"
          class="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2"
        >
          <p class="text-sm font-medium">{{ selection.size }} sélectionné(s)</p>
          <Button size="sm" :disabled="bulkInvitations.isPending.value" @click="ouvrirBulkInvitations">
            Inviter la sélection
          </Button>
          <Button size="sm" variant="outline" @click="dialogParams = true">
            Paramètres en masse
          </Button>
          <Button size="sm" variant="ghost" class="text-muted-foreground" @click="selection.clear()">
            Tout désélectionner
          </Button>
        </div>

        <div v-if="isPending" class="grid gap-2">
          <Skeleton v-for="i in 6" :key="i" class="h-10 w-full" />
        </div>

        <p v-else-if="isError" class="text-sm text-destructive">{{ (error as Error)?.message }}</p>

        <EasybeerIndisponible
          v-else-if="data?.indisponible"
          :pending="isFetching"
          @reessayer="refetch()"
        />

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
                <TableRow
                  v-for="row in table.getRowModel().rows"
                  :key="row.id"
                  class="cursor-pointer"
                  @click="ouvrirFiche(row.original)"
                >
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

          <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {{ clientsFiltres.length }} client(s)
              <template v-if="!toutAfficher"> — page {{ Math.min(page, totalPages) }} / {{ totalPages }}</template>
            </span>
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" @click="toutAfficher = !toutAfficher; page = 1">
                {{ toutAfficher ? 'Paginer' : 'Tout afficher' }}
              </Button>
              <template v-if="!toutAfficher">
                <Button variant="outline" size="sm" :disabled="page <= 1" @click="page--">Précédent</Button>
                <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="page++">Suivant</Button>
              </template>
            </div>
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- Invitation unitaire -->
    <Dialog v-model:open="dialogOuvert">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Inviter {{ cible?.nom ?? cible?.raisonSociale }}</DialogTitle>
          <DialogDescription>
            Un lien « créez votre mot de passe » sera généré pour ce client ({{ cible?.numero }}).
          </DialogDescription>
        </DialogHeader>

        <div v-if="!resultat" class="grid gap-4">
          <div class="grid gap-1.5">
            <Label for="email-invitation">Email du compte</Label>
            <Input id="email-invitation" v-model="emailInvitation" type="email" placeholder="email@commerce.fr" />
            <p class="text-xs text-muted-foreground">
              Pré-rempli avec l'email Easybeer du client. Modifiable (ex. autre acheteur du même commerce).
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
            <Button @click="copier(resultat!.lien)">Copier le lien</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Invitations en masse -->
    <Dialog v-model:open="dialogBulkInvitations">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Inviter {{ resultatsBulk ? 'la sélection' : `${selection.size} client(s)` }}</DialogTitle>
          <DialogDescription>
            Une invitation individuelle est générée par client (email Easybeer de sa fiche).
            L'envoi automatique par email s'activera avec le SMTP — d'ici là, copiez les liens.
          </DialogDescription>
        </DialogHeader>

        <div v-if="!resultatsBulk" class="grid gap-4">
          <DialogFooter>
            <Button variant="secondary" @click="dialogBulkInvitations = false">Annuler</Button>
            <Button :disabled="bulkInvitations.isPending.value" @click="bulkInvitations.mutate()">
              {{ bulkInvitations.isPending.value ? 'Génération…' : 'Générer les invitations' }}
            </Button>
          </DialogFooter>
        </div>

        <div v-else class="grid max-h-80 gap-2 overflow-y-auto">
          <div
            v-for="r in resultatsBulk"
            :key="r.easybeerIdClient"
            class="flex items-center justify-between gap-3 rounded-lg border p-2"
          >
            <div class="min-w-0 text-sm">
              <template v-if="r.ok">
                <p class="truncate font-medium">{{ r.client?.nom ?? r.easybeerIdClient }}</p>
                <p class="truncate text-xs text-muted-foreground">{{ r.email }}</p>
              </template>
              <p v-else class="text-xs text-destructive">{{ r.erreur }}</p>
            </div>
            <Button v-if="r.ok && r.lien" size="sm" variant="outline" @click="copier(r.lien!)">
              Copier le lien
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Paramètres en masse -->
    <Dialog v-model:open="dialogParams">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Paramètres en masse</DialogTitle>
          <DialogDescription>
            Appliqués aux {{ selection.size }} client(s) sélectionné(s), directement dans
            Easybeer. Ne renseignez que ce que vous voulez modifier.
          </DialogDescription>
        </DialogHeader>

        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <Label>Tournée</Label>
            <Select v-model="tourneeChoisie">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Ne pas modifier" />
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

          <div class="grid gap-1.5">
            <Label>Mode de livraison</Label>
            <Select v-model="livraisonChoisie">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Ne pas modifier" />
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

          <div class="grid gap-1.5">
            <Label for="minimum-bulk">Minimum de commande HT (€)</Label>
            <Input
              id="minimum-bulk"
              v-model="minimumSaisi"
              type="number"
              min="0"
              step="0.01"
              placeholder="Ne pas modifier"
            />
            <p v-if="minimumSaisi.trim() !== '' && selection.size > 30" class="text-xs text-destructive">
              Le minimum s'écrit fiche par fiche : 30 clients maximum par lot.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" @click="dialogParams = false">Annuler</Button>
          <Button :disabled="!bulkParamsValide || bulkParams.isPending.value" @click="bulkParams.mutate()">
            {{ bulkParams.isPending.value ? 'Application…' : 'Appliquer' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
