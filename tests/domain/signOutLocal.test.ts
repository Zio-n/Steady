import assert from 'node:assert/strict';
import test from 'node:test';
import { signOutLocal } from '../../src/features/auth/signOutLocal.ts';

test('sign-out uses only this device and accepts verified local cleanup after a network error', async () => {
  let scope = '';
  await signOutLocal({
    signOut: async (options) => { scope = options.scope; return { error: new Error('Network unavailable') }; },
    getSession: async () => ({ data: { session: null }, error: null }),
  });
  assert.equal(scope, 'local');
});

test('sign-out never claims success when the local session remains', async () => {
  await assert.rejects(signOutLocal({
    signOut: async () => { throw new Error('Network unavailable'); },
    getSession: async () => ({ data: { session: { access_token: 'test-only' } }, error: null }),
  }), /Network unavailable/);
});
