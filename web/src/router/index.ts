import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useHeaderSaveBar } from '@/composables/useHeaderSaveBar'
import { api } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import type { MeResponse } from '@/lib/types'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to) {
    if (to.hash) {
      return { el: to.hash, top: 80, behavior: 'smooth' }
    }
    return { top: 0 }
  },
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { public: true },
    },
    {
      path: '/activer',
      name: 'activer',
      component: () => import('@/pages/ActivationPage.vue'),
      meta: { public: true },
    },
    {
      path: '/reinitialiser-mot-de-passe',
      name: 'reinitialiser-mot-de-passe',
      component: () => import('@/pages/ResetPasswordPage.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/ClientLayout.vue'),
      meta: { role: 'client' },
      children: [
        {
          path: '',
          name: 'boutique',
          component: () => import('@/pages/HomePage.vue'),
        },
        {
          path: 'commandes',
          name: 'commandes',
          component: () => import('@/pages/CommandesPage.vue'),
        },
        {
          path: 'confirmer-commande',
          name: 'confirmation-commande',
          component: () => import('@/pages/CommandeConfirmationPage.vue'),
        },
        {
          path: 'compte',
          name: 'compte',
          component: () => import('@/pages/ComptePage.vue'),
        },
        {
          path: 'contact',
          name: 'contact',
          component: () => import('@/pages/ContactPage.vue'),
        },
      ],
    },
    {
      path: '/admin',
      component: () => import('@/layouts/AdminLayout.vue'),
      meta: { role: 'admin' },
      children: [
        {
          path: '',
          name: 'admin-dashboard',
          component: () => import('@/pages/admin/AdminDashboardPage.vue'),
        },
        {
          path: 'clients',
          name: 'admin-clients',
          component: () => import('@/pages/admin/AdminClientsPage.vue'),
        },
        {
          path: 'clients/:id(\\d+)',
          name: 'admin-client',
          component: () => import('@/pages/admin/AdminClientDetailPage.vue'),
        },
        {
          path: 'commandes',
          name: 'admin-commandes',
          component: () => import('@/pages/admin/AdminCommandesPage.vue'),
        },
        {
          path: 'catalogue',
          name: 'admin-catalogue',
          component: () => import('@/pages/admin/AdminCataloguePage.vue'),
        },
        {
          path: 'aide',
          name: 'admin-aide',
          component: () => import('@/pages/admin/AidePage.vue'),
        },
      ],
    },
    {
      path: '/apercu-boutique',
      name: 'admin-boutique-apercu',
      component: () => import('@/pages/HomePage.vue'),
      meta: { role: 'admin' },
    },
    {
      path: '/apercu-boutique/confirmer',
      name: 'admin-boutique-confirmation',
      component: () => import('@/pages/CommandeConfirmationPage.vue'),
      meta: { role: 'admin' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/pages/NotFoundPage.vue'),
      meta: { public: true },
    },
  ],
})

// Toute route est privée sauf meta.public. On attend la restauration de la
// session Firebase avant de rediriger (sinon faux négatif au rechargement).
router.beforeEach(async (to, from) => {
  const { saveBar, triggerSaveBarShake } = useHeaderSaveBar()
  if (saveBar.value && to.fullPath !== from.fullPath) {
    triggerSaveBarShake()
    return false
  }

  // La page de connexion est publique uniquement tant qu'aucune session n'est
  // active. On attend Firebase afin d'éviter d'afficher brièvement le formulaire
  // pendant la restauration de session. Exception : un lien de connexion doit
  // pouvoir être finalisé même si une autre session existe déjà dans le navigateur.
  if (to.name === 'login') {
    const { waitForAuth, isAuthenticated, isLoginLink } = useAuth()
    await waitForAuth()
    if (isAuthenticated.value && !isLoginLink(window.location.href)) {
      try {
        const profil = await queryClient.ensureQueryData({
          queryKey: ['me'],
          queryFn: () => api.get<MeResponse>('/me'),
        })
        return profil.user.role === 'admin'
          ? { name: 'admin-dashboard' }
          : { name: 'boutique' }
      } catch {
        // Une session Firebase peut avoir été révoquée côté serveur. Dans ce
        // cas, l'API gère sa déconnexion et la page de connexion reste utile.
        return true
      }
    }
    return true
  }

  if (to.meta.public) return true
  const { waitForAuth, isAuthenticated } = useAuth()
  await waitForAuth()
  if (!isAuthenticated.value) {
    return {
      name: 'login',
      query: to.fullPath !== '/' ? { redirect: to.fullPath } : {},
    }
  }

  const roleRequis = to.meta.role
  if (roleRequis === 'admin' || roleRequis === 'client') {
    const profil = await queryClient.ensureQueryData({
      queryKey: ['me'],
      queryFn: () => api.get<MeResponse>('/me'),
    })
    if (profil.user.role !== roleRequis) {
      return profil.user.role === 'admin'
        ? { name: 'admin-dashboard' }
        : { name: 'boutique' }
    }
  }
  return true
})

export default router
