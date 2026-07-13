<script setup lang="ts">
/**
 * Layout de l'administration : menu vertical à gauche (desktop, type Shopify),
 * onglets horizontaux sur mobile. Les sections sont des routes enfants.
 */
import { onMounted } from 'vue'
import { CircleHelp, LayoutDashboard, Package, ReceiptText, Users } from '@lucide/vue'
import { api } from '@/lib/api'
import { signalerBanEasybeer } from '@/composables/useEasybeerBan'

const sections = [
  { to: '/admin', label: 'Tableau de bord', exact: true, icon: LayoutDashboard },
  { to: '/admin/clients', label: 'Clients', icon: Users },
  { to: '/admin/commandes', label: 'Commandes', icon: ReceiptText },
  { to: '/admin/catalogue', label: 'Catalogue', icon: Package },
  { to: '/admin/aide', label: 'Aide', icon: CircleHelp },
]

// Amorce le compte à rebours si un ban est déjà en cours à l'entrée dans l'admin.
onMounted(async () => {
  const s = await api
    .get<{ banni: boolean; secondesRestantes: number }>('/admin/statut-easybeer')
    .catch(() => null)
  if (s?.banni) signalerBanEasybeer(s.secondesRestantes)
})
</script>

<template>
  <div class="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <!-- Sidebar desktop -->
    <nav class="sticky top-20 hidden gap-1 lg:grid" aria-label="Sections admin">
      <RouterLink
        v-for="s in sections"
        :key="s.to"
        :to="s.to"
        class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
        :exact-active-class="s.exact ? 'bg-background font-semibold text-foreground shadow-sm ring-1 ring-border/60' : ''"
        :active-class="s.exact ? '' : 'bg-background font-semibold text-foreground shadow-sm ring-1 ring-border/60'"
      >
        <component :is="s.icon" class="size-4" />
        <span>{{ s.label }}</span>
      </RouterLink>
    </nav>

    <!-- Onglets mobile -->
    <nav class="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm lg:hidden" aria-label="Sections admin">
      <RouterLink
        v-for="s in sections"
        :key="s.to"
        :to="s.to"
        class="flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
        :exact-active-class="s.exact ? 'bg-background font-medium text-foreground shadow-sm' : ''"
        :active-class="s.exact ? '' : 'bg-background font-medium text-foreground shadow-sm'"
      >
        <component :is="s.icon" class="size-4" />
        <span>{{ s.label }}</span>
      </RouterLink>
    </nav>

    <div class="min-w-0">
      <RouterView />
    </div>
  </div>
</template>
