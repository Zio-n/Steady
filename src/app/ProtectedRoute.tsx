import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { LoadingSkeleton } from '../ui/components/LoadingSkeleton';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <main className="main-content"><LoadingSkeleton label="Checking your session" /></main>;
  // An unconfigured local scaffold contains no user data; preserve a visible
  // shell for development. Once Supabase is configured, all app routes gate.
  if (status === 'signed-out') return <Navigate to="/sign-in" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
  return <Outlet />;
}
