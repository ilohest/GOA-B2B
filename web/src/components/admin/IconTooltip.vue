<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    text: string
    class?: HTMLAttributes['class']
  }>(),
  {
    class: '',
  },
)
</script>

<template>
  <span :class="cn('group/icon-tooltip relative inline-flex', props.class)">
    <slot />
    <span
      class="pointer-events-none absolute top-full right-0 z-50 mt-2 rounded-md border bg-popover px-3 py-1.5 text-xs font-medium whitespace-nowrap text-popover-foreground opacity-0 shadow-md transition-all duration-150 group-hover/icon-tooltip:opacity-100 group-focus-within/icon-tooltip:opacity-100"
      aria-hidden="true"
    >
      <span class="absolute -top-1 right-3 size-2 rotate-45 border-t border-l bg-popover" />
      {{ text }}
    </span>
  </span>
</template>
