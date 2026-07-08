import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Le front ne parle qu'au backend Node local (qui détient les secrets Easybeer
// et relaie vers l'API Easybeer). Aucun identifiant Easybeer côté navigateur.
export default defineConfig(() => {
  const backend = process.env.BACKEND_URL || 'http://localhost:8787'
  return {
    plugins: [vue(), tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
        },
      },
    },
  }
})
