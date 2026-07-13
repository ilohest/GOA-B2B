<script setup lang="ts">
/**
 * Page Aide de l'admin. Rend directement GUIDE-ADMIN.md (importé brut) : une
 * seule source de vérité, donc jamais désynchronisé du guide versionné.
 */
import { computed } from 'vue'
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
  const [avantFaq, apresTitreFaq = ''] = guideNettoye.value.split('## 9. Questions fréquentes')
  const [faqMarkdown, apresFaq = ''] = apresTitreFaq.split(/\n---\n/)
  return { avantFaq, faqMarkdown, apresFaq }
})

const htmlPrincipal = computed(() =>
  marked.parse(sectionsGuide.value.avantFaq, { async: false, gfm: true }) as string,
)

const htmlApresFaq = computed(() =>
  marked.parse(sectionsGuide.value.apresFaq.trim(), { async: false, gfm: true }) as string,
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
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <CardTitle class="flex items-center gap-2 text-lg">
          <CircleHelp class="size-5 text-muted-foreground" />
          Aide
        </CardTitle>
        <p class="text-xs text-muted-foreground">
          Guide v{{ metadata.version }}<template v-if="dateGuide"> · mis à jour le {{ dateGuide }}</template>
        </p>
      </div>
    </CardHeader>
    <CardContent class="pt-0 pb-6">
      <!-- Contenu de confiance (fichier du repo), pas de saisie utilisateur -->
      <div class="guide" v-html="htmlPrincipal" />

      <section v-if="questionsFrequentes.length" class="guide mt-7">
        <h2>9. Questions fréquentes</h2>
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
    </CardContent>
  </Card>
</template>

<style scoped>
.guide :deep(h1) {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0 0 0.75rem;
}
.guide :deep(h2) {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 1.75rem 0 0.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}
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
</style>
