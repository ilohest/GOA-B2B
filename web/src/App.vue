<script setup lang="ts">
import ClientsTest from './components/ClientsTest.vue'
import CommandeTest from './components/CommandeTest.vue'
</script>

<template>
  <main>
    <h1>POC B2B Kombucha × Easybeer</h1>
    <p class="sub">Phase 2 — liste des clients · Phase 3 — injection d'une commande de test.</p>
    <ClientsTest />
    <hr />
    <CommandeTest />
  </main>
</template>

<style>
body {
  margin: 0;
  background: #fafaf9;
}
main {
  padding: 2rem 1rem;
}
h1 {
  font-family: system-ui, sans-serif;
  text-align: center;
  color: #422006;
}
.sub {
  text-align: center;
  color: #78716c;
  font-family: system-ui, sans-serif;
  font-size: 0.9rem;
  margin-top: -0.5rem;
}
hr {
  max-width: 1000px;
  margin: 2rem auto;
  border: none;
  border-top: 1px solid #e7e5e4;
}
</style>
