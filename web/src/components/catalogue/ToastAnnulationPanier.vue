<script setup lang="ts">
defineProps<{ texte?: string }>();
</script>

<template>
  <span class="contents">
    <span v-if="texte">{{ texte }}</span>
    <span
      class="toast-annulation-progression pointer-events-none absolute inset-x-0 bottom-0 h-[3px] origin-left bg-primary"
      aria-hidden="true"
    />
  </span>
</template>

<style scoped>
.toast-annulation-progression {
  animation: toast-annulation-progression 7s linear forwards;
}

:global([data-sonner-toaster]:hover) .toast-annulation-progression,
:global(.panier-toast-annulation:focus-within) .toast-annulation-progression {
  animation-play-state: paused;
}

@keyframes toast-annulation-progression {
  to {
    transform: scaleX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast-annulation-progression {
    animation: none;
  }
}
</style>
