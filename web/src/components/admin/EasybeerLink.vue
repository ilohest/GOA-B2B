<script setup lang="ts">
import { ExternalLink } from '@lucide/vue'
import type { HTMLAttributes } from 'vue'
import { Button } from '@/components/ui/button'
import IconTooltip from '@/components/admin/IconTooltip.vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    href: string
    label: string
    class?: HTMLAttributes['class']
    tooltip?: string
  }>(),
  {
    tooltip: 'Ouvrir Easybeer',
  },
)
</script>

<template>
  <IconTooltip :text="tooltip" :class="cn('inline-flex', props.class)">
    <Button variant="ghost" size="icon-sm" class="text-muted-foreground" as-child>
      <a :href="href" target="_blank" rel="noopener" :aria-label="label">
        <ExternalLink class="size-4" />
      </a>
    </Button>
  </IconTooltip>
</template>
