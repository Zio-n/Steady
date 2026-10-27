import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthProvider';
import { queryKeys } from '../data/queryKeys';

type ConnectionState = 'online' | 'offline' | 'reconnecting' | 'refresh-failed';

export function ConnectivityBanner() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [state, setState] = useState<ConnectionState>(() => navigator.onLine ? 'online' : 'offline');
  const requestEpoch = useRef(0);

  const refreshAccount = useCallback(async () => {
    const request = ++requestEpoch.current;
    if (!navigator.onLine) {
      setState('offline');
      return;
    }
    if (!userId) {
      setState('online');
      return;
    }
    setState('reconnecting');
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.account(userId), refetchType: 'active' }, { throwOnError: true });
      if (request === requestEpoch.current) setState('online');
    } catch {
      if (request === requestEpoch.current) setState('refresh-failed');
    }
  }, [queryClient, userId]);

  useEffect(() => {
    const wentOffline = () => { requestEpoch.current += 1; setState('offline'); };
    const wentOnline = () => { void refreshAccount(); };
    window.addEventListener('offline', wentOffline);
    window.addEventListener('online', wentOnline);
    return () => {
      requestEpoch.current += 1;
      window.removeEventListener('offline', wentOffline);
      window.removeEventListener('online', wentOnline);
    };
  }, [refreshAccount]);

  if (state === 'online') return null;
  return (
    <div className="connectivity-banner" role="status" aria-live="polite">
      {state === 'offline' && 'You’re offline. Connect to load or save your records. Anything already visible was last loaded while online.'}
      {state === 'reconnecting' && 'Connection returned. Refreshing your records before showing them as current…'}
      {state === 'refresh-failed' && <>
        <span>Connection returned, but we couldn’t refresh your records. Visible data may be out of date.</span>{' '}
        <button type="button" className="connectivity-retry" onClick={() => void refreshAccount()}>Retry refresh</button>
      </>}
    </div>
  );
}
