<script setup lang="ts">
/**
 * Logo GOA (assets officiels du site goa-kombucha.fr, servis depuis /brand).
 *  - `rond`    : pastille verte (header, favicon, placeholders)
 *  - `complet` : logo complet GOA KOMBUCHA (pages d'auth)
 */
withDefaults(defineProps<{ variante?: 'rond' | 'complet' }>(), { variante: 'rond' })
</script>

<template>
  <img
    v-if="variante === 'rond'"
    src="/brand/goa-rond.png"
    alt="GOA Kombucha"
    class="size-8 rounded-full"
  />
  <img v-else src="/brand/logo-goa.webp" alt="GOA Kombucha" class="mx-auto h-20 w-auto" />
</template>
