import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function localStatus() {
  const result = spawnSync('./node_modules/.bin/supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  });
  if (result.status !== 0) throw new Error('Local Supabase status is unavailable. Start the stack first.');
  const status = JSON.parse(result.stdout);
  if (!status.API_URL || !status.PUBLISHABLE_KEY || !status.SECRET_KEY) {
    throw new Error('Local Supabase did not report the required API keys.');
  }
  return status;
}

function localDate(timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function unwrap(label, response) {
  if (response.error) throw new Error(`${label}: ${response.error.code ?? 'request failed'}`);
  return response.data;
}

const status = localStatus();
const admin = createClient(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = createClient(status.API_URL, status.PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `steady-carry-${randomUUID()}@test.invalid`;
const password = randomUUID() + randomUUID();
let userId;

try {
  const created = unwrap('create synthetic user', await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  }));
  userId = created.user.id;
  unwrap('sign in synthetic user', await client.auth.signInWithPassword({ email, password }));

  unwrap('onboard synthetic user', await client.rpc('complete_profile_onboarding', {
    p_request_id: randomUUID(), p_timezone: 'Europe/London',
    p_base_daily_target_kcal: 2100, p_displayed_fields: [], p_nutrient_targets: {},
  }));

  const today = localDate('Europe/London');
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
  const monday = addDays(today, 1 - weekday);
  const destination = today === monday ? addDays(today, 1) : today;
  unwrap('log synthetic source', await client.rpc('log_day_item', {
    p_request_id: randomUUID(), p_local_date: monday, p_section: 'breakfast',
    p_source_kind: 'one_off_food', p_source_id: null, p_amount: 100, p_unit: 'g',
    p_manual_payload: { name: 'Synthetic meal', basisAmount: 100, basisUnit: 'g', caloriesKcal: 2400, nutrients: {} },
  }));
  const openSource = unwrap('read source', await client.from('days')
    .select('revision,log_revision').eq('local_date', monday).single());
  unwrap('complete synthetic source', await client.rpc('complete_day', {
    p_request_id: randomUUID(), p_local_date: monday,
    p_expected_day_revision: openSource.revision, p_expected_log_revision: openSource.log_revision,
  }));
  const source = unwrap('read completed source', await client.from('days')
    .select('revision,completed_log_revision').eq('local_date', monday).single());
  const week = unwrap('read week', await client.from('weeks')
    .select('revision').eq('week_start', monday).single());
  const input = {
    p_source_date: monday, p_expected_source_revision: source.revision,
    p_expected_log_revision: source.completed_log_revision,
    p_week_start: monday, p_expected_week_revision: week.revision,
    p_action: 'single_day', p_amount_kcal: 150,
    p_allocations: [{ destination_date: destination, signed_delta_kcal: -150, expected_revision: 1 }],
  };

  const outcomes = await Promise.all([
    client.rpc('save_carry_decision', { ...input, p_request_id: randomUUID() }),
    client.rpc('save_carry_decision', { ...input, p_request_id: randomUUID() }),
  ]);
  assert.equal(outcomes.filter((outcome) => !outcome.error).length, 1, 'exactly one competing carry must save');
  assert.equal(outcomes.filter((outcome) => outcome.error?.code === '40001').length, 1,
    'the losing carry must report a refreshable revision conflict');
  const decisions = unwrap('read carry ledger', await client.from('carry_decisions')
    .select('id,state').eq('source_date', monday));
  assert.equal(decisions.filter((decision) => decision.state === 'active').length, 1);
  const recipient = unwrap('read recipient', await client.from('days')
    .select('revision').eq('local_date', destination).single());
  assert.equal(recipient.revision, 2, 'the recipient revision must advance only once');
  console.log('Carry concurrency: PASS (one decision, one conflict, one recipient update).');
} catch (error) {
  console.error(`Carry concurrency: FAIL (${error.message}).`);
  process.exitCode = 1;
} finally {
  if (userId) {
    // The schema intentionally restricts direct parent deletion, so remove this
    // synthetic test graph from leaf to root before deleting its Auth user.
    for (const table of ['carry_allocations', 'carry_decisions', 'day_items', 'days', 'weeks']) {
      const removed = await admin.from(table).delete().eq('user_id', userId);
      if (removed.error) {
        console.error(`Synthetic ${table} cleanup failed (${removed.error.code ?? 'request failed'}).`);
        process.exitCode = 1;
      }
    }
    const cleanup = await admin.auth.admin.deleteUser(userId);
    if (cleanup.error) {
      console.error(`Synthetic-user cleanup failed (${cleanup.error.code ?? 'request failed'}).`);
      process.exitCode = 1;
    }
  }
}
