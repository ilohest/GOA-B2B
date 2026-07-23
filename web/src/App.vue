<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { LogOut, Store } from '@lucide/vue'
import { useAuth } from '@/composables/useAuth'
import { useHeaderSaveBar } from '@/composables/useHeaderSaveBar'
import { useMe } from '@/composables/useMe'
import BrandLogo from '@/components/BrandLogo.vue'
import MobileSectionMenu from '@/components/navigation/MobileSectionMenu.vue'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { adminSections, clientSections } from '@/lib/navigation'

const router = useRouter()
const queryClient = useQueryClient()
const { isAuthenticated, user, logout } = useAuth()
const { data: me } = useMe()
const { saveBar, shakeTick, triggerSaveBarShake } = useHeaderSaveBar()
const saveBarShaking = ref(false)
const profilMobileOuvert = ref(false)
const menuProfilMobile = ref<HTMLElement | null>(null)
let saveBarShakeTimer: number | undefined

const estAdmin = computed(() => me.value?.user.role === 'admin')
const sectionsHeader = computed(() => (estAdmin.value ? adminSections : clientSections))
const nomHeader = computed(() => {
  if (me.value?.user.role === 'client') {
    return me.value.client?.nom ?? me.value.client?.raisonSociale ?? user.value?.email
  }
  return user.value?.email
})
const emailHeader = computed(() => user.value?.email ?? '')
const initialesHeader = computed(() => {
  const source = nomHeader.value || emailHeader.value || 'GOA'
  const morceaux = source
    .replace(/[@._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const lettres = morceaux.length >= 2 ? [morceaux[0][0], morceaux[1][0]] : source.slice(0, 2).split('')
  return lettres.join('').toUpperCase()
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

onClickOutside(menuProfilMobile, () => {
  profilMobileOuvert.value = false
})

useEventListener('keydown', (event) => {
  if (event.key === 'Escape') profilMobileOuvert.value = false
})

async function onLogout() {
  if (saveBar.value) {
    triggerSaveBarShake()
    return
  }

  try {
    profilMobileOuvert.value = false
    await logout()
    queryClient.clear()
    router.push({ name: 'login' })
  } catch {
    toast.error('Déconnexion impossible. Réessayez.')
  }
}

function ouvrirApercuBoutique() {
  profilMobileOuvert.value = false
  router.push({ name: 'admin-boutique-apercu' })
}
</script>

<template>
  <div class="flex min-h-dvh flex-col" :class="isAuthenticated ? 'bg-zinc-950' : 'bg-background'">
    <header
      v-if="isAuthenticated"
      class="sticky top-0 z-10 bg-zinc-950 text-white"
    >
      <div class="mx-auto flex h-14 w-full items-center justify-between gap-3 px-4" :class="largeur">
        <div class="flex min-w-0 items-center gap-2">
          <MobileSectionMenu :label="estAdmin ? 'Sections admin' : 'Espace client'" :sections="sectionsHeader" />
          <RouterLink :to="estAdmin ? '/admin' : '/'" class="flex min-w-0 items-center gap-2">
            <BrandLogo variante="rond" />
            <span class="hidden text-sm font-semibold tracking-widest text-white uppercase sm:inline">
              GOA B2B
            </span>
          </RouterLink>
        </div>
        <div class="flex items-center gap-2">
          <div
            v-if="saveBar"
            class="hidden items-center gap-2 rounded-xl border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-white shadow-sm md:flex"
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
            v-if="estAdmin"
            variant="outline"
            size="sm"
            class="hidden border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white sm:inline-flex"
            @click="ouvrirApercuBoutique"
          >
            <Store class="size-4" />
            Voir la boutique
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="hidden border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white sm:inline-flex"
            @click="onLogout"
          >
            Déconnexion
          </Button>
          <div ref="menuProfilMobile" class="relative sm:hidden">
            <button
              type="button"
              class="grid size-9 place-items-center rounded-full border border-white/15 bg-primary text-xs font-semibold text-primary-foreground shadow-sm ring-1 ring-white/10 transition hover:bg-primary/90"
              :aria-expanded="profilMobileOuvert"
              aria-label="Ouvrir le profil"
              @click="profilMobileOuvert = !profilMobileOuvert"
            >
              {{ initialesHeader }}
            </button>
            <div
              v-if="profilMobileOuvert"
              class="absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-xl"
            >
              <div class="border-b bg-zinc-50 px-4 py-3">
                <p class="truncate text-sm font-semibold">{{ nomHeader }}</p>
                <p v-if="emailHeader" class="truncate text-xs text-zinc-500">{{ emailHeader }}</p>
              </div>
              <button
                v-if="estAdmin"
                type="button"
                class="flex w-full items-center gap-2 border-b px-4 py-3 text-left text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
                @click="ouvrirApercuBoutique"
              >
                <Store class="size-4 text-zinc-500" />
                Voir la boutique
              </button>
              <button
                type="button"
                class="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
                @click="onLogout"
              >
                <LogOut class="size-4 text-zinc-500" />
                Déconnexion
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
    <main
      class="flex-1"
      :class="
        isAuthenticated
          ? `mx-auto min-h-[calc(100dvh-3.5rem)] w-full rounded-t-2xl bg-muted p-4 shadow-[0_-1px_0_rgba(255,255,255,0.08)] ${saveBar ? 'pb-24 md:pb-4' : ''} ${largeur}`
          : ''
      "
    >
      <RouterView />
    </main>
    <div
      v-if="isAuthenticated && saveBar"
      class="fixed inset-x-3 bottom-3 z-40 grid gap-2 rounded-2xl border border-zinc-700 bg-zinc-800 p-3 text-white shadow-2xl md:hidden"
      :class="{ 'header-save-bar-shake': saveBarShaking }"
    >
      <p class="text-sm font-medium">{{ saveBar.label }}</p>
      <div class="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          size="sm"
          class="h-9 bg-zinc-700 text-white hover:bg-zinc-600"
          :disabled="saveBar.pending"
          @click="saveBar.onDiscard"
        >
          Annuler
        </Button>
        <Button
          size="sm"
          class="h-9 bg-white text-zinc-950 hover:bg-zinc-200"
          :disabled="saveBar.pending"
          @click="saveBar.onSave"
        >
          {{ saveBar.pending ? 'Enregistrement…' : 'Enregistrer' }}
        </Button>
      </div>
    </div>
  </div>
  <Toaster position="bottom-right" rich-colors />
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
