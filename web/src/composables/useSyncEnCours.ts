import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { api } from '@/lib/api'
import type { SyncStatusResponse } from '@/lib/types'

/**
 * État du verrou de synchro global Easybeer. Toutes les pages admin partagent
 * la même requête (clé `['admin','sync-status']`, dédupliquée par vue-query) :
 * leur bouton « Actualiser » peut ainsi afficher spinner + disabled dès qu'une
 * synchro — y compris une revalidation en tâche de fond — est en cours.
 */
export function useSyncEnCours() {
  const statutSync = useQuery({
    queryKey: ['admin', 'sync-status'],
    queryFn: () => api.get<SyncStatusResponse>('/admin/sync/status'),
    refetchInterval: 10_000,
  })
  const syncEnCours = computed(() => statutSync.data.value?.verrou?.actif === true)
  return { statutSync, syncEnCours }
}
