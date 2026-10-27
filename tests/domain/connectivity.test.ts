import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppQueryClient } from '../../src/app/queryClient.ts';
import { DataError } from '../../src/data/dataError.ts';

test('known-offline mutations fail before making a request and are not queued', async () => {
  let called = false;
  const client = createAppQueryClient(() => false);
  const mutation = client.getMutationCache().build(client, {
    mutationFn: async () => { called = true; return 'saved'; },
  });
  await assert.rejects(mutation.execute(), (error: unknown) => error instanceof DataError && error.kind === 'network');
  assert.equal(called, false);
  assert.equal(mutation.state.isPaused, false);
});

test('online mutations execute normally without automatic retries', async () => {
  let calls = 0;
  const client = createAppQueryClient(() => true);
  const mutation = client.getMutationCache().build(client, {
    mutationFn: async () => { calls += 1; return 'saved'; },
  });
  assert.equal(await mutation.execute(), 'saved');
  assert.equal(calls, 1);
  assert.equal(client.getDefaultOptions().mutations?.retry, false);
  assert.equal(client.getDefaultOptions().mutations?.networkMode, 'always');
});

test('offline reads settle into an error rather than pausing forever', async () => {
  const client = createAppQueryClient(() => false);
  assert.equal(client.getDefaultOptions().queries?.networkMode, 'always');
  assert.equal(client.getDefaultOptions().queries?.refetchOnReconnect, false);
  const query = client.getQueryCache().build(client, {
    queryKey: ['account', 'test-only', 'profile'],
    queryFn: async () => { throw new Error('Network unavailable'); },
    retry: false,
  });
  await assert.rejects(query.fetch(), /Network unavailable/);
  assert.equal(query.state.fetchStatus, 'idle');
  assert.equal(query.state.status, 'error');
});
