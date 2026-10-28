import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserRound } from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import { signOut } from '../../features/auth/authService';
import { useProfile } from '../../features/profile/useProfile';
import { queryKeys } from '../../data/queryKeys';
import { completeCalendarSetup } from '../../data/repositories/profileRepository';
import { Button } from '../components/Button';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { NumericField } from '../components/Field';
import { StatusMessage } from '../components/StatusMessage';

export function CalendarSetupPage() {
  const { status, session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const profile = useProfile();
  const browserTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC', []);
  const [timezone, setTimezone] = useState(browserTimezone);
  const [timezoneConfirmed, setTimezoneConfirmed] = useState(false);
  const [target, setTarget] = useState('');
  const [formError, setFormError] = useState('');
  const [signOutError, setSignOutError] = useState('');
  const requestRef = useRef<{ signature: string; id: string } | null>(null);

  const save = useMutation({
    mutationFn: completeCalendarSetup,
    onSuccess: async () => {
      if (session?.user.id) await queryClient.invalidateQueries({ queryKey: queryKeys.profile(session.user.id) });
      navigate('/?start=meal', { replace: true });
    },
  });

  async function handleSignOut() {
    setSignOutError('');
    try { await signOut(); } catch { setSignOutError('We couldn’t finish signing out. Check your connection and try again.'); }
  }

  if (status === 'signed-out') return <Navigate to="/sign-in" replace />;
  if (status === 'loading') return <main className="signin-page"><LoadingSkeleton label="Checking your session" /></main>;
  if (status === 'unconfigured') return <main className="signin-page"><section className="signin-card"><p className="eyebrow">YOUR CALENDAR</p><h1>Start with a meal.</h1><StatusMessage>Connect the local Supabase project before saving your account setup.</StatusMessage></section></main>;
  if (profile.isPending) return <main className="signin-page"><LoadingSkeleton label="Loading your profile" /></main>;
  if (profile.isError) return <main className="signin-page page-stack"><StatusMessage tone="error">We couldn’t check your profile. Your data is safe; try again.</StatusMessage><Button variant="secondary" type="button" onClick={() => void profile.refetch()}>Try again</Button></main>;
  if (profile.data?.profile.onboarding_complete) return <Navigate to="/" replace />;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    const cleanTimezone = timezone.trim();
    try { new Intl.DateTimeFormat('en', { timeZone: cleanTimezone }).format(); }
    catch { setFormError('Enter a valid timezone, such as Europe/London.'); return; }
    if (!timezoneConfirmed) { setFormError('Confirm the timezone used for your calendar dates.'); return; }
    const calories = target.trim() ? Number(target) : null;
    if (calories !== null && (!Number.isInteger(calories) || calories <= 0 || calories >= 1_000_000)) {
      setFormError('Enter a positive whole number of kcal, or leave the target blank.'); return;
    }
    const input = { timezone: cleanTimezone, targetKcal: calories };
    const signature = JSON.stringify(input);
    if (requestRef.current?.signature !== signature) requestRef.current = { signature, id: crypto.randomUUID() };
    save.mutate({ ...input, requestId: requestRef.current.id });
  }

  return <main className="signin-page onboarding-page">
    <div className="onboarding-top-actions"><Link to="/" className="back-link"><ArrowLeft size={16} /> Back to Steady</Link><Button variant="secondary" type="button" onClick={handleSignOut}>Sign out</Button></div>
    <section className="signin-card onboarding-card">
      <p className="eyebrow">A SIMPLE PLACE TO START</p><h1>Set up your calendar.</h1>
      <p>Choose a timezone and, if useful, a daily calorie target. You can log meals without setting a target.</p>
      {signOutError && <StatusMessage tone="error">{signOutError}</StatusMessage>}
      <div className="onboarding-note"><UserRound size={18} /><span>Your diary and targets are private to your account.</span></div>
      <form className="profile-form" onSubmit={handleSubmit} noValidate>
        {formError && <StatusMessage tone="error">{formError}</StatusMessage>}
        {save.isError && <StatusMessage tone="error">We couldn’t confirm setup. Retry to safely check the same request.</StatusMessage>}
        <NumericField id="daily-target" label="Daily calorie target · optional" hint="Whole kcal. This is your preference, not a recommendation." min={1} max={999999} step={1} inputMode="numeric" value={target} onChange={(event) => setTarget(event.target.value)} />
        <div className="form-field"><label className="field-label" htmlFor="account-timezone">Your timezone</label>
          <input id="account-timezone" className="text-field" type="text" autoComplete="off" value={timezone} onChange={(event) => { setTimezone(event.target.value); setTimezoneConfirmed(false); }} aria-describedby="timezone-hint" />
          <p className="field-hint" id="timezone-hint">The browser suggested {browserTimezone}. Dates follow the timezone you confirm.</p>
          <label className="confirm-timezone"><input type="checkbox" checked={timezoneConfirmed} onChange={(event) => setTimezoneConfirmed(event.target.checked)} /><span>I confirm this timezone for my calendar.</span></label>
        </div>
        <Button type="submit" className="full-width" disabled={save.isPending}>{save.isPending ? 'Saving…' : save.isError ? 'Retry setup' : 'Continue to your first meal'}</Button>
      </form>
    </section>
  </main>;
}
