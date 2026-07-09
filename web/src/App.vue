<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { useAuth } from '@/composables/useAuth'
import { useMe } from '@/composables/useMe'
import BrandLogo from '@/components/BrandLogo.vue'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'

const router = useRouter()
const queryClient = useQueryClient()
const { isAuthenticated, user, logout } = useAuth()
const { data: me } = useMe()

const estAdmin = computed(() => me.value?.user.role === 'admin')

// Largeur unifiée : client et admin ont chacun leur sidebar + colonnes.
const largeur = 'max-w-7xl'

async function onLogout() {
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
  <div class="flex min-h-dvh flex-col">
    <header
      v-if="isAuthenticated"
      class="sticky top-0 z-10 border-b bg-background/80 backdrop-blur"
    >
      <div class="mx-auto flex h-14 w-full items-center justify-between gap-3 px-4" :class="largeur">
        <RouterLink :to="estAdmin ? '/admin' : '/'" class="flex items-center gap-2">
          <BrandLogo variante="rond" />
          <span class="hidden text-sm font-semibold tracking-widest text-primary uppercase sm:inline">
            GOA B2B
          </span>
        </RouterLink>
        <div class="flex items-center gap-2">
          <span class="hidden text-sm text-muted-foreground sm:inline">{{ user?.email }}</span>
          <Button variant="outline" size="sm" @click="onLogout">Déconnexion</Button>
        </div>
      </div>
    </header>
    <main class="flex-1" :class="isAuthenticated ? `mx-auto w-full p-4 ${largeur}` : ''">
      <RouterView />
    </main>
  </div>
  <Toaster position="top-center" rich-colors />
</template>
