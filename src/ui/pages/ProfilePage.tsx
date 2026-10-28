import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleUserRound, Clock3, Target } from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import { useProfile } from '../../features/profile/useProfile';
import { NutrientSettings } from '../../features/profile/NutrientSettings';
import { saveCalendarTargets } from '../../data/repositories/profileRepository';
import { queryKeys } from '../../data/queryKeys';
import { effectiveTarget, localDateInTimezone } from '../../domain/dates';
import { signOut } from '../../features/auth/authService';
import { Button } from '../components/Button';
import { NumericField } from '../components/Field';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';
import { UnsavedChangesPrompt } from '../components/UnsavedChangesPrompt';

export function ProfilePage() {
  const { session } = useAuth();
  const profile = useProfile();
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  const [effectiveFromDraft, setEffectiveFromDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [signOutError, setSignOutError] = useState('');
  const [nutrientSettingsDirty, setNutrientSettingsDirty] = useState(false);
  const [targetsDirty, setTargetsDirty] = useState(false);

  const savedProfile = profile.data?.profile;
  const timezone = savedProfile?.timezone ?? 'UTC';
  const today = localDateInTimezone(new Date(), timezone);
  const currentTarget = profile.data ? effectiveTarget(profile.data.targetVersions, today) : null;
  const target = targetDraft ?? currentTarget?.base_daily_target_kcal?.toString() ?? '';
  const effectiveFrom = effectiveFromDraft ?? today;

  const saveMutation = useMutation({
    mutationFn: saveCalendarTargets,
    onSuccess: async () => {
      setError(''); setNotice('Targets saved for the selected local date. Earlier dates keep their saved targets.');
      setTargetsDirty(false);
      if (userId) await queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
    },
    onError: () => setError('We couldn’t save these targets. Retry the same request or refresh your profile.'),
  });

  async function handleSignOut() {
    setSignOutError('');
    try { await signOut(); } catch { setSignOutError('We couldn’t finish signing out. Check your connection and try again.'); }
  }

  if (profile.isPending) return <section className="page-stack"><LoadingSkeleton label="Loading your settings" /></section>;
  if (profile.isError || !profile.data) return <section className="page-stack"><div><p className="eyebrow">YOUR SETTINGS</p><h1>Settings</h1></div><StatusMessage tone="error">We couldn’t load your settings. Your data is safe; try again.</StatusMessage><Button variant="secondary" type="button" onClick={() => void profile.refetch()}>Try again</Button></section>;

  const { nutrientFields, targetVersions } = profile.data;
  const activeFields = nutrientFields.filter((field) => !field.archived_at);
  const nutrientTargets = currentTarget?.nutrient_targets && typeof currentTarget.nutrient_targets === 'object' && !Array.isArray(currentTarget.nutrient_targets)
    ? currentTarget.nutrient_targets as Record<string, unknown> : {};

  function submitTargets() {
    setError(''); setNotice('');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || effectiveFrom < today) {
      setError('Choose today or a future local date for these targets.'); return;
    }
    const calories = target.trim() ? Number(target) : null;
    if (calories !== null && (!Number.isInteger(calories) || calories <= 0 || calories >= 1_000_000)) {
      setError('Enter a positive whole number of kcal, or clear the field to unset it.'); return;
    }
    const normalized: Record<string, number> = {};
    for (const field of activeFields) {
      const raw = nutrientTargets[field.field_id];
      if (typeof raw === 'number' && Number.isFinite(raw)) normalized[field.field_id] = raw;
    }
    saveMutation.mutate({ requestId: crypto.randomUUID(), effectiveFrom, baseDailyTargetKcal: calories, nutrientTargets: normalized });
  }

  return <section className="page-stack">
    <UnsavedChangesPrompt isDirty={nutrientSettingsDirty || targetsDirty || saveMutation.isPending} />
    <div className="profile-heading"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>Settings</h1></div><Button variant="secondary" type="button" onClick={handleSignOut}>Sign out</Button></div>
    {signOutError && <StatusMessage tone="error">{signOutError}</StatusMessage>}
    <div className="profile-summary-card"><div className="profile-summary-icon"><Target size={20} /></div><div><p className="eyebrow">DAILY TARGET</p><p className="profile-target-number">{currentTarget?.base_daily_target_kcal?.toLocaleString() ?? 'Not set'} <span>kcal</span></p><p className="field-hint">Targets are optional. Remaining allowance appears only when a target is set.</p></div></div>
    <section className="profile-section" aria-labelledby="calendar-targets-heading">
      <div className="profile-section-heading"><Target size={18} /><h2 id="calendar-targets-heading">Targets by date</h2></div>
      <p className="field-hint">A change applies from the selected date onward. Past dates keep their original target.</p>
      <div className="calendar-target-form">
        <label className="form-field" htmlFor="target-effective-date"><span className="field-label">Starts on</span><input id="target-effective-date" className="text-field" type="date" min={today} value={effectiveFrom} onChange={(event) => { setEffectiveFromDraft(event.target.value); setTargetsDirty(true); }} /></label>
        <NumericField id="settings-target" label="Daily calorie target · optional" hint="Clear the field to have no calorie target from that date." min={1} max={999999} step={1} value={target} onChange={(event) => { setTargetDraft(event.target.value); setTargetsDirty(true); }} />
      </div>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}{notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {saveMutation.isError && saveMutation.variables && <Button variant="secondary" type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(saveMutation.variables)}>Retry same save</Button>}
      <Button type="button" disabled={saveMutation.isPending || !targetsDirty} onClick={submitTargets}>{saveMutation.isPending ? 'Saving…' : 'Save target changes'}</Button>
    </section>
    <section className="profile-section" aria-labelledby="timezone-heading"><div className="profile-section-heading"><Clock3 size={18} /><h2 id="timezone-heading">Calendar timezone</h2></div><p>{timezone}</p><p className="field-hint">Calendar dates follow this saved timezone.</p></section>
    <section className="profile-section" aria-labelledby="nutrient-targets-heading"><div className="profile-section-heading"><CircleUserRound size={18} /><h2 id="nutrient-targets-heading">Nutrient targets</h2></div>{activeFields.filter((field) => field.is_displayed).length === 0 ? <p className="field-hint">No nutrients selected for the calendar yet.</p> : <ul className="profile-nutrient-list">{activeFields.filter((field) => field.is_displayed).map((field) => { const value = nutrientTargets[field.field_id]; return <li key={field.field_id}><span>{field.name}</span><span>{typeof value === 'number' ? `${value.toLocaleString()} ${field.unit}` : `No target · ${field.unit}`}</span></li>; })}</ul>}</section>
    <NutrientSettings fields={nutrientFields} onDirtyChange={setNutrientSettingsDirty} />
    <p className="field-hint">Signed in as {session?.user.email ?? 'your account'} · {targetVersions.length} saved target date{targetVersions.length === 1 ? '' : 's'}.</p>
  </section>;
}
