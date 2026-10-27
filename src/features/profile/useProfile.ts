import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthProvider';
import { queryKeys } from '../../data/queryKeys';
import { loadProfile } from '../../data/repositories/profileRepository';

export function useProfile() {
  const { session, status } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: userId ? queryKeys.profile(userId) : ['profile', 'signed-out'],
    queryFn: () => loadProfile(userId!),
    enabled: status === 'signed-in' && Boolean(userId),
  });
}
