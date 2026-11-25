import type {
  BloodGroup,
  BookingRecord,
  EmergencyContact,
  PatientProfile,
  PreviousDoctorSummary,
} from '../types/pinnacle';
import { deriveDeterministicPidForUid, isValidPid } from './pid';

export const BLOOD_GROUPS: BloodGroup[] = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
  'Unknown',
];

export type HistoryStatusFilter = 'all' | 'completed' | 'cancelled_or_skipped';

/**
 * Splits patient bookings into active/live-queue bookings vs historical log entries.
 */
export function partitionBookings(bookings: BookingRecord[]): {
  activeBookings: BookingRecord[];
  historyBookings: BookingRecord[];
} {
  const activeBookings: BookingRecord[] = [];
  const historyBookings: BookingRecord[] = [];

  for (const bk of bookings) {
    if (bk.status === 'waiting' || bk.status === 'called') {
      activeBookings.push(bk);
    } else {
      historyBookings.push(bk);
    }
  }

  activeBookings.sort((a, b) => b.updatedAt - a.updatedAt);
  historyBookings.sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return b.updatedAt - a.updatedAt;
  });

  return { activeBookings, historyBookings };
}

/**
 * Filters historical appointments by status bucket and search query.
 */
export function filterHistoryBookings(
  historyBookings: BookingRecord[],
  statusFilter: HistoryStatusFilter,
  searchQuery: string
): BookingRecord[] {
  const q = searchQuery.trim().toLowerCase();
  return historyBookings.filter((bk) => {
    if (statusFilter === 'completed' && bk.status !== 'completed') return false;
    if (
      statusFilter === 'cancelled_or_skipped' &&
      bk.status !== 'cancelled' &&
      bk.status !== 'skipped'
    ) {
      return false;
    }
    if (!q) return true;
    return (
      bk.doctorName.toLowerCase().includes(q) ||
      bk.hospitalName.toLowerCase().includes(q) ||
      bk.specialty.toLowerCase().includes(q) ||
      bk.reason.toLowerCase().includes(q) ||
      bk.tokenNumber.toLowerCase().includes(q)
    );
  });
}

/**
 * Extracts unique previously visited doctors across history (and past bookings) for fast 1-click re-booking.
 */
export function getUniquePreviousDoctors(bookings: BookingRecord[]): PreviousDoctorSummary[] {
  const sorted = [...bookings]
    .filter((b) => b.status === 'completed' || b.status === 'cancelled' || b.status === 'skipped')
    .sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return b.updatedAt - a.updatedAt;
    });

  const map = new Map<string, PreviousDoctorSummary>();
  for (const bk of sorted) {
    const docName = bk.doctorName.trim() || 'OPD Duty Doctor';
    const key = `${bk.hospitalId}::${docName.toLowerCase()}::${bk.specialty}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        hospitalId: bk.hospitalId,
        hospitalName: bk.hospitalName,
        doctorName: docName,
        specialty: bk.specialty,
        lastVisitDate: bk.date,
        visitCount: 1,
        lastStatus: bk.status,
      });
    } else {
      existing.visitCount += 1;
    }
  }

  return Array.from(map.values());
}

/**
 * Sanitizes and enforces strict volumetric bounds matching firebase-blueprint.json & firestore.rules.
 */
export function sanitizePatientProfile(
  uid: string,
  input: Partial<PatientProfile>
): PatientProfile {
  const validBlood = BLOOD_GROUPS.includes(input.bloodGroup as BloodGroup)
    ? (input.bloodGroup as BloodGroup)
    : 'Unknown';

  const validGender: 'Male' | 'Female' | 'Other' =
    input.gender === 'Female' || input.gender === 'Other' ? input.gender : 'Male';

  const cleanAllergies: string[] = [];
  if (Array.isArray(input.allergies)) {
    const seen = new Set<string>();
    for (const raw of input.allergies) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim().slice(0, 60);
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase());
        cleanAllergies.push(trimmed);
      }
      if (cleanAllergies.length >= 15) break;
    }
  }

  const cleanContacts: EmergencyContact[] = [];
  if (Array.isArray(input.emergencyContacts)) {
    for (const c of input.emergencyContacts) {
      if (!c || typeof c !== 'object') continue;
      const name = String(c.name || '').trim().slice(0, 80);
      const relation = String(c.relation || 'Family').trim().slice(0, 40);
      const phone = String(c.phone || '').trim().slice(0, 20);
      if (name.length >= 2 && phone.length >= 10) {
        cleanContacts.push({ name, relation: relation.length >= 2 ? relation : 'Family', phone });
      }
      if (cleanContacts.length >= 3) break;
    }
  }

  const rawAge = typeof input.age === 'number' ? input.age : Number(input.age);
  const cleanAge =
    Number.isFinite(rawAge) && rawAge >= 0 && rawAge <= 120 ? Math.round(rawAge) : undefined;

  const cleanUid = uid.trim().slice(0, 128) || 'demo-patient';
  const rawPid = typeof input.pid === 'string' ? input.pid.trim() : '';
  const resolvedPid = rawPid && isValidPid(rawPid) ? rawPid : deriveDeterministicPidForUid(cleanUid);
  const resolvedConsent =
    typeof input.historyConsent === 'boolean' ? input.historyConsent : true;

  return {
    uid: cleanUid,
    pid: resolvedPid,
    historyConsent: resolvedConsent,
    displayName: String(input.displayName || 'Patient').trim().slice(0, 120) || 'Patient',
    email: String(input.email || '').trim().slice(0, 160),
    phone: String(input.phone || '').trim().slice(0, 20),
    age: cleanAge,
    gender: validGender,
    bloodGroup: validBlood,
    allergies: cleanAllergies,
    allergyNotes: String(input.allergyNotes || '').trim().slice(0, 300),
    chronicConditions: String(input.chronicConditions || '').trim().slice(0, 300),
    emergencyContacts: cleanContacts,
    updatedAt: Date.now(),
  };
}
