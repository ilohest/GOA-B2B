<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { useAuth } from '@/composables/useAuth'
import { useHeaderSaveBar } from '@/composables/useHeaderSaveBar'
import { useMe } from '@/composables/useMe'
import BrandLogo from '@/components/BrandLogo.vue'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'

const router = useRouter()
const queryClient = useQueryClient()
const { isAuthenticated, user, logout } = useAuth()
const { data: me } = useMe()
const { saveBar, shakeTick, triggerSaveBarShake } = useHeaderSaveBar()
const saveBarShaking = ref(false)
let saveBarShakeTimer: number | undefined

const estAdmin = computed(() => me.value?.user.role === 'admin')
const nomHeader = computed(() => {
  if (me.value?.user.role === 'client') {
    return me.value.client?.nom ?? me.value.client?.raisonSociale ?? user.value?.email
  }
  return user.value?.email
})

// Largeur large façon back-office, limitée sur les écrans ultra-wide.
const largeur = 'max-w-[1920px]'

watch(shakeTick, async (tick, previousTick) => {
  if (tick <= previousTick || !saveBar.value) return

  saveBarShaking.value = false
  await nextTick()
  saveBarShaking.value = true

  if (saveBarShakeTimer) window.clearTimeout(saveBarShakeTimer)
  saveBarShakeTimer = window.setTimeout(() => {
    saveBarShaking.value = false
  }, 430)
})

onBeforeUnmount(() => {
  if (saveBarShakeTimer) window.clearTimeout(saveBarShakeTimer)
})

async function onLogout() {
  if (saveBar.value) {
    triggerSaveBarShake()
    return
  }

  try {
    await logout()
    queryClient.clear()
    router.push({ name: 'login' })
  } catch {
    toast.error('Déconnexion impossible. Réessayez.')
  }
}
</script>

<template>
  <div class="flex min-h-dvh flex-col" :class="isAuthenticated ? 'bg-zinc-950' : 'bg-background'">
    <header
      v-if="isAuthenticated"
      class="sticky top-0 z-10 bg-zinc-950 text-white"
    >
      <div class="mx-auto flex h-14 w-full items-center justify-between gap-3 px-4" :class="largeur">
        <RouterLink :to="estAdmin ? '/admin' : '/'" class="flex items-center gap-2">
          <BrandLogo variante="rond" />
          <span class="hidden text-sm font-semibold tracking-widest text-white uppercase sm:inline">
            GOA B2B
          </span>
        </RouterLink>
        <div class="flex items-center gap-2">
          <div
            v-if="saveBar"
            class="hidden items-center gap-2 rounded-xl border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-white shadow-sm md:flex"
            :class="{ 'header-save-bar-shake': saveBarShaking }"
          >
            <p class="text-xs font-medium whitespace-nowrap">{{ saveBar.label }}</p>
            <Button
              variant="secondary"
              size="sm"
              class="h-7 bg-zinc-700 text-white hover:bg-zinc-600"
              :disabled="saveBar.pending"
              @click="saveBar.onDiscard"
            >
              Annuler
            </Button>
            <Button
              size="sm"
              class="h-7 bg-white text-zinc-950 hover:bg-zinc-200"
              :disabled="saveBar.pending"
              @click="saveBar.onSave"
            >
              {{ saveBar.pending ? 'Enregistrement…' : 'Enregistrer' }}
            </Button>
          </div>
          <span class="hidden max-w-64 truncate text-sm text-zinc-300 sm:inline">{{ nomHeader }}</span>
          <Button
            variant="outline"
            size="sm"
            class="border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
            @click="onLogout"
          >
            Déconnexion
          </Button>
        </div>
      </div>
    </header>
    <main
      class="flex-1"
      :class="
        isAuthenticated
          ? `mx-auto min-h-[calc(100dvh-3.5rem)] w-full rounded-t-2xl bg-muted p-4 shadow-[0_-1px_0_rgba(255,255,255,0.08)] ${largeur}`
          : ''
      "
    >
      <RouterView />
    </main>
  </div>
  <Toaster position="top-center" rich-colors />
</template>

<style scoped>
.header-save-bar-shake {
  animation: header-save-bar-shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

@keyframes header-save-bar-shake {
  10%,
  90% {
    transform: translateX(-1px);
  }

  20%,
  80% {
    transform: translateX(2px);
  }

  30%,
  50%,
  70% {
    transform: translateX(-4px);
  }

  40%,
  60% {
    transform: translateX(4px);
  }
}
</style>
