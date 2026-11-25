  import { initializeApp } from 'firebase/app';
  import {
    getAuth,
    GoogleAuthProvider,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    signInWithPopup,
    signOut,
    type ConfirmationResult,
  } from 'firebase/auth';
  import {
    collection,
    doc,
    getDoc,
    getDocFromServer,
    getFirestore,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
  } from 'firebase/firestore';
  import firebaseConfig from '../../firebase-applet-config.json';
  import type {
    BookingRecord,
    DispensingMedicineUpdate,
    HealthVisitRecord,
    HospitalRecord,
    MedicalPrescriptionStatus,
    PatientProfile,
    RecordAuditLogEntry,
    SharedPrescriptionRecord,
    Specialty,
    SponsoredSlotStatus,
    SponsorWaitlistEntry,
  } from '../types/pinnacle';
  import { sanitizePatientProfile } from '../utils/history';
  import { makeSlotKey } from '../utils/sponsorship';

  const app = initializeApp(firebaseConfig);

  export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  export const auth = getAuth(app);
  export const googleProvider = new GoogleAuthProvider();

  export enum OperationType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    LIST = 'list',
    GET = 'get',
    WRITE = 'write',
  }

  export interface FirestoreErrorInfo {
    error: string;
    operationType: OperationType;
    path: string | null;
    authInfo: {
      userId?: string | null;
      email?: string | null;
      emailVerified?: boolean | null;
      isAnonymous?: boolean | null;
      tenantId?: string | null;
      providerInfo?: {
        providerId?: string | null;
        email?: string | null;
      }[];
    };
  }

  export function handleFirestoreError(
    error: unknown,
    operationType: OperationType,
    path: string | null
  ): never {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo:
          auth.currentUser?.providerData?.map((provider) => ({
            providerId: provider.providerId,
            email: provider.email,
          })) || [],
      },
      operationType,
      path,
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  }

  export async function testConnection(): Promise<boolean> {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error('Please check your Firebase configuration.');
        return false;
      }
      return true;
    }
  }

  // void testConnection();

  export async function signInWithGooglePopup() {
    return signInWithPopup(auth, googleProvider);
  }

  export async function logoutFirebase() {
    return signOut(auth);
  }

  export async function getFirebaseIdToken(): Promise<string | null> {
    if (!auth.currentUser) return null;
    try {
      return await auth.currentUser.getIdToken();
    } catch (err) {
      console.error('Failed to read Firebase ID token:', err);
      return null;
    }
  }

  export async function sendFirebasePhoneOtp(
    phoneE164: string,
    containerId: string
  ): Promise<ConfirmationResult> {
    const verifier = new RecaptchaVerifier(auth, containerId, {
      size: 'invisible',
    });
    return signInWithPhoneNumber(auth, phoneE164, verifier);
  }

  export async function fetchFirestorePatientProfile(uid: string): Promise<PatientProfile | null> {
    const path = `users/${uid}/private/profile`;
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'private', 'profile'));
      if (!snap.exists()) return null;
      return sanitizePatientProfile(uid, snap.data() as Partial<PatientProfile>);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  export async function saveFirestorePatientProfile(
    uid: string,
    profile: PatientProfile
  ): Promise<PatientProfile> {
    const clean = sanitizePatientProfile(uid, profile);
    const path = `users/${uid}/private/profile`;
    try {
      const payload: Record<string, unknown> = {
        uid: clean.uid,
        pid: clean.pid,
        historyConsent: clean.historyConsent ?? true,
        displayName: clean.displayName,
        email: clean.email,
        phone: clean.phone,
        gender: clean.gender,
        bloodGroup: clean.bloodGroup,
        allergies: clean.allergies,
        allergyNotes: clean.allergyNotes,
        chronicConditions: clean.chronicConditions,
        emergencyContacts: clean.emergencyContacts,
        updatedAt: serverTimestamp(),
      };
      if (typeof clean.age === 'number') {
        payload.age = clean.age;
      }
      await setDoc(doc(db, 'users', uid, 'private', 'profile'), payload);
      return clean;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  export function subscribeToApprovedHospitals(
    onUpdate: (docs: Array<Partial<HospitalRecord> & { id: string }>) => void
  ): () => void {
    const q = query(collection(db, 'hospitals'), where('status', '==', 'approved'));
    return onSnapshot(
      q,
      (snapshot) => {
        const rows: Array<Partial<HospitalRecord> & { id: string }> = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Partial<HospitalRecord>;
          rows.push({
            ...data,
            id: docSnap.id,
          });
        });
        onUpdate(rows);
      },
      (err) => {
        console.warn('Firestore hospitals listener notice:', err instanceof Error ? err.message : String(err));
      }
    );
  }

  export function subscribeToSponsoredSlots(
    city: string,
    specialty: Specialty,
    onSlotUpdate: (rank: 1 | 2, status: SponsoredSlotStatus | null) => void
  ): () => void {
    const unsubs: Array<() => void> = [];
    for (const rank of [1, 2] as const) {
      const slotKey = makeSlotKey(city, specialty, rank);
      const ref = doc(db, 'sponsored_slots', slotKey);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            onSlotUpdate(rank, null);
            return;
          }
          const data = snap.data() as Record<string, unknown>;
          const occupiedUntilMs =
            typeof data.occupiedUntilMs === 'number' ? data.occupiedUntilMs : undefined;
          const isExpired =
            data.status === 'occupied' &&
            typeof occupiedUntilMs === 'number' &&
            occupiedUntilMs <= Date.now();
          onSlotUpdate(rank, {
            slotKey,
            city: String(data.city || city),
            specialty: (data.specialty as Specialty) || specialty,
            rank,
            status: data.status === 'occupied' && !isExpired ? 'occupied' : 'available',
            occupiedUntilMs: !isExpired ? occupiedUntilMs : undefined,
            occupiedUntilIso:
              !isExpired && typeof data.occupiedUntilIso === 'string'
                ? data.occupiedUntilIso
                : undefined,
            updatedAt: Date.now(),
          });
        },
        (err) => {
          console.warn('Firestore sponsored_slots listener notice:', err instanceof Error ? err.message : String(err));
        }
      );
      unsubs.push(unsub);
    }
    return () => {
      unsubs.forEach((fn) => fn());
    };
  }

  export function subscribeToHospitalWaitlist(
    ownerUid: string,
    onUpdate: (entries: SponsorWaitlistEntry[]) => void
  ): () => void {
    if (!auth.currentUser || auth.currentUser.uid !== ownerUid) {
      return () => {};
    }
    const q = query(collection(db, 'sponsor_waitlist'), where('ownerUid', '==', ownerUid));
    return onSnapshot(
      q,
      (snapshot) => {
        const entries: SponsorWaitlistEntry[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data() as Record<string, unknown>;
          entries.push({
            id: docSnap.id,
            hospitalId: String(d.hospitalId || ''),
            ownerUid: String(d.ownerUid || ownerUid),
            city: String(d.city || 'Nagpur'),
            specialty: (d.specialty as Specialty) || 'Eye OPD',
            desiredRank: (Number(d.desiredRank) === 2 ? 2 : 1) as 1 | 2,
            status: (d.status as SponsorWaitlistEntry['status']) || 'waiting',
            createdAt: Date.now(),
            notifiedAt: typeof d.notifiedAt === 'number' ? d.notifiedAt : undefined,
            claimExpiresAt: typeof d.claimExpiresAt === 'number' ? d.claimExpiresAt : undefined,
          });
        });
        onUpdate(entries);
      },
      (err) => {
        console.warn('Firestore waitlist listener notice:', err instanceof Error ? err.message : String(err));
      }
    );
  }

  export async function commitSponsorshipTransactionToFirestore(params: {
    hospitalId: string;
    hospitalName: string;
    city: string;
    specialty: Specialty;
    rank: 1 | 2;
    orderId: string;
    paymentId: string;
    amount: number;
    mode: 'razorpay' | 'mock';
    startIso: string;
    endIso: string;
    endMs: number;
  }): Promise<{ ok: boolean; conflict?: boolean }> {
    const user = auth.currentUser;
    if (!user) return { ok: false };

    const slotKey = makeSlotKey(params.city, params.specialty, params.rank);
    const slotRef = doc(db, 'sponsored_slots', slotKey);
    const paymentRef = doc(db, 'payments', params.orderId);

    try {
      await runTransaction(db, async (tx) => {
        const slotSnap = await tx.get(slotRef);
        if (slotSnap.exists()) {
          const current = slotSnap.data() as Record<string, unknown>;
          const occupiedUntilMs =
            typeof current.occupiedUntilMs === 'number' ? current.occupiedUntilMs : 0;
          if (
            current.status === 'occupied' &&
            occupiedUntilMs > Date.now() &&
            current.hospitalId !== params.hospitalId
          ) {
            throw new Error('SLOT_TAKEN');
          }
        }

        tx.set(slotRef, {
          slotKey,
          city: params.city,
          specialty: params.specialty,
          rank: params.rank,
          status: 'occupied',
          occupiedUntilMs: params.endMs,
          occupiedUntilIso: params.endIso,
          hospitalId: params.hospitalId,
          ownerUid: user.uid,
          updatedAt: serverTimestamp(),
        });

        tx.set(paymentRef, {
          orderId: params.orderId,
          paymentId: params.paymentId,
          hospitalId: params.hospitalId,
          hospitalName: params.hospitalName,
          ownerUid: user.uid,
          city: params.city,
          specialty: params.specialty,
          rank: params.rank,
          amount: params.amount,
          currency: 'INR',
          mode: params.mode,
          status: 'paid',
          startIso: params.startIso,
          endIso: params.endIso,
          timestamp: Date.now(),
          createdAt: serverTimestamp(),
        });
      });
      return { ok: true };
    } catch (err) {
      if (err instanceof Error && err.message === 'SLOT_TAKEN') {
        return { ok: false, conflict: true };
      }
      return { ok: false };
    }
  }

  export async function syncWaitlistToFirestore(entry: SponsorWaitlistEntry): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await setDoc(doc(db, 'sponsor_waitlist', entry.id), {
        id: entry.id,
        hospitalId: entry.hospitalId,
        ownerUid: user.uid,
        city: entry.city,
        specialty: entry.specialty,
        desiredRank: entry.desiredRank,
        status: entry.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Waitlist Firestore sync skipped:', err instanceof Error ? err.message : String(err));
    }
  }

  export async function syncHealthVisitToFirestore(visit: HealthVisitRecord): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    const path = `health_visits/${visit.id}`;
    try {
      await setDoc(doc(db, 'health_visits', visit.id), {
        id: visit.id,
        bookingId: visit.bookingId,
        tokenNumber: visit.tokenNumber,
        patientUid: visit.patientUid,
        patientPid: visit.patientPid,
        patientName: visit.patientName,
        patientAge: visit.patientAge,
        patientGender: visit.patientGender,
        hospitalId: visit.hospitalId,
        hospitalName: visit.hospitalName,
        hospitalAddress: visit.hospitalAddress,
        city: visit.city,
        doctorId: visit.doctorId,
        doctorUid: user.uid,
        doctorName: visit.doctorName,
        doctorQualification: visit.doctorQualification,
        doctorRegNumber: visit.doctorRegNumber,
        doctorSpecialty: visit.doctorSpecialty,
        visitDate: visit.visitDate,
        visitTime: visit.visitTime,
        symptoms: visit.symptoms.slice(0, 500),
        diagnosis: visit.diagnosis.slice(0, 300),
        notes: visit.notes.slice(0, 500),
        followUpDate: visit.followUpDate || '',
        medicines: visit.medicines.slice(0, 25),
        consultationStatus: visit.consultationStatus,
        medicalStatus: visit.medicalStatus,
        dispensingSummary: visit.dispensingSummary || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Health visit Firestore sync skipped:', err instanceof Error ? err.message : String(err));
    }
    void path;
  }

  export async function syncRecordAuditLogToFirestore(entry: RecordAuditLogEntry): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await setDoc(doc(db, 'record_audit_logs', entry.id), {
        id: entry.id,
        patientUid: entry.patientUid,
        patientPid: entry.patientPid,
        viewerId: entry.viewerId,
        viewerUid: user.uid,
        viewerName: entry.viewerName,
        viewerRole: entry.viewerRole,
        hospitalId: entry.hospitalId,
        hospitalName: entry.hospitalName,
        bookingId: entry.bookingId,
        action: entry.action.slice(0, 200),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Audit log Firestore sync skipped:', err instanceof Error ? err.message : String(err));
    }
  }

  export function subscribeToPatientHealthVisits(
    uid: string,
    onUpdate: (visits: HealthVisitRecord[]) => void
  ): () => void {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      return () => {};
    }
    const q = query(collection(db, 'health_visits'), where('patientUid', '==', uid));
    return onSnapshot(
      q,
      (snapshot) => {
        const list: HealthVisitRecord[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data() as HealthVisitRecord;
          list.push({ ...d, id: docSnap.id });
        });
        onUpdate(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'health_visits');
      }
    );
  }

  export async function syncPrescriptionToFirestore(
    prescription: SharedPrescriptionRecord
  ): Promise<void> {
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'prescriptions', prescription.prescription_id), {
        prescription_id: prescription.prescription_id,
        visit_id: prescription.visit_id,
        booking_id: prescription.booking_id || undefined,
        token_number: prescription.token_number || '',
        patient_id: prescription.patient_id,
        patient_name: prescription.patient_name.slice(0, 120),
        patient_age: prescription.patient_age,
        patient_gender: prescription.patient_gender,
        PID: prescription.PID,
        doctor_id: prescription.doctor_id,
        doctor_name: prescription.doctor_name.slice(0, 120),
        doctor_qualification: (prescription.doctor_qualification || '').slice(0, 120),
        doctor_reg_number: (prescription.doctor_reg_number || '').slice(0, 64),
        hospital_id: prescription.hospital_id,
        hospital_name: prescription.hospital_name.slice(0, 160),
        opd_id: prescription.opd_id,
        medicines: prescription.medicines.slice(0, 25),
        symptoms: prescription.symptoms.slice(0, 500),
        diagnosis: prescription.diagnosis.slice(0, 300),
        notes: prescription.notes.slice(0, 500),
        follow_up_date: prescription.follow_up_date || '',
        status: prescription.status,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    } catch (error) {
      console.error('Prescription Firestore sync failed:', error);
    }
  }

  export async function updatePrescriptionInFirestore(
    prescriptionId: string,
    status: MedicalPrescriptionStatus,
    dispensingSummary?: string,
    dispensingDetails?: DispensingMedicineUpdate[]
  ): Promise<void> {
    if (!auth.currentUser) return;
    try {
      await updateDoc(doc(db, 'prescriptions', prescriptionId), {
        status,
        dispensing_summary: (dispensingSummary || '').slice(0, 120),
        dispensing_details: (dispensingDetails || []).slice(0, 25),
        updated_at: serverTimestamp(),
      });
    } catch (error) {
      console.error('Prescription Firestore status update failed:', error);
    }
  }

  export function subscribeToHospitalPrescriptions(
    hospitalId: string,
    onUpdate: (items: SharedPrescriptionRecord[]) => void,
    onError?: (err: unknown) => void
  ): () => void {
    if (!auth.currentUser || !hospitalId) {
      return () => {};
    }
    const q = query(
      collection(db, 'prescriptions'),
      where('hospital_id', '==', hospitalId),
      orderBy('created_at', 'desc')
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const rows: SharedPrescriptionRecord[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data() as Record<string, unknown>;
          const createdTs = d.created_at as { toMillis?: () => number } | number | undefined;
          const updatedTs = d.updated_at as { toMillis?: () => number } | number | undefined;
          rows.push({
            ...(d as unknown as SharedPrescriptionRecord),
            prescription_id: docSnap.id,
            created_at:
              typeof createdTs === 'number'
                ? createdTs
                : createdTs && typeof createdTs.toMillis === 'function'
                  ? createdTs.toMillis()
                  : Date.now(),
            updated_at:
              typeof updatedTs === 'number'
                ? updatedTs
                : updatedTs && typeof updatedTs.toMillis === 'function'
                  ? updatedTs.toMillis()
                  : Date.now(),
          });
        });
        onUpdate(rows);
      },
      (error) => {
        console.error('Firestore prescriptions listener error:', error);
        onError?.(error);
      }
    );
  }

  export async function syncQueueEntryToFirestore(entry: BookingRecord): Promise<void> {
    if (!auth.currentUser) return;
    const queueId = entry.queue_id || entry.id;
    try {
      await setDoc(doc(db, 'queue_entries', queueId), {
        queue_id: queueId,
        hospital_id: entry.hospital_id || entry.hospitalId,
        opd_id: entry.opd_id || entry.specialty,
        doctor_id: entry.doctor_id ?? entry.doctorId ?? null,
        patient_id: entry.patient_id ?? entry.patientUid ?? null,
        patient_name: entry.patientName.slice(0, 120),
        age: entry.patientAge,
        gender: entry.patientGender,
        phone: entry.patientMobile.slice(0, 20),
        PID: entry.PID ?? entry.patientPid ?? null,
        tokenNumber: entry.tokenNumber,
        tokenNumeric: entry.tokenNumeric,
        status: entry.status,
        isWalkIn: entry.isWalkIn,
        created_at: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Queue entry Firestore sync failed:', error);
    }
  }

  export function subscribeToDoctorQueue(
    hospitalId: string,
    opdId: Specialty | undefined,
    onUpdate: (entries: Array<{ queue_id: string; status: string; tokenNumber: string }>) => void,
    onError?: (err: unknown) => void
  ): () => void {
    if (!auth.currentUser || !hospitalId) {
      return () => {};
    }
    const constraints = opdId
      ? [where('hospital_id', '==', hospitalId), where('opd_id', '==', opdId)]
      : [where('hospital_id', '==', hospitalId)];
    const q = query(collection(db, 'queue_entries'), ...constraints);
    return onSnapshot(
      q,
      (snapshot) => {
        const rows: Array<{ queue_id: string; status: string; tokenNumber: string }> = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data() as Record<string, unknown>;
          rows.push({
            queue_id: docSnap.id,
            status: String(d.status || 'waiting'),
            tokenNumber: String(d.tokenNumber || ''),
          });
        });
        onUpdate(rows);
      },
      (error) => {
        console.error('Firestore doctor queue listener error:', error);
        onError?.(error);
      }
    );
  }

