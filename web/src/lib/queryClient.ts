import { QueryClient } from '@tanstack/vue-query'

// Pas de refetch au focus : les données bougent peu et certaines lectures
// (commandes) touchent l'API Easybeer, très sensible au rate-limiting.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
})
