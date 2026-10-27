import { useEffect, useState } from 'react';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { hasTabEdits, noteTabEdit, useTabEdits } from './updateSafety';

export function PwaUpdatePrompt() {
  const queryClient = useQueryClient();
  const edits = useTabEdits();
  const mutations = useIsMutating();
  const [updateError, setUpdateError] = useState(false);
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError: () => setUpdateError(true),
  });

  useEffect(() => {
    const handleEdit = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) noteTabEdit();
    };
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasTabEdits() && queryClient.isMutating() === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    document.addEventListener('input', handleEdit, true);
    document.addEventListener('change', handleEdit, true);
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      document.removeEventListener('input', handleEdit, true);
      document.removeEventListener('change', handleEdit, true);
      window.removeEventListener('beforeunload', warnBeforeUnload);
    };
  }, [queryClient]);

  async function applyUpdate() {
    if (hasTabEdits() || queryClient.isMutating() > 0) return;
    try {
      await updateServiceWorker();
    } catch {
      setUpdateError(true);
    }
  }

  if (!needRefresh && !updateError) return null;
  const unsafe = edits || mutations > 0;
  return (
    <aside className="update-banner" role="status" aria-live="polite">
      <div>
        <strong>{updateError ? 'Update check failed' : 'An update is ready'}</strong>
        <p>{updateError
          ? 'Steady is still usable. Check your connection and reopen it later to try the update again.'
          : edits
            ? 'Finish and save or discard your edits, then close and reopen Steady to update safely. Your edits will not be reloaded automatically.'
            : mutations > 0
              ? 'A save is in progress. Wait for it to finish before updating.'
              : 'Update when you’re ready. This will reload Steady; your saved records stay on the server.'}</p>
      </div>
      {!updateError && <div className="update-banner-actions">
        <button type="button" className="secondary-button" onClick={() => setNeedRefresh(false)}>Later</button>
        <button type="button" className="primary-button" disabled={unsafe} onClick={() => void applyUpdate()}>Update now</button>
      </div>}
    </aside>
  );
}
