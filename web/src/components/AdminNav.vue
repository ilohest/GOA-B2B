<script setup lang="ts">
const liens = [
  { to: '/admin', label: 'Clients' },
  { to: '/admin/catalogue', label: 'Catalogue' },
]
</script>

<template>
  <nav class="flex gap-1 rounded-lg bg-muted p-1 text-sm" aria-label="Sections admin">
    <RouterLink
      v-for="lien in liens"
      :key="lien.to"
      :to="lien.to"
      class="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
      exact-active-class="bg-background font-medium text-foreground shadow-sm"
    >
      {{ lien.label }}
    </RouterLink>
  </nav>
</template>
