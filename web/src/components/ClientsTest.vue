<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  listeClients,
  type ModeleClient,
} from '../services/easybeerService'

const clients = ref<ModeleClient[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)

async function charger() {
  loading.value = true
  error.value = null
  try {
    const res = await listeClients(
      {}, // filtre vide => tous les clients
      { colonneTri: 'nom', numeroPage: 1, nombreParPage: 25 },
    )
    clients.value = res.liste ?? []
    total.value = res.totalElements ?? clients.value.length
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function ville(c: ModeleClient): string {
  const a = c.adresse
  if (!a) return ''
  return [a.codePostal, a.ville].filter(Boolean).join(' ')
}

onMounted(charger)
</script>

<template>
  <section class="clients-test">
    <header>
      <h2>Clients Easybeer</h2>
      <button :disabled="loading" @click="charger">↻ Rafraîchir</button>
    </header>

    <p v-if="loading" class="state">Chargement des clients…</p>

    <p v-else-if="error" class="state error">
      ❌ {{ error }}
      <br />
      <small>
        Vérifiez vos identifiants dans <code>.env.local</code> puis redémarrez
        <code>npm run dev</code> (un 401 = identifiants invalides).
      </small>
    </p>

    <template v-else>
      <p class="state">{{ total }} client(s) — {{ clients.length }} affiché(s)</p>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Numéro</th>
            <th>Nom</th>
            <th>Raison sociale</th>
            <th>Email</th>
            <th>Téléphone</th>
            <th>Ville</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in clients" :key="c.idClient ?? c.numero">
            <td>{{ c.idClient }}</td>
            <td>{{ c.numero }}</td>
            <td>{{ c.nom }}</td>
            <td>{{ c.raisonSociale }}</td>
            <td>{{ c.emailPrincipal }}</td>
            <td>{{ c.telephonePrincipal }}</td>
            <td>{{ ville(c) }}</td>
          </tr>
          <tr v-if="clients.length === 0">
            <td colspan="7" class="empty">Aucun client retourné.</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.clients-test {
  font-family: system-ui, sans-serif;
  max-width: 1000px;
  margin: 2rem auto;
  color: #1c1917;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}
h2 {
  margin: 0;
}
button {
  border: 1px solid #d6d3d1;
  background: #fff;
  border-radius: 8px;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.state {
  color: #57534e;
  font-size: 0.9rem;
}
.error {
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 0.75rem 1rem;
  border-radius: 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
th,
td {
  text-align: left;
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid #e7e5e4;
}
th {
  background: #fafaf9;
  font-weight: 600;
}
tbody tr:hover {
  background: #f5f5f4;
}
.empty {
  text-align: center;
  color: #a8a29e;
  padding: 1.5rem;
}
</style>
