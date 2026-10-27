import { MutationCache, QueryClient } from '@tanstack/react-query';
import { DataError } from '../data/dataError.ts';

export function createAppQueryClient(isOnline: () => boolean = () => navigator.onLine) {
  return new QueryClient({
    mutationCache: new MutationCache({
      onMutate: () => {
        if (!isOnline()) throw new DataError('You’re offline. Connect before saving.', 'network');
      },
    }),
    defaultOptions: {
      // Queries must settle into an error state offline instead of remaining
      // paused on a loading skeleton. Reconnection refreshes active account data.
      queries: { staleTime: 30_000, refetchOnWindowFocus: true, refetchOnReconnect: false, networkMode: 'always', retry: 1 },
      // Never pause and replay a write on reconnection. A known-offline write
      // fails before its mutation function; an uncertain network write is
      // reconciled by the feature's existing refresh/same-request retry flow.
      mutations: { networkMode: 'always', retry: false },
    },
  });
}
