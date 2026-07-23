<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    text: string
    class?: HTMLAttributes['class']
    contentClass?: HTMLAttributes['class']
    arrowClass?: HTMLAttributes['class']
    showOnFocus?: boolean
  }>(),
  {
    class: '',
    contentClass: '',
    arrowClass: '',
    showOnFocus: false,
  },
)
</script>

<template>
  <span :class="cn('group/icon-tooltip relative inline-flex', props.class)">
    <slot />
    <span
      :class="cn(
        'pointer-events-none absolute top-full right-0 z-50 mt-2 rounded-md border bg-popover px-3 py-1.5 text-xs font-medium whitespace-nowrap text-popover-foreground opacity-0 shadow-md transition-all duration-150 group-hover/icon-tooltip:opacity-100',
        props.showOnFocus && 'group-focus-within/icon-tooltip:opacity-100',
        props.contentClass,
      )"
      aria-hidden="true"
    >
      <span
        :class="cn(
          'absolute -top-1 right-3 size-2 rotate-45 border-t border-l bg-popover',
          props.arrowClass,
        )"
      />
      {{ text }}
    </span>
  </span>
</template>
