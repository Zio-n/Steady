import { Navigate, Outlet } from 'react-router-dom';
import { useProfile } from '../features/profile/useProfile';
import { LoadingSkeleton } from '../ui/components/LoadingSkeleton';
import { StatusMessage } from '../ui/components/StatusMessage';
import { Button } from '../ui/components/Button';

export function CompleteProfileRoute() {
  const profile = useProfile();
  if (profile.isPending) return <main className="main-content"><LoadingSkeleton label="Loading your profile" /></main>;
  if (profile.isError) {
    return <main className="main-content page-stack">
      <StatusMessage tone="error">We couldn’t load your profile. Your data is safe; try again.</StatusMessage>
      <Button variant="secondary" type="button" onClick={() => void profile.refetch()}>Try again</Button>
    </main>;
  }
  if (!profile.data?.profile.onboarding_complete) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}
