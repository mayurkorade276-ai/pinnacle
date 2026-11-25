import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePidCheckDigits,
  deriveDeterministicPidForUid,
  formatPidFromEightDigits,
  generateUniquePid,
  isValidPid,
} from './pid';

test('formatPidFromEightDigits produces valid PID with deterministic check digits', () => {
  const pid = formatPidFromEightDigits('48271936');
  assert.equal(pid, 'PID-4827-1936-05');
  assert.equal(isValidPid(pid), true);
});

test('isValidPid rejects tampered digits or malformed strings', () => {
  assert.equal(isValidPid('PID-4827-1936-05'), true);
  assert.equal(isValidPid('PID-4827-1936-06'), false);
  assert.equal(isValidPid('PID-4828-1936-05'), false);
  assert.equal(isValidPid('4827-1936-05'), false);
  assert.equal(isValidPid(''), false);
});

test('generateUniquePid never collides with existing set and always validates', () => {
  const existing = new Set<string>(['PID-4827-1936-05']);
  for (let i = 0; i < 25; i += 1) {
    const next = generateUniquePid(existing);
    assert.equal(existing.has(next), false);
    assert.equal(isValidPid(next), true);
    existing.add(next);
  }
});

test('deriveDeterministicPidForUid is permanent per user', () => {
  const p1 = deriveDeterministicPidForUid('user-alpha-123');
  const p2 = deriveDeterministicPidForUid('user-alpha-123');
  assert.equal(p1, p2);
  assert.equal(isValidPid(p1), true);
  assert.equal(deriveDeterministicPidForUid('demo-patient'), 'PID-4827-1936-05');
  assert.equal(computePidCheckDigits('48271936'), '05');
});
