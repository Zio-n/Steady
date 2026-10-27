import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useAuth } from '../../app/AuthProvider';
import { Dialog } from './Dialog';
import { Button } from './Button';

/** Mount inside a form route and pass its dirty state to guard in-app and tab-close navigation. */
export function UnsavedChangesPrompt({ isDirty }: { isDirty: boolean }) {
  const { status } = useAuth();
  const shouldGuard = status === 'signed-in' && isDirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => shouldGuard && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!shouldGuard) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [shouldGuard]);

  return (
    <Dialog open={blocker.state === 'blocked'} title="Leave without saving?" onClose={() => blocker.reset?.()}>
      <p>Your changes on this page haven’t been saved.</p>
      <div className="dialog-actions"><Button variant="secondary" onClick={() => blocker.reset?.()}>Stay here</Button><Button onClick={() => blocker.proceed?.()}>Leave page</Button></div>
    </Dialog>
  );
}
