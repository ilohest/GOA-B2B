import { useQuery } from '@tanstack/vue-query'
import { api } from '@/lib/api'
import type { MeResponse } from '@/lib/types'
import { useAuth } from '@/composables/useAuth'

/** Profil plateforme + fiche client Easybeer de l'utilisateur connecté. */
export function useMe() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/me'),
    enabled: isAuthenticated,
  })
}
