import { DataError } from '../../data/dataError';
import { supabase } from '../../data/supabaseClient';
import { signOutLocal } from './signOutLocal';

export async function requestEmailCode(email: string) {
  if (!supabase) throw new DataError('Connect Supabase before requesting a sign-in code.', 'configuration');
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string) {
  if (!supabase) throw new DataError('Connect Supabase before verifying a sign-in code.', 'configuration');
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) throw new DataError('Connect Supabase before signing out.', 'configuration');
  await signOutLocal(supabase.auth);
}

export function authErrorMessage(error: unknown) {
  if (error instanceof Error && 'status' in error && error.status === 429) {
    return 'Too many code requests. Wait a little before trying again.';
  }
  if (error instanceof Error && /invalid|expired|token/i.test(error.message)) {
    return 'That code is incorrect or has expired. Check it and try again, or request a new code.';
  }
  if (error instanceof Error && /fetch|network|timeout/i.test(error.message)) {
    return 'We couldn’t reach the sign-in service. Check your connection and try again.';
  }
  return 'We couldn’t complete sign-in. Please try again in a moment.';
}
