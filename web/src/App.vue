<script setup lang="ts">
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useAuth } from '@/composables/useAuth'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'

const router = useRouter()
const { isAuthenticated, user, logout } = useAuth()

async function onLogout() {
  try {
    await logout()
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
      <div class="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
        <RouterLink to="/" class="text-sm font-semibold tracking-widest text-primary uppercase">
          GOA Kombucha
        </RouterLink>
        <div class="flex items-center gap-2">
          <span class="hidden text-sm text-muted-foreground sm:inline">{{ user?.email }}</span>
          <Button variant="outline" size="sm" @click="onLogout">Déconnexion</Button>
        </div>
      </div>
    </header>
    <main class="flex-1" :class="isAuthenticated ? 'mx-auto w-full max-w-3xl p-4' : ''">
      <RouterView />
    </main>
  </div>
  <Toaster position="top-center" rich-colors />
</template>
