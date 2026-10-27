import { useState } from 'react';
import { CircleUserRound, Clock3, Target } from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import { effectiveTarget, localDateInTimezone } from '../../domain/dates';
import { signOut } from '../../features/auth/authService';
import { useProfile } from '../../features/profile/useProfile';
import { NutrientSettings } from '../../features/profile/NutrientSettings';
import { ProfileTargetEditor } from '../../features/profile/ProfileTargetEditor';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';
import { UnsavedChangesPrompt } from '../components/UnsavedChangesPrompt';

export function ProfilePage() {
  const { session } = useAuth();
  const profile = useProfile();
  const [signOutError, setSignOutError] = useState('');
  const [nutrientSettingsDirty, setNutrientSettingsDirty] = useState(false);
  const [targetsDirty, setTargetsDirty] = useState(false);

  async function handleSignOut() {
    setSignOutError('');
    try {
      await signOut();
    } catch {
      setSignOutError('We couldn’t finish signing out. Check your connection and try again.');
    }
  }

  if (profile.isPending) return <section className="page-stack"><LoadingSkeleton label="Loading your profile" /></section>;
  if (profile.isError || !profile.data) {
    return <section className="page-stack"><div><p className="eyebrow">YOUR SETTINGS</p><h1>Profile</h1></div><StatusMessage tone="error">We couldn’t load your profile. Your data is safe; try again.</StatusMessage><Button variant="secondary" type="button" onClick={() => void profile.refetch()}>Try again</Button></section>;
  }

  const { profile: savedProfile, nutrientFields, targetVersions } = profile.data;
  const today = localDateInTimezone(new Date(), savedProfile.timezone);
  const currentTargets = effectiveTarget(targetVersions, today);
  const targets = currentTargets?.nutrient_targets && typeof currentTargets.nutrient_targets === 'object' && !Array.isArray(currentTargets.nutrient_targets)
    ? currentTargets.nutrient_targets as Record<string, unknown>
    : {};
  const displayed = nutrientFields.filter((field) => field.is_displayed && !field.archived_at);

  return (
    <section className="page-stack">
      <UnsavedChangesPrompt isDirty={nutrientSettingsDirty || targetsDirty} />
      <div className="profile-heading"><div><p className="eyebrow">YOUR SETTINGS</p><h1>Profile</h1></div><Button variant="secondary" type="button" onClick={handleSignOut}>Sign out</Button></div>
      {signOutError && <StatusMessage tone="error">{signOutError}</StatusMessage>}
      <div className="profile-summary-card">
        <div className="profile-summary-icon"><Target size={20} /></div>
        <div><p className="eyebrow">DAILY CALORIE TARGET</p><p className="profile-target-number">{currentTargets?.base_daily_target_kcal?.toLocaleString() ?? 'Not set'} <span>kcal</span></p><p className="field-hint">Whole-week planning uses this target as its base.</p></div>
      </div>
      <section className="profile-section" aria-labelledby="timezone-heading">
        <div className="profile-section-heading"><Clock3 size={18} /><h2 id="timezone-heading">Account timezone</h2></div>
        <p>{savedProfile.timezone}</p>
        <p className="field-hint">Dates and Monday–Sunday weeks follow this timezone, not each device’s current setting.</p>
      </section>
      <section className="profile-section" aria-labelledby="nutrients-heading">
        <div className="profile-section-heading"><CircleUserRound size={18} /><h2 id="nutrients-heading">Nutrients you chose</h2></div>
        {displayed.length === 0 ? <EmptyState title="No extra nutrients selected"><p>Choose any nutrients you’d like to see alongside calories.</p></EmptyState> : (
          <ul className="profile-nutrient-list">
            {displayed.map((field) => {
              const target = targets[field.field_id];
              return <li key={field.field_id}><span>{field.name}</span><span>{typeof target === 'number' ? `${target.toLocaleString()} ${field.unit} target` : `No target · ${field.unit}`}</span></li>;
            })}
          </ul>
        )}
      </section>
      <NutrientSettings fields={nutrientFields} onDirtyChange={setNutrientSettingsDirty} />
      <ProfileTargetEditor profile={profile.data} onDirtyChange={setTargetsDirty} />
      <p className="field-hint">Signed in as {session?.user.email ?? 'your account'}.</p>
    </section>
  );
}
