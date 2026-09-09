<script setup lang="ts">
/**
 * Page Aide de l'admin. Rend directement GUIDE-ADMIN.md (importé brut) : une
 * seule source de vérité, donc jamais désynchronisé du guide versionné.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronDown, CircleHelp } from '@lucide/vue'
import { marked } from 'marked'
import guide from '../../../../GUIDE-ADMIN.md?raw'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const metadata = computed(() => ({
  version: guide.match(/<!--\s*guide-version:\s*(.*?)\s*-->/)?.[1] ?? '1.0',
  updatedAt: guide.match(/<!--\s*guide-updated-at:\s*(.*?)\s*-->/)?.[1] ?? null,
}))

const dateGuide = computed(() => {
  if (!metadata.value.updatedAt) return null
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(metadata.value.updatedAt))
})

const guideNettoye = computed(() =>
  guide
    .replace(/<!--\s*guide-version:.*?-->\s*/g, '')
    .replace(/<!--\s*guide-updated-at:.*?-->\s*/g, '')
    .replace(/^# .*(\r?\n)+/, ''),
)

const sectionsGuide = computed(() => {
  const match = guideNettoye.value.match(/^##\s+\d+\.\s+Questions fréquentes\s*$/m)
  if (!match?.index) return { avantFaq: guideNettoye.value, faqTitre: 'Questions fréquentes', faqMarkdown: '', apresFaq: '' }

  const avantFaq = guideNettoye.value.slice(0, match.index)
  const apresTitreFaq = guideNettoye.value.slice(match.index + match[0].length)
  const prochaineSection = apresTitreFaq.match(/\n##\s+\d+\.\s+/)
  const faqMarkdown = prochaineSection?.index != null ? apresTitreFaq.slice(0, prochaineSection.index) : apresTitreFaq
  const apresFaq = prochaineSection?.index != null ? apresTitreFaq.slice(prochaineSection.index).trim() : ''
  return { avantFaq, faqTitre: match[0].replace(/^##\s+/, ''), faqMarkdown, apresFaq }
})

/** Identifiant d'ancre stable, dérivé du titre affiché. */
function identifiantSection(titre: string): string {
  return (
    'section-' +
    titre
      .replace(/<[^>]+>/g, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  )
}

/** Les titres rendus par marked n'ont pas d'ancre : on les pose ici. */
function avecAncres(html: string): string {
  return html.replace(
    /<h2>([\s\S]*?)<\/h2>/g,
    (_, contenu: string) => `<h2 id="${identifiantSection(contenu)}">${contenu}</h2>`,
  )
}

const sections = computed(() =>
  [...guideNettoye.value.matchAll(/^##\s+(\d+)\.\s+(.+?)\s*$/gm)].map(([, numero, titre]) => ({
    numero,
    titre,
    id: identifiantSection(`${numero}. ${titre}`),
  })),
)

const sectionActive = ref<string | null>(null)

/**
 * Le sommaire suit la lecture : sans repère, un guide de douze sections ne
 * dit plus où l'on se trouve. On retient le dernier titre passé sous la
 * barre supérieure plutôt que le premier visible, qui sauterait en arrière
 * dès qu'une section longue occupe tout l'écran.
 */
function actualiserSectionActive() {
  const titres = Array.from(document.querySelectorAll<HTMLElement>('.guide h2[id]'))
  if (!titres.length) return
  const seuil = 96
  let courant = titres[0]
  for (const titre of titres) {
    if (titre.getBoundingClientRect().top <= seuil) courant = titre
  }
  // En bas de page, la dernière section peut ne jamais franchir le seuil.
  if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
    courant = titres[titres.length - 1]
  }
  sectionActive.value = courant.id
}

let planifie = 0
function surDefilement() {
  if (planifie) return
  planifie = requestAnimationFrame(() => {
    planifie = 0
    actualiserSectionActive()
  })
}

onMounted(() => {
  actualiserSectionActive()
  window.addEventListener('scroll', surDefilement, { passive: true })
  window.addEventListener('resize', surDefilement, { passive: true })
})
onBeforeUnmount(() => {
  if (planifie) cancelAnimationFrame(planifie)
  window.removeEventListener('scroll', surDefilement)
  window.removeEventListener('resize', surDefilement)
})

const htmlPrincipal = computed(() =>
  avecAncres(marked.parse(sectionsGuide.value.avantFaq, { async: false, gfm: true }) as string),
)

const htmlApresFaq = computed(() =>
  avecAncres(marked.parse(sectionsGuide.value.apresFaq.trim(), { async: false, gfm: true }) as string),
)

const questionsFrequentes = computed(() =>
  [...sectionsGuide.value.faqMarkdown.matchAll(/\*\*(.*?)\*\*\s*\n→\s*([\s\S]*?)(?=\n\n\*\*|$)/g)].map(
    ([, question, reponse]) => ({
      question: question.trim(),
      reponse: marked.parse(reponse.trim(), { async: false, gfm: true }) as string,
    }),
  ),
)
</script>

<template>
  <!-- overflow-visible : le `overflow-hidden` de Card neutraliserait le
       `position: sticky` du sommaire. -->
  <Card class="overflow-visible">
    <CardHeader>
      <div class="grid gap-3 sm:flex sm:items-start sm:justify-between">
        <div class="min-w-0">
          <CardTitle class="flex items-center gap-2 text-lg">
            <CircleHelp class="size-5 text-muted-foreground" />
            Aide
          </CardTitle>
        </div>
        <div class="grid justify-items-start gap-2 sm:justify-items-end">
          <p class="text-xs text-muted-foreground">
            Guide v{{ metadata.version }}<template v-if="dateGuide"> · mis à jour le {{ dateGuide }}</template>
          </p>
        </div>
      </div>
    </CardHeader>
    <CardContent class="grid gap-6 pt-0 pb-6 xl:grid-cols-[minmax(0,1fr)_15rem] xl:gap-10">
      <div class="min-w-0">
      <!-- Sommaire replié tant que la largeur ne permet pas la colonne latérale. -->
      <details v-if="sections.length" class="mb-6 rounded-lg border bg-muted/20 xl:hidden">
        <summary class="cursor-pointer list-none px-3 py-2 text-sm font-medium">
          Sommaire · {{ sections.length }} sections
        </summary>
        <ol class="grid gap-0.5 border-t px-3 py-2">
          <li v-for="section in sections" :key="section.id">
            <a
              :href="`#${section.id}`"
              class="flex gap-2 rounded-md px-1 py-1 text-sm transition-colors hover:text-foreground"
              :class="sectionActive === section.id ? 'font-medium text-foreground' : 'text-muted-foreground'"
            >
              <span class="tabular-nums opacity-60">{{ section.numero }}</span>
              <span>{{ section.titre }}</span>
            </a>
          </li>
        </ol>
      </details>

      <!-- Contenu de confiance (fichier du repo), pas de saisie utilisateur -->
      <div class="guide" v-html="htmlPrincipal" />

      <section v-if="questionsFrequentes.length" class="guide mt-7">
        <h2 :id="identifiantSection(sectionsGuide.faqTitre)">{{ sectionsGuide.faqTitre }}</h2>
        <div class="grid gap-2">
          <details
            v-for="item in questionsFrequentes"
            :key="item.question"
            class="group rounded-lg border bg-background"
          >
            <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span>{{ item.question }}</span>
              <ChevronDown class="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div class="border-t px-4 py-3 text-sm">
              <div class="guide" v-html="item.reponse" />
            </div>
          </details>
        </div>
      </section>

      <div v-if="htmlApresFaq" class="guide mt-6" v-html="htmlApresFaq" />
      </div>

      <nav v-if="sections.length" class="hidden xl:block" aria-label="Sommaire du guide">
        <div class="sticky top-20 grid gap-2">
          <p class="text-[0.7rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            Sommaire
          </p>
          <ol class="grid gap-0.5 border-l">
            <li v-for="section in sections" :key="section.id">
              <a
                :href="`#${section.id}`"
                class="-ml-px flex gap-2 border-l-2 py-1 pl-3 text-sm leading-snug transition-colors"
                :class="
                  sectionActive === section.id
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                "
                :aria-current="sectionActive === section.id ? 'true' : undefined"
              >
                <span class="tabular-nums opacity-60">{{ section.numero }}</span>
                <span>{{ section.titre }}</span>
              </a>
            </li>
          </ol>
        </div>
      </nav>
    </CardContent>
  </Card>
</template>

<style scoped>
.guide :deep(h1) {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0 0 0.75rem;
}
.guide h2,
.guide :deep(h2) {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 1.75rem 0 0.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}
.guide h2:first-of-type,
.guide :deep(h2:first-of-type) {
  border-top: none;
  padding-top: 0;
}
.guide :deep(h3) {
  font-size: 1rem;
  font-weight: 600;
  margin: 1.25rem 0 0.4rem;
}
.guide :deep(p) {
  margin: 0.5rem 0;
  line-height: 1.65;
  color: var(--foreground);
}
.guide :deep(ul),
.guide :deep(ol) {
  margin: 0.5rem 0;
  padding-left: 1.4rem;
  line-height: 1.6;
}
.guide :deep(ul) {
  list-style: disc;
}
.guide :deep(ol) {
  list-style: decimal;
}
.guide :deep(li) {
  margin: 0.3rem 0;
}
.guide :deep(li::marker) {
  color: var(--muted-foreground);
}
.guide :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}
.guide :deep(strong) {
  font-weight: 600;
}
.guide :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
  background: var(--muted);
  padding: 0.1em 0.35em;
  border-radius: 0.3rem;
}
.guide :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5rem 0;
}
.guide :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 0.9rem;
  display: block;
  overflow-x: auto;
}
.guide :deep(th),
.guide :deep(td) {
  border: 1px solid var(--border);
  padding: 0.5rem 0.75rem;
  text-align: left;
  vertical-align: top;
}
.guide :deep(th) {
  background: var(--muted);
  font-weight: 600;
}
.guide :deep(em) {
  color: var(--muted-foreground);
}
.guide :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.75rem 0 1rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}
.guide :deep(.exemple-remises-images) {
  display: grid;
  gap: 1rem;
  max-width: 75rem;
  margin: 0.75rem auto 1rem;
  align-items: start;
}
.guide :deep(.exemple-remises-images figure) {
  min-width: 0;
  margin: 0;
}
.guide :deep(.exemple-remises-images figure:last-child) {
  width: min(100%, 18rem);
  justify-self: center;
}
.guide :deep(.exemple-remises-images img) {
  width: 100%;
  margin: 0;
}
.guide :deep(.exemple-remises-images figcaption) {
  margin-top: 0.4rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  text-align: center;
}
@media (min-width: 768px) {
  .guide :deep(.exemple-remises-images) {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  }
}
</style>
