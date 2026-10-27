import assert from 'node:assert/strict';
import test from 'node:test';
import { nextIdempotentRequest } from '../../src/domain/requestIdentity.ts';

test('an unchanged Library-save payload reuses its request ID after an uncertain response', () => {
  let idsCreated = 0;
  const makeId = () => `request-${++idsCreated}`;
  const first = nextIdempotentRequest(null, { name: 'Oats', amount: 100 }, makeId);
  const retry = nextIdempotentRequest(first, { name: 'Oats', amount: 100 }, makeId);
  assert.equal(retry, first);
  assert.equal(idsCreated, 1);
  const changed = nextIdempotentRequest(retry, { name: 'Oats', amount: 120 }, makeId);
  assert.equal(changed.requestId, 'request-2');
});
