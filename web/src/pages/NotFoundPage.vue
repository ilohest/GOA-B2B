<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ArrowLeft, LayoutDashboard, LogIn, ShoppingBag } from "@lucide/vue";
import { useAuth } from "@/composables/useAuth";
import { useMe } from "@/composables/useMe";
import BrandLogo from "@/components/BrandLogo.vue";
import { Button } from "@/components/ui/button";

const router = useRouter();
const { isAuthenticated } = useAuth();
const { data: me } = useMe();

const accueil = computed(() => {
  if (!isAuthenticated.value) {
    return { to: "/login", label: "Se connecter", icon: LogIn };
  }
  if (me.value?.user.role === "admin") {
    return { to: "/admin", label: "Retour au tableau de bord", icon: LayoutDashboard };
  }
  return { to: "/", label: "Retour à la boutique", icon: ShoppingBag };
});
</script>

<template>
  <section
    class="relative isolate grid place-items-center overflow-hidden rounded-2xl bg-card px-6 py-16 ring-1 ring-foreground/10"
    :class="isAuthenticated ? 'min-h-[calc(100dvh-5.5rem)]' : 'min-h-dvh rounded-none ring-0'"
  >
    <div
      class="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/10 blur-3xl"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute -bottom-36 -left-24 size-96 rounded-full bg-brand-50 blur-3xl"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute top-[18%] left-[12%] size-4 rounded-full border border-primary/20"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute right-[15%] bottom-[22%] size-7 rounded-full border border-primary/15"
      aria-hidden="true"
    />

    <div class="relative grid max-w-xl justify-items-center text-center">
      <BrandLogo variante="complet" class="mb-8" />

      <div class="relative grid place-items-center">
        <p
          class="select-none text-[clamp(7rem,25vw,13rem)] font-bold leading-[0.75] tracking-[-0.08em] text-primary/10"
          aria-hidden="true"
        >
          404
        </p>
        <div class="absolute grid justify-items-center gap-3">
          <span
            class="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold tracking-wide text-primary uppercase"
          >
            Page introuvable
          </span>
        </div>
      </div>

      <h1 class="mt-8 text-2xl font-semibold tracking-tight sm:text-3xl">
        Cette page a perdu ses bulles.
      </h1>
      <p class="mt-3 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
        L’adresse est peut-être incorrecte ou la page a été déplacée. Votre
        espace GOA, lui, est toujours bien au frais.
      </p>

      <div class="mt-8 flex flex-wrap justify-center gap-2">
        <Button as-child size="lg">
          <RouterLink :to="accueil.to">
            <component :is="accueil.icon" aria-hidden="true" />
            {{ accueil.label }}
          </RouterLink>
        </Button>
        <Button type="button" variant="outline" size="lg" @click="router.back()">
          <ArrowLeft aria-hidden="true" />
          Page précédente
        </Button>
      </div>
    </div>
  </section>
</template>
