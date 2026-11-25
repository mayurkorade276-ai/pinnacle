import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardEndsIn0000,
  evaluateMockCard,
  evaluateMockUpi,
  formatOccupiedUntil,
  formatSponsoredUntil,
  makeSlotKey,
  parseSlotBoundaryMs,
  validateCardExpiry,
  validateCvv,
  validateLuhnCard,
} from './sponsorship';

test('makeSlotKey builds deterministic normalized Firestore keys per city, specialty, rank', () => {
  assert.equal(makeSlotKey('Nagpur', 'Eye OPD', 1), 'nagpur__eye_opd__rank_1');
  assert.equal(makeSlotKey('Pune', 'General Physician', 2), 'pune__general_physician__rank_2');
});

test('validateLuhnCard & cardEndsIn0000 validate 16-digit cards and decline rule', () => {
  assert.equal(validateLuhnCard('4111 1111 1111 1111'), true);
  assert.equal(validateLuhnCard('4242 4242 4242 0000'), true);
  assert.equal(validateLuhnCard('4111 1111 1111 1112'), false);
  assert.equal(validateLuhnCard('41111111'), false);
  assert.equal(cardEndsIn0000('4242 4242 4242 0000'), true);
  assert.equal(cardEndsIn0000('4111 1111 1111 1111'), false);
});

test('validateCardExpiry & validateCvv check future MM/YY and 3 digits', () => {
  const ref = new Date('2026-11-24T12:00:00Z');
  assert.equal(validateCardExpiry('12/28', ref), true);
  assert.equal(validateCardExpiry('11/26', ref), true);
  assert.equal(validateCardExpiry('10/26', ref), false);
  assert.equal(validateCardExpiry('13/28', ref), false);
  assert.equal(validateCvv('123'), true);
  assert.equal(validateCvv('12'), false);
  assert.equal(validateCvv('1234'), false);
});

test('evaluateMockUpi and evaluateMockCard enforce exact test rules', () => {
  assert.equal(evaluateMockUpi('success@demo').ok, true);
  assert.equal(evaluateMockUpi('success@razorpay').ok, true);
  assert.equal(evaluateMockUpi('failure@demo').ok, false);
  assert.equal(evaluateMockUpi('failure@razorpay').ok, false);

  const okCard = evaluateMockCard({
    cardNumber: '4111 1111 1111 1111',
    expiry: '12/29',
    cvv: '456',
    now: new Date('2026-11-24T12:00:00Z'),
  });
  assert.equal(okCard.ok, true);

  const declined = evaluateMockCard({
    cardNumber: '4242 4242 4242 0000',
    expiry: '12/29',
    cvv: '456',
    now: new Date('2026-11-24T12:00:00Z'),
  });
  assert.equal(declined.ok, false);
  assert.equal(declined.reason, 'Payment declined, try again');
});

test('parseSlotBoundaryMs & remaining time formatters handle minute-level demo windows', () => {
  const nowMs = Date.parse('2026-11-24T13:00:00.000Z');
  const endMs = nowMs + 4 * 60_000;
  assert.equal(parseSlotBoundaryMs('2026-11-24T13:04:00.000Z', 'end'), endMs);
  assert.match(formatOccupiedUntil(endMs, nowMs), /^Occupied until .+ \(4 min left\)$/);
  assert.match(formatSponsoredUntil(endMs, nowMs), /^Sponsored until .+ \(4 min left\)$/);
});
