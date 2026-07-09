import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

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
      name: 'home',
      component: () => import('@/pages/HomePage.vue'),
    },
    {
      path: '/commandes',
      name: 'commandes',
      component: () => import('@/pages/CommandesPage.vue'),
    },
    {
      path: '/admin',
      component: () => import('@/layouts/AdminLayout.vue'),
      children: [
        {
          path: '',
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
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// Toute route est privée sauf meta.public. On attend la restauration de la
// session Firebase avant de rediriger (sinon faux négatif au rechargement).
router.beforeEach(async (to) => {
  if (to.meta.public) return true
  const { waitForAuth, isAuthenticated } = useAuth()
  await waitForAuth()
  if (!isAuthenticated.value) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  return true
})

export default router
