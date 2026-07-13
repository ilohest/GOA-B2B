import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Le front ne parle qu'au backend Node local (qui détient les secrets Easybeer
// et relaie vers l'API Easybeer). Aucun identifiant Easybeer côté navigateur.
export default defineConfig(() => {
  const backend = process.env.BACKEND_URL || 'http://localhost:8788'
  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: Number(process.env.PORT) || 5173,
      // Autorise l'import brut de GUIDE-ADMIN.md (à la racine du repo) par la page Aide.
      fs: { allow: ['..'] },
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
        },
      },
    },
  }
})
