import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const pageNames: Record<string, string> = {
  '/': 'Today',
  '/library': 'Library',
  '/routine': 'Routine',
  '/profile': 'Profile',
  '/onboarding': 'Set up Steady',
  '/sign-in': 'Sign in',
};

/** Announce client-side navigation without moving focus away from the control used. */
export function RouteAnnouncement() {
  const { pathname } = useLocation();
  const pageName = pageNames[pathname] ?? 'Today';

  useEffect(() => { document.title = `${pageName} — Steady`; }, [pageName]);

  return <span className="visually-hidden" role="status" aria-live="polite">{pageName} page</span>;
}
