import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDepartureAdvisory,
  calculateEstimatedWaitMinutes,
  calculateTotalTimeMinutes,
  getQueueLevel,
  rankHospitals,
} from './ranking';
import type { HospitalRecord } from '../types/pinnacle';

const makeHospital = (overrides: Partial<HospitalRecord>): HospitalRecord => ({
  id: 'h-default',
  name: 'Nagpur Eye Care',
  type: 'Eye Centre',
  registrationNumber: 'MH-NGP-1001',
  yearEstablished: 2015,
  city: 'Nagpur',
  state: 'Maharashtra',
  pincode: '440012',
  address: '12 Wardha Road, Dhantoli, Nagpur',
  area: 'Dhantoli',
  lat: 21.135,
  lng: 79.08,
  deskPhone: '+91-712-2441100',
  specialties: ['Eye OPD'],
  doctors: [],
  opdDays: 'Mon-Sat',
  opdTimings: '09:30 AM - 07:30 PM',
  openNow: true,
  consultationFee: 500,
  avgConsultMinutes: 10,
  activeCounters: 2,
  patientsWaiting: 4,
  currentTokenNumber: 12,
  isPaused: false,
  isLiveQueue: true,
  historicalWaitMinutes: 25,
  lastUpdatedAt: Date.now(),
  googleRating: 4.5,
  reviewCount: 200,
  recentReviews: [],
  photoUrl: '/src/assets/images/nagpur_eye_hospital_one_1795551710669.jpg',
  status: 'approved',
  is_sponsored: false,
  ownerUid: 'owner-1',
  ...overrides,
});

test('calculateEstimatedWaitMinutes divides by active counters for live queues', () => {
  const h = makeHospital({ patientsWaiting: 6, avgConsultMinutes: 10, activeCounters: 2, isLiveQueue: true });
  assert.deepEqual(calculateEstimatedWaitMinutes(h), {
    estimatedWaitMinutes: 30,
    isEstimatedQueue: false,
  });
});

test('calculateEstimatedWaitMinutes uses historical average when live queue is unavailable', () => {
  const h = makeHospital({ isLiveQueue: false, historicalWaitMinutes: 22 });
  assert.deepEqual(calculateEstimatedWaitMinutes(h), {
    estimatedWaitMinutes: 22,
    isEstimatedQueue: true,
  });
});

test('calculateTotalTimeMinutes follows travel + max(0, wait - travel) + consult', () => {
  // 15 min travel, 35 min wait -> 20 min wait at arrival -> 15 + 20 + 10 = 45 min
  assert.deepEqual(calculateTotalTimeMinutes(15, 35, 10), {
    waitAtArrivalMinutes: 20,
    totalTimeMinutes: 45,
  });

  // 25 min travel, 15 min wait -> queue clears during travel (0 wait) -> 25 + 0 + 10 = 35 min
  assert.deepEqual(calculateTotalTimeMinutes(25, 15, 10), {
    waitAtArrivalMinutes: 0,
    totalTimeMinutes: 35,
  });
});

test('getQueueLevel classifies green, amber, and red accurately', () => {
  assert.equal(getQueueLevel(12, false, true), 'green');
  assert.equal(getQueueLevel(24, false, true), 'amber');
  assert.equal(getQueueLevel(35, false, true), 'red');
  assert.equal(getQueueLevel(5, true, true), 'red');
  assert.equal(getQueueLevel(5, false, false), 'red');
});

test('rankHospitals separates sponsored slots and chooses Best Option strictly from organic least total time', () => {
  const slowSponsored = makeHospital({
    id: 'h-sponsored-slow',
    name: 'Sponsored Slow Eye Hospital',
    patientsWaiting: 14,
    avgConsultMinutes: 10,
    activeCounters: 1, // 140 min wait!
    is_sponsored: true,
    sponsor_rank: 1,
  });

  const fastOrganic = makeHospital({
    id: 'h-fast-organic',
    name: 'Fast Organic Eye Clinic',
    patientsWaiting: 2,
    avgConsultMinutes: 8,
    activeCounters: 2, // 8 min wait
    is_sponsored: false,
  });

  const mediumOrganic = makeHospital({
    id: 'h-med-organic',
    name: 'Medium Eye Centre',
    patientsWaiting: 8,
    avgConsultMinutes: 10,
    activeCounters: 2, // 40 min wait
    is_sponsored: false,
  });

  const result = rankHospitals({
    hospitals: [slowSponsored, mediumOrganic, fastOrganic],
    specialty: 'Eye OPD',
    city: 'Nagpur',
    userLocation: { lat: 21.135, lng: 79.08 },
    transportMode: 'car',
    sortBy: 'least_total_time',
    travelMatrixByHospitalId: {
      'h-sponsored-slow': { distanceKm: 2, travelMinutes: 10, source: 'routes_api' },
      'h-fast-organic': { distanceKm: 2, travelMinutes: 10, source: 'routes_api' },
      'h-med-organic': { distanceKm: 2, travelMinutes: 10, source: 'routes_api' },
    },
  });

  assert.equal(result.sponsored.length, 1);
  assert.equal(result.sponsored[0].hospital.id, 'h-sponsored-slow');
  assert.equal(result.organic[0].hospital.id, 'h-fast-organic');
  assert.equal(result.bestOption?.hospitalId, 'h-fast-organic');
  assert.equal(result.bestOption?.savedMinutesVsNext, 32);
});

test('calculateDepartureAdvisory detects faster queue and delay alerts', () => {
  const faster = calculateDepartureAdvisory({
    queuePosition: 3,
    avgConsultMinutes: 10,
    activeCounters: 2, // 2 ahead -> 10 min wait
    travelMinutes: 8,
    initialEstimatedWaitMinutes: 25,
  });
  assert.equal(faster.alertType, 'faster');

  const delayed = calculateDepartureAdvisory({
    queuePosition: 9,
    avgConsultMinutes: 10,
    activeCounters: 2, // 8 ahead -> 40 min wait
    travelMinutes: 10,
    initialEstimatedWaitMinutes: 20,
  });
  assert.equal(delayed.alertType, 'delay');
  assert.match(delayed.alertMessage ?? '', /leave 20 min later/);
});

test('rankHospitals isolates 2 sponsored slots per OPD specialty', () => {
  const eyeSponsored = makeHospital({
    id: 'h-eye-multi',
    name: 'Multi-Specialty Eye Sponsor',
    specialties: ['Eye OPD', 'Pediatrics'],
    is_sponsored: true,
    sponsor_rank: 1,
    sponsor_slots: {
      'Eye OPD': { rank: 1, startDate: '2026-01-01', endDate: '2027-12-31' },
    },
  });
  const pedsSponsored = makeHospital({
    id: 'h-peds-sponsor',
    name: 'Child Care Clinic',
    specialties: ['Pediatrics'],
    is_sponsored: true,
    sponsor_rank: 1,
    sponsor_slots: {
      Pediatrics: { rank: 1, startDate: '2026-01-01', endDate: '2027-12-31' },
    },
  });

  const eyeResults = rankHospitals({
    hospitals: [eyeSponsored, pedsSponsored],
    specialty: 'Eye OPD',
    city: 'Nagpur',
    userLocation: { lat: 21.135, lng: 79.08 },
    transportMode: 'car',
    sortBy: 'least_total_time',
    todayIso: '2026-11-24',
  });
  assert.equal(eyeResults.sponsored.length, 1);
  assert.equal(eyeResults.sponsored[0].hospital.id, 'h-eye-multi');
  assert.equal(eyeResults.sponsored[0].sponsorRank, 1);

  const pedsResults = rankHospitals({
    hospitals: [eyeSponsored, pedsSponsored],
    specialty: 'Pediatrics',
    city: 'Nagpur',
    userLocation: { lat: 21.135, lng: 79.08 },
    transportMode: 'car',
    sortBy: 'least_total_time',
    todayIso: '2026-11-24',
  });
  assert.equal(pedsResults.sponsored.length, 1);
  assert.equal(pedsResults.sponsored[0].hospital.id, 'h-peds-sponsor');
  assert.equal(pedsResults.sponsored[0].sponsorRank, 1);
});

test('rankHospitals expires minute-level sponsored slots automatically and isolates by city', () => {
  const startMs = Date.parse('2026-11-24T12:00:00.000Z');
  const endMs = startMs + 5 * 60_000;
  const nagpurHospital = makeHospital({
    id: 'h-ngp-demo',
    city: 'Nagpur',
    is_sponsored: true,
    sponsor_rank: 1,
    sponsor_start_date: new Date(startMs).toISOString(),
    sponsor_end_date: new Date(endMs).toISOString(),
    sponsor_slots: {
      'Eye OPD': {
        rank: 1,
        startDate: new Date(startMs).toISOString(),
        endDate: new Date(endMs).toISOString(),
      },
    },
  });
  const puneHospital = makeHospital({
    id: 'h-pune-demo',
    city: 'Pune',
    address: 'Paud Road, Kothrud, Pune',
    area: 'Kothrud',
    is_sponsored: true,
    sponsor_rank: 1,
    sponsor_slots: {
      'Eye OPD': {
        rank: 1,
        startDate: new Date(startMs).toISOString(),
        endDate: new Date(endMs).toISOString(),
      },
    },
  });

  // Active at +3 minutes, Nagpur only sees Nagpur hospital
  const activeRes = rankHospitals({
    hospitals: [nagpurHospital, puneHospital],
    specialty: 'Eye OPD',
    city: 'Nagpur',
    userLocation: { lat: 21.135, lng: 79.08 },
    transportMode: 'car',
    sortBy: 'least_total_time',
    nowMs: startMs + 3 * 60_000,
  });
  assert.equal(activeRes.sponsored.length, 1);
  assert.equal(activeRes.sponsored[0].hospital.id, 'h-ngp-demo');

  // Expired at +6 minutes -> drops back to organic only
  const expiredRes = rankHospitals({
    hospitals: [nagpurHospital, puneHospital],
    specialty: 'Eye OPD',
    city: 'Nagpur',
    userLocation: { lat: 21.135, lng: 79.08 },
    transportMode: 'car',
    sortBy: 'least_total_time',
    nowMs: startMs + 6 * 60_000,
  });
  assert.equal(expiredRes.sponsored.length, 0);
  assert.equal(expiredRes.organic.length, 1);
});

