<script setup lang="ts">
import { MailIcon } from "@lucide/vue";
</script>

<template>
  <aside
    class="auth-brand-panel relative hidden min-h-[46rem] bg-emerald-950 text-white lg:flex"
    aria-label="L'univers GOA Kombucha"
  >
    <img
      src="/produits/orange-sanguine.webp"
      alt=""
      class="absolute inset-0 h-full w-full object-cover object-center opacity-75"
    />
    <div
      class="absolute inset-0 bg-gradient-to-t from-emerald-950 via-emerald-950/75 to-emerald-900/20"
    />
    <div
      class="absolute -right-24 -top-24 size-72 rounded-full bg-amber-300/20 blur-3xl"
      aria-hidden="true"
    />
    <div
      class="absolute -bottom-32 -left-20 size-80 rounded-full bg-emerald-400/20 blur-3xl"
      aria-hidden="true"
    />
    <div
      class="relative z-10 flex w-full flex-col justify-between p-10 xl:p-14"
    >
      <nav
        class="flex justify-end gap-2"
        aria-label="Réseaux sociaux GOA Kombucha"
      >
        <a
          href="https://www.facebook.com/profile.php?id=100091694510541"
          target="_blank"
          rel="noreferrer"
          class="reseau-lien grid size-9 place-items-center rounded-full border border-white/20 bg-white/10 text-white/80 backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/20 hover:text-white"
          aria-label="GOA Kombucha sur Facebook"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            class="size-4 fill-current"
          >
            <path
              d="M13.5 21v-8h2.8l.42-3.15H13.5V7.84c0-.91.26-1.53 1.62-1.53h1.73V3.5a23 23 0 0 0-2.52-.13c-2.5 0-4.2 1.49-4.2 4.23v2.25H7.3V13h2.83v8h3.37Z"
            />
          </svg>
        </a>
        <a
          href="https://www.instagram.com/goa_kombucha/"
          target="_blank"
          rel="noreferrer"
          class="reseau-lien grid size-9 place-items-center rounded-full border border-white/20 bg-white/10 text-white/80 backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/20 hover:text-white"
          aria-label="GOA Kombucha sur Instagram"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            class="size-4 fill-none stroke-current"
            stroke-width="1.8"
          >
            <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.4" cy="6.7" r="1" class="fill-current stroke-none" />
          </svg>
        </a>
      </nav>

      <div class="max-w-xl">
        <p
          class="mb-5 text-sm font-medium uppercase tracking-[0.18em] text-emerald-200"
        >
          Sain · Savoureux · Artisanal
        </p>
        <h2
          class="max-w-lg text-4xl font-semibold leading-[1.05] tracking-tight text-white xl:text-5xl"
        >
          Offrez la fraîcheur vivante du kombucha à vos clients.
        </h2>
        <p class="mt-5 max-w-lg text-base leading-relaxed text-emerald-50/80">
          Une alternative artisanale aux sodas industriels, élaborée au cœur du
          Périgord pour votre établissement.
        </p>

        <div class="mt-8 h-px max-w-lg bg-white/20" aria-hidden="true" />

        <p
          class="mt-6 text-xs font-medium uppercase tracking-[0.14em] text-emerald-100/70"
        >
          Quelques saveurs de notre gamme
        </p>
        <div
          class="mt-3 flex flex-wrap gap-2"
          aria-label="Exemples de saveurs GOA"
        >
          <span class="saveur-verre saveur-citron">Citron Gingembre</span>
          <span class="saveur-verre saveur-framboise">Framboise Hibiscus</span>
          <span class="saveur-verre saveur-orange"> Orange Sanguine </span>
          <span class="saveur-verre saveur-autres">Et bien d’autres…</span>
        </div>

        <div class="mt-8 border-t border-white/20 pt-6">
          <p class="text-sm text-emerald-50/75">
            Une question, un avis, un partenariat&nbsp;?
          </p>
          <a
            href="mailto:contact@goa-kombucha.fr"
            class="mt-2 inline-flex items-center gap-2 text-sm font-medium text-white transition-colors hover:text-emerald-200"
          >
            <MailIcon class="size-4" aria-hidden="true" />
            contact@goa-kombucha.fr
          </a>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.auth-brand-panel::after {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(115deg, transparent 45%, rgb(255 255 255 / 6%));
  content: "";
  pointer-events: none;
}

.saveur-verre {
  border: 1px solid rgb(255 255 255 / 24%);
  border-radius: 9999px;
  padding: 0.4rem 0.8rem;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 22%),
    0 6px 18px rgb(0 0 0 / 10%);
  color: white;
  font-size: 0.75rem;
  line-height: 1rem;
  backdrop-filter: blur(14px) saturate(130%);
}

.saveur-citron {
  background: linear-gradient(
    135deg,
    rgb(250 204 21 / 24%),
    rgb(255 255 255 / 8%)
  );
}

.saveur-framboise {
  background: linear-gradient(
    135deg,
    rgb(244 63 94 / 25%),
    rgb(255 255 255 / 8%)
  );
}

.saveur-orange {
  background: linear-gradient(
    135deg,
    rgb(249 115 22 / 27%),
    rgb(255 255 255 / 8%)
  );
}

.saveur-autres {
  background: linear-gradient(
    135deg,
    rgb(52 211 153 / 22%),
    rgb(255 255 255 / 8%)
  );
}

@media (prefers-reduced-motion: reduce) {
  .reseau-lien {
    transition: none;
  }
}
</style>
