<script setup lang="ts">
/**
 * Layout de l'espace client : menu vertical à gauche (desktop), onglets
 * horizontaux (mobile) — même patron que l'admin pour la cohérence.
 */
import { ClipboardList, Store, UserRound } from '@lucide/vue'

const sections = [
  { to: '/', label: 'Boutique', exact: true, icon: Store },
  { to: '/commandes', label: 'Mes commandes', icon: ClipboardList },
  { to: '/compte', label: 'Mon compte', icon: UserRound },
]
</script>

<template>
  <div class="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <!-- Sidebar desktop -->
    <nav class="sticky top-20 hidden gap-1 lg:grid" aria-label="Espace client">
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
    <nav class="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm lg:hidden" aria-label="Espace client">
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
