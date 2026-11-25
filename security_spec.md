# Pinnacle Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Default Deny**: Unmatched collections and operations are denied by default.
2. **Hospital Ownership & Approval**: New hospital registrations MUST start with `status == 'pending'`, `is_sponsored == false`, and `ownerUid == request.auth.uid`. Only an Admin can approve/reject or modify `is_sponsored`, `sponsor_rank`, `sponsor_start_date`, `sponsor_end_date`.
3. **Hospital Queue Operations**: Only the hospital's `ownerUid` or an Admin can update live queue metrics (`patientsWaiting`, `isPaused`, `activeCounters`, `avgConsultMinutes`, `openNow`, `opdTimings`, `updatedAt`).
4. **Booking Ownership & Terminal Locking**: A patient can only create a booking with `patientUid == request.auth.uid`, `consentGiven == true`, `status == 'waiting'`, and a valid existing `hospitalId`. Once a booking reaches a terminal status (`completed` or `cancelled`), non-admins cannot mutate it.
5. **PII Isolation**: User private info (`/users/{userId}/private/{docId}`) and hospital contact person PII (`/hospitals/{hospitalId}/private/{docId}`) are readable only by the owner or an admin. Bookings list queries require `resource.data.patientUid == request.auth.uid` (or admin / hospital owner).
6. **Temporal Integrity**: `createdAt` and `updatedAt` must match `request.time`, and `createdAt` is immutable on update.
7. **Admin Spoof Protection**: Admin email fallback requires `request.auth.token.email_verified == true`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Self-Approval Attack**: User creates `/hospitals/h1` with `status: "approved"`.
2. **Self-Sponsorship Attack**: Hospital owner updates `/hospitals/h1` with `is_sponsored: true, sponsor_rank: 1`.
3. **Ghost Field Shadow Write**: Hospital owner updates `/hospitals/h1` with `{ patientsWaiting: 5, secretAdminNote: "hacked", updatedAt: serverTime }`.
4. **Oversized ID Poisoning**: User creates `/bookings/${"a".repeat(300)}` -> rejected by `isValidId()`.
5. **Email Spoofing Admin**: Token has `email: "mayurkorade276@gmail.com"` with `email_verified: false` -> rejected by `isAdmin()`.
6. **Impersonated Booking**: User A creates `/bookings/b1` with `patientUid: "userB"`.
7. **Orphaned Booking**: User creates `/bookings/b1` referencing nonexistent `hospitalId: "nonexistent_hosp"`.
8. **Terminal State Resurrection**: Patient updates `/bookings/b1` where `existing().status == "completed"` back to `status: "waiting"`.
9. **Timestamp Forgery**: User creates `/bookings/b1` with `createdAt: Timestamp(2020-01-01)`.
10. **PII Blanket Read**: User B calls `get(/users/userA/private/info)` -> denied.
11. **Unfiltered Bookings Scrape**: User A calls `list(/bookings)` without matching `patientUid == request.auth.uid` -> denied.
12. **Array Exhaustion**: User creates `/hospitals/h1` with `specialties` array of 50 strings -> rejected by `.size() <= 12`.

## 3. Digital Health Records Role & Privacy Invariants
8. **No Staff Self-Registration**: `/hospital_staff/{staffId}` creation is permitted ONLY by the hospital's `ownerUid` or an Admin, never by the staff member themselves.
9. **Active-Queue & Consent Gating**: Doctors can read a patient's `/health_visits/{visitId}` ONLY if the doctor holds a verified staff record for their hospital, a booking exists linking that patient to an active queue entry (`waiting` or `called`) at that hospital, AND the patient's `historyConsent == true`.
10. **Medical Pharmacy Isolation**: Medical staff can read and update `/medical_prescriptions/{prescriptionId}` and create `/dispensing_records/{recordId}` ONLY for their own linked `hospitalId`.
11. **Append-Only Audit Logs**: `/record_audit_logs/{logId}` entries are immutable (`allow update, delete: if false` for non-admins) and readable only by the patient (`existing().patientUid == request.auth.uid`) or Admin.
12. **Queue Immutability from Doctor/Medical Actions**: Only hospital owners (`hospitalOwnerUid == request.auth.uid` or verified `OWNER_EMAIL`) or Admin can modify `/bookings/{bookingId}` or `/queue_entries/{queueId}` queue counts and statuses.

## 4. Owner Isolation, OPD Queues & Shared Prescriptions
13. **Verified Owner Access**: Hospital Desk management is restricted to verified `OWNER_EMAIL` (`swapnilkorade0203@gmail.com` with `email_verified == true`) or Admin.
14. **OPD Queue Entries**: `/queue_entries/{queueId}` stores `queue_id`, `hospital_id`, `opd_id`, `doctor_id`, `patient_id`, `PID`, `tokenNumber`, `status`, and `created_at`. Only verified Owner or Admin can add walk-ins, call next, mark done, skip, or pause an OPD. Doctors can read active queue entries only for their own `hospital_id`.
15. **Shared Prescriptions**: `/prescriptions/{prescriptionId}` is written only by a verified Doctor belonging to `hospital_id` with initial `status == 'New'` and server timestamps. Only Medical staff belonging to the same `hospital_id` (or Admin) can read and update `status`, `dispensing_summary`, `dispensing_details`, and `updated_at` on that document.

