<script setup lang="ts">
import {
  Building2,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from '@lucide/vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
</script>

<template>
  <div class="grid gap-4">
    <section
      class="relative isolate min-h-72 overflow-hidden rounded-2xl border border-emerald-950/10 bg-emerald-950 text-white shadow-sm"
      aria-labelledby="titre-contact"
    >
      <img
        src="/produits/orange-sanguine.webp"
        alt=""
        class="absolute inset-0 -z-20 size-full object-cover object-center opacity-55"
      />
      <div
        class="absolute inset-0 -z-10 bg-gradient-to-r from-emerald-950 via-emerald-950/90 to-emerald-950/45"
      />
      <div class="grid min-h-72 content-center gap-5 p-6 sm:p-8 lg:max-w-3xl lg:p-10">
        <div class="grid gap-3">
          <p
            class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200"
          >
            <MessageCircle class="size-4" aria-hidden="true" />
            L’équipe GOA vous répond
          </p>
          <h1 id="titre-contact" class="max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
            Une question, un avis, un partenariat&nbsp;?
          </h1>
          <p class="max-w-2xl text-sm leading-relaxed text-emerald-50/80 sm:text-base">
            Besoin d’un conseil sur la gamme, votre commande ou les formats
            adaptés à votre établissement&nbsp;? Échangez directement avec la
            Brasserie de GOA.
          </p>
        </div>
        <a
          href="mailto:contact@goa-kombucha.fr"
          class="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-emerald-950 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-950"
        >
          <Mail class="size-4" aria-hidden="true" />
          Écrire à GOA
        </a>
      </div>
    </section>

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">Nous contacter</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="divide-y">
            <a
              href="mailto:contact@goa-kombucha.fr"
              class="group flex items-start gap-3 py-4 first:pt-0 last:pb-0"
            >
              <span
                class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
              >
                <Mail class="size-4.5" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  E-mail
                </span>
                <span class="mt-1 block break-all text-sm font-medium sm:text-base">
                  contact@goa-kombucha.fr
                </span>
                <span class="mt-1 block text-xs text-muted-foreground">
                  Commandes, gamme, distribution et partenariats
                </span>
              </span>
              <ExternalLink class="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>

            <a
              href="tel:+33665409335"
              class="group flex items-start gap-3 py-4 first:pt-0 last:pb-0"
            >
              <span
                class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
              >
                <Phone class="size-4.5" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Téléphone
                </span>
                <span class="mt-1 block text-sm font-medium sm:text-base">06 65 40 93 35</span>
              </span>
              <ExternalLink class="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>

            <a
              href="https://www.google.com/maps/search/?api=1&query=390+Route+du+Vieux+Four+24590+Saint-Geni%C3%A8s"
              target="_blank"
              rel="noreferrer"
              class="group flex items-start gap-3 py-4 first:pt-0 last:pb-0"
            >
              <span
                class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
              >
                <MapPin class="size-4.5" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  La brasserie
                </span>
                <span class="mt-1 block text-sm font-medium leading-relaxed sm:text-base">
                  390 route du Vieux Four<br />24590 Saint-Geniès
                </span>
              </span>
              <ExternalLink class="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>
          </div>
        </CardContent>
      </Card>

      <div class="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle class="text-lg">Suivre GOA</CardTitle>
          </CardHeader>
          <CardContent class="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <a
              href="https://www.instagram.com/goa_kombucha/"
              target="_blank"
              rel="noreferrer"
              class="flex min-h-12 items-center gap-3 rounded-xl border bg-background px-3 py-2.5 text-sm font-medium transition hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5 fill-none stroke-current" stroke-width="1.8">
                <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.4" cy="6.7" r="1" class="fill-current stroke-none" />
              </svg>
              Instagram
              <ExternalLink class="ml-auto size-3.5 text-muted-foreground" aria-hidden="true" />
            </a>
            <a
              href="https://www.facebook.com/profile.php?id=100091694510541"
              target="_blank"
              rel="noreferrer"
              class="flex min-h-12 items-center gap-3 rounded-xl border bg-background px-3 py-2.5 text-sm font-medium transition hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5 fill-current">
                <path d="M13.5 21v-8h2.8l.42-3.15H13.5V7.84c0-.91.26-1.53 1.62-1.53h1.73V3.5a23 23 0 0 0-2.52-.13c-2.5 0-4.2 1.49-4.2 4.23v2.25H7.3V13h2.83v8h3.37Z" />
              </svg>
              Facebook
              <ExternalLink class="ml-auto size-3.5 text-muted-foreground" aria-hidden="true" />
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="flex items-center gap-2 text-lg">
              <Building2 class="size-5 text-muted-foreground" aria-hidden="true" />
              Informations légales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl class="grid gap-3 text-sm">
              <div class="grid gap-1 sm:grid-cols-[8rem_1fr] xl:grid-cols-1 2xl:grid-cols-[8rem_1fr]">
                <dt class="text-muted-foreground">Entreprise</dt>
                <dd class="font-medium">La Brasserie de GOA</dd>
              </div>
              <div class="grid gap-1 sm:grid-cols-[8rem_1fr] xl:grid-cols-1 2xl:grid-cols-[8rem_1fr]">
                <dt class="text-muted-foreground">SIREN</dt>
                <dd class="font-medium tabular-nums">951 169 259</dd>
              </div>
              <div class="grid gap-1 sm:grid-cols-[8rem_1fr] xl:grid-cols-1 2xl:grid-cols-[8rem_1fr]">
                <dt class="text-muted-foreground">N° de TVA</dt>
                <dd class="font-medium tabular-nums">FR07951169259</dd>
              </div>
              <div class="grid gap-1 sm:grid-cols-[8rem_1fr] xl:grid-cols-1 2xl:grid-cols-[8rem_1fr]">
                <dt class="text-muted-foreground">Site officiel</dt>
                <dd>
                  <a
                    href="https://www.goa-kombucha.fr/"
                    target="_blank"
                    rel="noreferrer"
                    class="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                  >
                    goa-kombucha.fr
                    <ExternalLink class="size-3.5" aria-hidden="true" />
                  </a>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  a {
    transition: none;
  }
}
</style>
