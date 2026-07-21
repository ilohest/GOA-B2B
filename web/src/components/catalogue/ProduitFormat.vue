<script setup lang="ts">
defineProps<{
  contenant?: string | null
  packaging?: string | null
}>()
</script>

<template>
  <div
    v-if="contenant || packaging"
    class="flex flex-wrap gap-1.5"
    aria-label="Format du produit"
  >
    <span
      v-if="contenant"
      class="inline-flex items-center rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground"
    >
      {{ contenant }}
    </span>
    <span
      v-if="packaging"
      class="inline-flex items-center rounded-full border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground"
    >
      {{ packaging }}
    </span>
  </div>
</template>
