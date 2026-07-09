<script setup lang="ts">
/**
 * Layout de l'espace client : menu vertical à gauche (desktop), onglets
 * horizontaux (mobile) — même patron que l'admin pour la cohérence.
 */
const sections = [
  { to: '/', label: 'Boutique', exact: true },
  { to: '/commandes', label: 'Mes commandes' },
  { to: '/compte', label: 'Mon compte' },
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
        class="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :exact-active-class="s.exact ? 'bg-muted font-medium text-foreground' : ''"
        :active-class="s.exact ? '' : 'bg-muted font-medium text-foreground'"
      >
        {{ s.label }}
      </RouterLink>
    </nav>

    <!-- Onglets mobile -->
    <nav class="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm lg:hidden" aria-label="Espace client">
      <RouterLink
        v-for="s in sections"
        :key="s.to"
        :to="s.to"
        class="shrink-0 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
        :exact-active-class="s.exact ? 'bg-background font-medium text-foreground shadow-sm' : ''"
        :active-class="s.exact ? '' : 'bg-background font-medium text-foreground shadow-sm'"
      >
        {{ s.label }}
      </RouterLink>
    </nav>

    <div class="min-w-0">
      <RouterView />
    </div>
  </div>
</template>
