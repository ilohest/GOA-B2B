<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Menu, X } from '@lucide/vue'
import type { Component } from 'vue'
import { Button } from '@/components/ui/button'

defineProps<{
  label: string
  sections: {
    to: string
    label: string
    exact?: boolean
    icon: Component
  }[]
}>()

const route = useRoute()
const ouvert = ref(false)

watch(
  () => route.fullPath,
  () => {
    ouvert.value = false
  },
)
</script>

<template>
  <div class="lg:hidden">
    <Button
      type="button"
      variant="outline"
      size="icon"
      class="size-9 rounded-lg border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
      :aria-expanded="ouvert"
      :aria-label="label"
      @click="ouvert = !ouvert"
    >
      <Menu class="size-5" />
    </Button>

    <Teleport to="body">
      <Transition name="mobile-menu-fade">
        <div v-if="ouvert" class="fixed inset-0 z-50 bg-black/45 lg:hidden" @click="ouvert = false" />
      </Transition>
      <Transition name="mobile-menu-slide">
        <aside
          v-if="ouvert"
          class="fixed top-0 left-0 z-50 grid h-dvh w-[min(20rem,calc(100vw-3rem))] grid-rows-[auto_1fr] rounded-r-2xl bg-muted p-3 shadow-2xl lg:hidden"
          :aria-label="label"
        >
          <div class="mb-2 flex items-center justify-end">
            <Button type="button" variant="ghost" size="icon" class="size-8" :aria-label="`Fermer ${label}`" @click="ouvert = false">
              <X class="size-4" />
            </Button>
          </div>

          <nav class="grid content-start gap-1 overflow-y-auto text-sm" :aria-label="label">
            <RouterLink
              v-for="section in sections"
              :key="section.to"
              :to="section.to"
              class="flex items-center gap-2 rounded-lg px-3 py-2.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              :exact-active-class="section.exact ? 'bg-background font-semibold text-foreground shadow-sm ring-1 ring-border/60' : ''"
              :active-class="section.exact ? '' : 'bg-background font-semibold text-foreground shadow-sm ring-1 ring-border/60'"
            >
              <component :is="section.icon" class="size-4" />
              <span>{{ section.label }}</span>
            </RouterLink>
          </nav>
        </aside>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.mobile-menu-fade-enter-active,
.mobile-menu-fade-leave-active {
  transition: opacity 160ms ease;
}

.mobile-menu-fade-enter-from,
.mobile-menu-fade-leave-to {
  opacity: 0;
}

.mobile-menu-slide-enter-active,
.mobile-menu-slide-leave-active {
  transition:
    transform 190ms ease,
    opacity 190ms ease;
}

.mobile-menu-slide-enter-from,
.mobile-menu-slide-leave-to {
  opacity: 0;
  transform: translateX(-1rem);
}
</style>
