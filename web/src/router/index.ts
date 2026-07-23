import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useHeaderSaveBar } from '@/composables/useHeaderSaveBar'

const router = createRouter({
  history: createWebHistory(),
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
      path: '/',
      component: () => import('@/layouts/ClientLayout.vue'),
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
          path: 'compte',
          name: 'compte',
          component: () => import('@/pages/ComptePage.vue'),
        },
      ],
    },
    {
      path: '/admin',
      component: () => import('@/layouts/AdminLayout.vue'),
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
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
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

  if (to.meta.public) return true
  const { waitForAuth, isAuthenticated } = useAuth()
  await waitForAuth()
  if (!isAuthenticated.value) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  return true
})

export default router
