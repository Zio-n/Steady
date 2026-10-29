import assert from 'node:assert/strict';
import test from 'node:test';
import { choiceMatchScore } from '../../src/domain/choiceSearch.ts';

test('food search ranks confident names above brand and word-order matches', () => {
  const exact = choiceMatchScore('Greek yoghurt', null, 'Greek yoghurt');
  const prefix = choiceMatchScore('Greek yoghurt, plain', null, 'Greek yoghurt');
  const brand = choiceMatchScore('Plain yoghurt', 'Greek Farms', 'Greek Farms');
  const reordered = choiceMatchScore('Greek yoghurt, plain', null, 'plain Greek');
  assert.ok(exact > prefix && prefix > brand && brand > reordered);
});

test('food search tolerates one typo per word without matching unrelated items', () => {
  assert.ok(choiceMatchScore('Chicken breast', null, 'chiken brest') > 0);
  assert.equal(choiceMatchScore('Chicken breast', null, 'salmon rice'), -1);
  assert.ok(choiceMatchScore('Crème fraîche', null, 'creme fraiche') > 0);
});
