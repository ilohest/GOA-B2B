<script setup lang="ts">
/**
 * Layout de l'administration : menu vertical à gauche (desktop, type Shopify),
 * menu hamburger sur mobile. Les sections sont des routes enfants.
 */
import { onMounted } from 'vue'
import { api } from '@/lib/api'
import { signalerBanEasybeer } from '@/composables/useEasybeerBan'
import { adminSections as sections } from '@/lib/navigation'

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

    <div class="min-w-0">
      <RouterView />
    </div>
  </div>
</template>
