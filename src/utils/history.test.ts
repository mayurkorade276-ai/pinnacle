import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterHistoryBookings,
  getUniquePreviousDoctors,
  partitionBookings,
  sanitizePatientProfile,
} from './history';
import type { BookingRecord } from '../types/pinnacle';

const baseBooking = (overrides: Partial<BookingRecord>): BookingRecord => ({
  id: 'b-1',
  hospitalId: 'h-1',
  hospitalOwnerUid: 'owner-1',
  hospitalName: 'Vidarbha Netralaya',
  hospitalAddress: 'Dhantoli, Nagpur',
  hospitalLat: 21.1329,
  hospitalLng: 79.0785,
  doctorName: 'Dr. Ashwini Deshpande',
  specialty: 'Eye OPD',
  patientUid: 'u-1',
  patientName: 'Aarav Deshmukh',
  patientMobile: '+919822012345',
  patientEmail: 'aarav@example.in',
  patientAge: 34,
  patientGender: 'Male',
  reason: 'Vision check',
  date: '2026-11-20',
  timeSlot: '10:30 AM',
  isWalkIn: false,
  tokenNumber: 'EYE-12',
  tokenNumeric: 12,
  queuePosition: 0,
  estimatedCallTimeIso: '2026-11-20T05:00:00.000Z',
  initialEstimatedWaitMinutes: 15,
  status: 'completed',
  consentGiven: true,
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides,
});

test('partitionBookings separates active queue bookings from history log sorted newest-first', () => {
  const bookings: BookingRecord[] = [
    baseBooking({ id: 'h-old', date: '2026-10-15', status: 'completed' }),
    baseBooking({ id: 'a-now', date: '2026-11-24', status: 'waiting', queuePosition: 2 }),
    baseBooking({ id: 'h-new', date: '2026-11-18', status: 'cancelled' }),
    baseBooking({ id: 'a-called', date: '2026-11-24', status: 'called', queuePosition: 1, updatedAt: 5000 }),
  ];

  const { activeBookings, historyBookings } = partitionBookings(bookings);
  assert.deepEqual(
    activeBookings.map((b) => b.id),
    ['a-called', 'a-now']
  );
  assert.deepEqual(
    historyBookings.map((b) => b.id),
    ['h-new', 'h-old']
  );
});

test('filterHistoryBookings filters by status bucket and text search', () => {
  const history = [
    baseBooking({ id: '1', status: 'completed', doctorName: 'Dr. Ashwini Deshpande', specialty: 'Eye OPD' }),
    baseBooking({ id: '2', status: 'cancelled', doctorName: 'Dr. Sanjay Paranjape', specialty: 'ENT' }),
    baseBooking({ id: '3', status: 'skipped', doctorName: 'Dr. Vivek Pande', specialty: 'Eye OPD' }),
  ];

  assert.equal(filterHistoryBookings(history, 'completed', '').length, 1);
  assert.equal(filterHistoryBookings(history, 'cancelled_or_skipped', '').length, 2);
  assert.deepEqual(
    filterHistoryBookings(history, 'all', 'paranjape').map((b) => b.id),
    ['2']
  );
});

test('getUniquePreviousDoctors deduplicates doctors and counts visits accurately', () => {
  const bookings: BookingRecord[] = [
    baseBooking({ id: '1', date: '2026-11-01', doctorName: 'Dr. Ashwini Deshpande', status: 'completed' }),
    baseBooking({ id: '2', date: '2026-11-15', doctorName: 'Dr. Ashwini Deshpande', status: 'completed' }),
    baseBooking({ id: '3', date: '2026-11-10', hospitalId: 'h-2', hospitalName: 'Dhantoli ENT', doctorName: 'Dr. Sanjay Paranjape', specialty: 'ENT', status: 'completed' }),
    baseBooking({ id: '4', date: '2026-11-24', doctorName: 'Dr. Kavita Nagrale', status: 'waiting' }),
  ];

  const docs = getUniquePreviousDoctors(bookings);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].doctorName, 'Dr. Ashwini Deshpande');
  assert.equal(docs[0].visitCount, 2);
  assert.equal(docs[0].lastVisitDate, '2026-11-15');
  assert.equal(docs[1].doctorName, 'Dr. Sanjay Paranjape');
});

test('sanitizePatientProfile enforces bounds on allergies, emergencyContacts, and age', () => {
  const manyAllergies = Array.from({ length: 20 }, (_, i) => `Allergy ${i + 1}`);
  manyAllergies.push('allergy 1'); // duplicate case-insensitive

  const profile = sanitizePatientProfile('user-123', {
    displayName: '  Sneha Kulkarni  ',
    bloodGroup: 'O+',
    age: 29,
    gender: 'Female',
    allergies: manyAllergies,
    emergencyContacts: [
      { name: 'Rohan Kulkarni', relation: 'Spouse', phone: '+91 9822011122' },
      { name: 'A', relation: 'Friend', phone: '123' }, // invalid short name & phone
      { name: 'Meera Kulkarni', relation: 'Mother', phone: '+91 9822099988' },
      { name: 'Vijay Kulkarni', relation: 'Father', phone: '+91 9822077766' },
      { name: 'Extra Contact', relation: 'Sibling', phone: '+91 9822055544' },
    ],
  });

  assert.equal(profile.displayName, 'Sneha Kulkarni');
  assert.equal(profile.bloodGroup, 'O+');
  assert.equal(profile.allergies.length, 15);
  assert.equal(profile.emergencyContacts.length, 3);
  assert.equal(profile.emergencyContacts[0].name, 'Rohan Kulkarni');
});
