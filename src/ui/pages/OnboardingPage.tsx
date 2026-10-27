import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserRound } from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import { signOut } from '../../features/auth/authService';
import { queryKeys } from '../../data/queryKeys';
import { completeProfileOnboarding } from '../../data/repositories/profileRepository';
import { useProfile } from '../../features/profile/useProfile';
import { Button } from '../components/Button';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { NumericField } from '../components/Field';
import { StatusMessage } from '../components/StatusMessage';

const nutrientOptions = [
  { id: 'protein', name: 'Protein' },
  { id: 'carbohydrate', name: 'Carbohydrate' },
  { id: 'fat', name: 'Fat' },
  { id: 'fibre', name: 'Fibre' },
  { id: 'sugar', name: 'Sugar' },
  { id: 'saturated_fat', name: 'Saturated fat' },
  { id: 'salt', name: 'Salt' },
] as const;

function isIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value.includes('/') || value === 'UTC' || value.startsWith('Etc/');
  } catch {
    return false;
  }
}

export function OnboardingPage() {
  const { status, session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const profile = useProfile();
  const browserTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC', []);
  const [timezone, setTimezone] = useState(browserTimezone);
  const [timezoneConfirmed, setTimezoneConfirmed] = useState(false);
  const [target, setTarget] = useState('');
  const [displayedFields, setDisplayedFields] = useState<string[]>([]);
  const [nutrientTargets, setNutrientTargets] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [signOutError, setSignOutError] = useState('');
  const requestRef = useRef<{ signature: string; id: string } | null>(null);

  const saveProfile = useMutation({
    mutationFn: completeProfileOnboarding,
    onSuccess: async () => {
      if (session?.user.id) await queryClient.invalidateQueries({ queryKey: queryKeys.profile(session.user.id) });
      navigate('/', { replace: true });
    },
  });

  async function handleSignOut() {
    setSignOutError('');
    try {
      await signOut();
    } catch {
      setSignOutError('We couldn’t finish signing out. Check your connection and try again.');
    }
  }

  if (status === 'signed-out') return <Navigate to="/sign-in" replace />;
  if (status === 'loading') return <main className="signin-page"><LoadingSkeleton label="Checking your session" /></main>;
  if (status === 'unconfigured') return <main className="signin-page"><Link to="/" className="back-link"><ArrowLeft size={16} /> Back to Steady</Link><section className="signin-card"><p className="eyebrow">MAKE IT YOURS</p><h1>Start with what matters.</h1><StatusMessage>Connect the local Supabase project before saving a profile.</StatusMessage></section></main>;
  if (profile.isPending) return <main className="signin-page"><LoadingSkeleton label="Loading your profile" /></main>;
  if (profile.isError) return <main className="signin-page page-stack"><StatusMessage tone="error">We couldn’t check your profile. Your data is safe; try again.</StatusMessage><Button variant="secondary" type="button" onClick={() => void profile.refetch()}>Try again</Button></main>;
  if (profile.data?.profile.onboarding_complete) return <Navigate to="/" replace />;

  function toggleField(fieldId: string, selected: boolean) {
    setDisplayedFields((current) => selected
      ? [...current, fieldId]
      : current.filter((id) => id !== fieldId));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    const calories = Number(target);
    if (!target || !Number.isInteger(calories) || calories <= 0 || calories >= 1_000_000) {
      setFormError('Enter a daily calorie target as a positive whole number.');
      return;
    }
    if (!isIanaTimezone(timezone.trim())) {
      setFormError('Enter a valid IANA timezone, such as Europe/London.');
      return;
    }
    if (!timezoneConfirmed) {
      setFormError('Confirm the timezone used for your dates and week boundaries.');
      return;
    }

    const normalizedTargets: Record<string, number> = {};
    for (const [fieldId, value] of Object.entries(nutrientTargets)) {
      if (!value.trim()) continue;
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0 || amount >= 100_000_000) {
        setFormError(`Enter a valid non-negative ${nutrientOptions.find((item) => item.id === fieldId)?.name ?? 'nutrient'} target, or leave it blank.`);
        return;
      }
      normalizedTargets[fieldId] = amount;
    }

    const input = {
      timezone: timezone.trim(),
      baseDailyTargetKcal: calories,
      displayedFields,
      nutrientTargets: normalizedTargets,
    };
    const signature = JSON.stringify(input);
    if (requestRef.current?.signature !== signature) {
      requestRef.current = { signature, id: crypto.randomUUID() };
    }
    saveProfile.mutate({ ...input, requestId: requestRef.current.id });
  }

  return (
    <main className="signin-page onboarding-page">
      <div className="onboarding-top-actions"><Link to="/" className="back-link"><ArrowLeft size={16} /> Back to Steady</Link><Button variant="secondary" type="button" onClick={handleSignOut}>Sign out</Button></div>
      <section className="signin-card onboarding-card">
        <p className="eyebrow">MAKE IT YOURS</p>
        <h1>Start with what matters.</h1>
        <p>Your targets are personal. Choose what works for you; there’s no preset calorie goal.</p>
        {signOutError && <StatusMessage tone="error">{signOutError}</StatusMessage>}
        <div className="onboarding-note"><UserRound size={18} /><span>Your daily target is only used to plan your week. You can change it later.</span></div>

        <form className="profile-form" onSubmit={handleSubmit} noValidate>
          {formError && <StatusMessage tone="error">{formError}</StatusMessage>}
          {saveProfile.isError && <StatusMessage tone="error">We couldn’t save your profile. Check your connection and try again.</StatusMessage>}

          <NumericField id="daily-target" label="Daily calorie target" hint="Whole kcal. This is your choice, not a recommendation." min={1} max={999999} step={1} inputMode="numeric" value={target} onChange={(event) => setTarget(event.target.value)} required aria-invalid={Boolean(formError && !target)} />

          <div className="form-field">
            <label className="field-label" htmlFor="account-timezone">Your timezone</label>
            <input id="account-timezone" className="text-field" type="text" autoComplete="off" value={timezone} onChange={(event) => { setTimezone(event.target.value); setTimezoneConfirmed(false); }} aria-describedby="timezone-hint" />
            <p className="field-hint" id="timezone-hint">Weeks run Monday–Sunday in this timezone. Your browser suggested {browserTimezone}; change it if needed.</p>
            <label className="confirm-timezone"><input type="checkbox" checked={timezoneConfirmed} onChange={(event) => setTimezoneConfirmed(event.target.checked)} /><span>I confirm this timezone for my week and log dates.</span></label>
          </div>

          <fieldset className="nutrient-fieldset">
            <legend>Optional nutrients</legend>
            <p className="field-hint">Choose which nutrients to show. Targets are optional; leaving one blank does not save a zero.</p>
            <div className="nutrient-options">
              {nutrientOptions.map((field) => (
                <div className="nutrient-option" key={field.id}>
                  <label className="nutrient-display" htmlFor={`display-${field.id}`}>
                    <input id={`display-${field.id}`} type="checkbox" checked={displayedFields.includes(field.id)} onChange={(event) => toggleField(field.id, event.target.checked)} />
                    <span>{field.name}</span>
                  </label>
                  <label className="nutrient-target" htmlFor={`target-${field.id}`}>
                    <span className="visually-hidden">Optional {field.name} target in grams</span>
                    <input id={`target-${field.id}`} className="text-field" type="number" min="0" max="99999999" step="any" inputMode="decimal" placeholder="Target" value={nutrientTargets[field.id] ?? ''} onChange={(event) => setNutrientTargets((current) => ({ ...current, [field.id]: event.target.value }))} />
                    <span className="nutrient-unit">g</span>
                  </label>
                </div>
              ))}
            </div>
          </fieldset>

          <p className="effective-date-note">Your first target starts with this week. Later calorie-target changes start next Monday; nutrient targets start the next local day.</p>
          <Button type="submit" className="full-width" disabled={saveProfile.isPending}>{saveProfile.isPending ? 'Saving your profile…' : 'Save my profile'}</Button>
        </form>
      </section>
    </main>
  );
}
