import assert from 'node:assert/strict';
import test from 'node:test';
import { hasTabEdits, noteTabEdit } from '../../src/app/updateSafety.ts';

test('an edit latches update safety for the rest of the tab session', () => {
  assert.equal(hasTabEdits(), false);
  noteTabEdit();
  assert.equal(hasTabEdits(), true);
  noteTabEdit();
  assert.equal(hasTabEdits(), true);
});
