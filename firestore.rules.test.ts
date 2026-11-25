import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesContent = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

test('firestore.rules includes default-deny global safety net as first match block', () => {
  assert.match(rulesContent, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
});

test('firestore.rules enforces Eight Pillars helpers and strict validation', () => {
  assert.match(rulesContent, /function isValidId\(id\)/);
  assert.match(rulesContent, /function isValidHospital\(data\)/);
  assert.match(rulesContent, /function isValidBooking\(data\)/);
  assert.match(rulesContent, /function isValidUserPrivate\(data, userId\)/);
  assert.match(rulesContent, /affectedKeys\(\)\.hasOnly/);
  assert.match(rulesContent, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesContent, /incoming\(\)\.createdAt == request\.time/);
});

test('firestore.rules isolates PII and enforces query boundaries on list', () => {
  assert.match(rulesContent, /match \/users\/\{userId\}\/private\/\{docId\}/);
  assert.match(rulesContent, /bloodGroup in \['A\+'/);
  assert.match(rulesContent, /data\.allergies\.size\(\) <= 15/);
  assert.match(rulesContent, /data\.emergencyContacts\.size\(\) <= 3/);
  assert.match(rulesContent, /'sponsor_slots'/);
  assert.match(rulesContent, /data\.sponsor_slots is map && data\.sponsor_slots\.size\(\) <= 12/);
  assert.match(rulesContent, /match \/private\/\{docId\}/);
  assert.match(rulesContent, /allow list: if isSignedIn\(\) && \(\s*existing\(\)\.patientUid == request\.auth\.uid/);
});

test('firestore.rules secures sponsored_slots, sponsor_waitlist, and payments', () => {
  assert.match(rulesContent, /match \/sponsored_slots\/\{slotKey\}/);
  assert.match(rulesContent, /function isValidSponsoredSlot\(data\)/);
  assert.match(rulesContent, /match \/sponsor_waitlist\/\{waitlistId\}/);
  assert.match(rulesContent, /function isValidWaitlistEntry\(data\)/);
  assert.match(rulesContent, /match \/payments\/\{orderId\}/);
  assert.match(rulesContent, /function isValidPaymentRecord\(data\)/);
  assert.match(rulesContent, /allow update, delete: if isValidId\(orderId\) && isAdmin\(\);/);
});

test('firestore.rules enforces Digital Health Records role isolation, consent, and audit immutability', () => {
  assert.match(rulesContent, /match \/hospital_staff\/\{staffId\}/);
  assert.match(rulesContent, /function isValidHospitalStaff\(data\)/);
  assert.match(rulesContent, /match \/health_visits\/\{visitId\}/);
  assert.match(rulesContent, /function patientHasConsent\(patientUid\)/);
  assert.match(rulesContent, /match \/medical_prescriptions\/\{prescriptionId\}/);
  assert.match(rulesContent, /match \/dispensing_records\/\{recordId\}/);
  assert.match(rulesContent, /match \/record_audit_logs\/\{logId\}/);
  assert.match(rulesContent, /allow update, delete: if isValidId\(logId\) && isAdmin\(\);/);
});

test('firestore.rules enforces OWNER_EMAIL access, queue_entries OPD isolation, and shared prescriptions', () => {
  assert.match(rulesContent, /function isVerifiedOwnerEmail\(\)/);
  assert.match(rulesContent, /request\.auth\.token\.email == 'swapnilkorade0203@gmail\.com'/);
  assert.match(rulesContent, /match \/queue_entries\/\{queueId\}/);
  assert.match(rulesContent, /function isValidQueueEntry\(data\)/);
  assert.match(rulesContent, /match \/prescriptions\/\{prescriptionId\}/);
  assert.match(rulesContent, /function isValidPrescription\(data\)/);
  assert.match(rulesContent, /isStaffRoleForHospital\('doctor', incoming\(\)\.hospital_id\)/);
  assert.match(rulesContent, /isStaffRoleForHospital\('medical', existing\(\)\.hospital_id\)/);
});

