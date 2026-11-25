import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { ShieldAlert } from 'lucide-react';
import {
  auth,
  getFirebaseIdToken,
  logoutFirebase,
  subscribeToApprovedHospitals,
} from './lib/firebase';
import { Navbar, type ActiveTab } from './components/Navbar';
import { HomeSearchView } from './components/HomeSearchView';
import { BookingModal } from './components/BookingModal';
import { MyAppointmentsView } from './components/MyAppointmentsView';
import { MyHealthRecordsView } from './components/MyHealthRecordsView';
import { MyProfileView } from './components/MyProfileView';
import { HospitalRegisterView } from './components/HospitalRegisterView';
import { HospitalDashboardView } from './components/HospitalDashboardView';
import { DoctorWorkspaceView } from './components/DoctorWorkspaceView';
import { MedicalWorkspaceView } from './components/MedicalWorkspaceView';
import { AdminPanelView } from './components/AdminPanelView';
import { LoginModal, type LoginTab } from './components/LoginModal';
import { LegalModal } from './components/LegalModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NAGPUR_CENTER, rankHospitals } from './utils/ranking';
import { sanitizePatientProfile } from './utils/history';
import { t } from './utils/i18n';
import type {
  ActiveStaffSession,
  BookingRecord,
  Coordinates,
  DoctorCompletionNotice,
  EmailNotificationPreview,
  HealthVisitRecord,
  HospitalRecord,
  Language,
  PatientAuthSession,
  PatientProfile,
  RankedHospital,
  RecordAuditLogEntry,
  ResetDataResult,
  SortOption,
  Specialty,
  SponsoredConfig,
  SponsorWaitlistEntry,
  TransportMode,
  TravelEstimate,
} from './types/pinnacle';

type PendingPostLoginAction =
  | { type: 'tab'; tab: ActiveTab }
  | {
      type: 'book';
      item: RankedHospital;
      initialDoctorName?: string;
      initialSpecialty?: Specialty;
    };

function resolveTabFromLocation(): ActiveTab {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  const queryTab = (params.get('tab') || '').toLowerCase();
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  const candidate = queryTab || hash || path;

  if (candidate === '/admin' || candidate === 'admin') return 'admin';
  if (
    candidate === '/hospital-desk' ||
    candidate === '/hospital_desk' ||
    candidate === 'hospital-desk' ||
    candidate === 'hospital_desk'
  ) {
    return 'hospital_desk';
  }
  if (candidate === '/doctor' || candidate === 'doctor' || candidate === 'doctor_workspace') {
    return 'doctor_workspace';
  }
  if (candidate === '/medical' || candidate === 'medical' || candidate === 'medical_workspace') {
    return 'medical_workspace';
  }
  if (candidate === '/appointments' || candidate === 'appointments') return 'appointments';
  if (candidate === '/records' || candidate === 'records') return 'records';
  if (candidate === '/profile' || candidate === 'profile') return 'profile';
  if (candidate === '/register' || candidate === 'register') return 'register';
  return 'search';
}

function getPathForTab(tab: ActiveTab): string {
  switch (tab) {
    case 'admin':
      return '/admin';
    case 'hospital_desk':
      return '/hospital-desk';
    case 'doctor_workspace':
      return '/doctor';
    case 'medical_workspace':
      return '/medical';
    case 'appointments':
      return '/appointments';
    case 'records':
      return '/records';
    case 'profile':
      return '/profile';
    case 'register':
      return '/register';
    default:
      return '/';
  }
}

export default function App() {
  const [activeTab, setActiveTabState] = useState<ActiveTab>(() => resolveTabFromLocation());
  const [language, setLanguage] = useState<Language>('en');

  // Auth state (tokens stored strictly in React memory, never localStorage)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [patientSession, setPatientSession] = useState<PatientAuthSession | null>(null);
  const [otpUser, setOtpUser] = useState<{ name: string; uid: string; phone?: string } | null>(null);
  const [staffSession, setStaffSession] = useState<ActiveStaffSession | null>(null);

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginInitialTab, setLoginInitialTab] = useState<LoginTab>('patient');
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingPostLoginAction | null>(null);

  // Legal modal
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null);

  // Google Maps quota banner state
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  // Search & ranking state
  const [specialty, setSpecialty] = useState<Specialty | 'All'>('Eye OPD');
  const [city, setCity] = useState('Nagpur');
  const [userLocation, setUserLocation] = useState<Coordinates>(NAGPUR_CENTER);
  const [transportMode, setTransportMode] = useState<TransportMode>('car');
  const [sortBy, setSortBy] = useState<SortOption>('least_total_time');
  const [openNowOnly, setOpenNowOnly] = useState(false);

  // Data state
  const [hospitals, setHospitals] = useState<HospitalRecord[]>([]);
  const [firestorePatches, setFirestorePatches] = useState<Record<string, Partial<HospitalRecord>>>(
    {}
  );
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [emailPreviews, setEmailPreviews] = useState<EmailNotificationPreview[]>([]);
  const [waitlist, setWaitlist] = useState<SponsorWaitlistEntry[]>([]);
  const [doctorCompletionNotices, setDoctorCompletionNotices] = useState<DoctorCompletionNotice[]>([]);
  const [healthVisits, setHealthVisits] = useState<HealthVisitRecord[]>([]);
  const [recordAuditLogs, setRecordAuditLogs] = useState<RecordAuditLogEntry[]>([]);
  const [healthRefreshSignal, setHealthRefreshSignal] = useState(0);
  const [sponsoredConfig, setSponsoredConfig] = useState<SponsoredConfig>({
    priceRank1: 999,
    priceRank2: 699,
    durationMinutes: 10080,
    paymentMode: 'mock',
  });
  const [travelMatrixByHospitalId, setTravelMatrixByHospitalId] = useState<
    Record<string, TravelEstimate>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookingTarget, setBookingTarget] = useState<{
    item: RankedHospital;
    initialDoctorName?: string;
    initialSpecialty?: Specialty;
  } | null>(null);
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const setActiveTab = useCallback((next: ActiveTab) => {
    setActiveTabState(next);
    const targetPath = getPathForTab(next);
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, '', targetPath);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setActiveTabState(resolveTabFromLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Listen to Google Maps Platform quota events
  useEffect(() => {
    const onQuota = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  // Listen to Firebase Auth state & resolve server-verified Owner/Admin/Patient roles
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setIsOwner(false);
        setIsAdmin(false);
        setAuthInitialized(true);
        return;
      }

      try {
        const token = await user.getIdToken();
        const sessionRes = await fetch('/api/auth/session', {
          headers: { Authorization: `Bearer ${token}` },
        });
        let ownerFlag = false;
        let adminFlag = false;
        if (sessionRes.ok) {
          const data = await sessionRes.json();
          ownerFlag = Boolean(data.isOwner);
          adminFlag = Boolean(data.isAdmin);
        }
        setIsOwner(ownerFlag);
        setIsAdmin(adminFlag);

        if (!ownerFlag && !adminFlag) {
          const ensureRes = await fetch('/api/patients/ensure', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              uid: user.uid,
              displayName: user.displayName || 'Patient',
              email: user.email || '',
              phone: user.phoneNumber || '',
            }),
          });
          if (ensureRes.ok) {
            const ensureData = await ensureRes.json();
            if (ensureData.profile) {
              setPatientProfile(ensureData.profile);
            }
          }
        }
      } catch (err) {
        console.error('Failed to verify Firebase session:', err);
        setIsOwner(false);
        setIsAdmin(false);
      } finally {
        setAuthInitialized(true);
      }
    });
    return () => unsub();
  }, []);

  // Tick every 5s to keep "last updated X sec ago" fresh
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const currentPatientUid =
    patientSession?.uid ||
    otpUser?.uid ||
    (firebaseUser && !isOwner && !isAdmin ? firebaseUser.uid : null);

  const isPatientSignedIn = Boolean(currentPatientUid);

  const userLabel =
    staffSession?.name ||
    (isAdmin ? `Admin (${firebaseUser?.email})` : null) ||
    (isOwner ? `Owner (${firebaseUser?.email})` : null) ||
    patientSession?.displayName ||
    firebaseUser?.displayName ||
    firebaseUser?.email ||
    firebaseUser?.phoneNumber ||
    otpUser?.name ||
    null;

  // Execute pending post-login action once authentication resolves
  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction.type === 'book' && isPatientSignedIn) {
      setBookingTarget({
        item: pendingAction.item,
        initialDoctorName: pendingAction.initialDoctorName,
        initialSpecialty: pendingAction.initialSpecialty,
      });
      setPendingAction(null);
      setLoginNotice(null);
      return;
    }
    if (pendingAction.type === 'tab') {
      const targetTab = pendingAction.tab;
      const allowed =
        targetTab === 'search' ||
        targetTab === 'register' ||
        (targetTab === 'admin' && isAdmin) ||
        (targetTab === 'hospital_desk' && isOwner) ||
        (targetTab === 'doctor_workspace' && staffSession?.role === 'doctor') ||
        (targetTab === 'medical_workspace' && staffSession?.role === 'medical') ||
        ((targetTab === 'appointments' || targetTab === 'profile' || targetTab === 'records') &&
          isPatientSignedIn);

      if (allowed) {
        setActiveTab(targetTab);
        setPendingAction(null);
        setLoginNotice(null);
      }
    }
  }, [pendingAction, isPatientSignedIn, isAdmin, isOwner, staffSession, setActiveTab]);

  const fetchOverview = useCallback(async () => {
    try {
      const idToken = firebaseUser ? await getFirebaseIdToken() : null;

      if (isAdmin && idToken) {
        const res = await fetch('/api/admin/overview', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) throw new Error('Failed to load admin overview.');
        const data = await res.json();
        setHospitals(data.hospitals || []);
        setBookings(data.bookings || []);
        setEmailPreviews(data.emailPreviews || []);
        if (Array.isArray(data.waitlist)) setWaitlist(data.waitlist);
        if (Array.isArray(data.doctorCompletionNotices)) {
          setDoctorCompletionNotices(data.doctorCompletionNotices);
        }
        if (data.sponsoredConfig) setSponsoredConfig(data.sponsoredConfig);
        setError(null);
        return;
      }

      // Public directory load (approved hospitals + waitlist + sponsorship config)
      const dirRes = await fetch('/api/directory');
      if (!dirRes.ok) throw new Error('Failed to load Pinnacle directory.');
      const dirData = await dirRes.json();
      setHospitals(dirData.hospitals || []);
      if (Array.isArray(dirData.waitlist)) setWaitlist(dirData.waitlist);
      if (dirData.sponsoredConfig) setSponsoredConfig(dirData.sponsoredConfig);

      if (isOwner && idToken) {
        const bkRes = await fetch('/api/bookings', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (bkRes.ok) {
          const bkData = await bkRes.json();
          setBookings(bkData.bookings || []);
        }
      } else if (currentPatientUid) {
        const bkRes = await fetch(
          `/api/bookings?patientUid=${encodeURIComponent(currentPatientUid)}`
        );
        if (bkRes.ok) {
          const bkData = await bkRes.json();
          setBookings(bkData.bookings || []);
        }
      } else {
        setBookings([]);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch live OPD data.');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, isAdmin, isOwner, currentPatientUid]);

  const runExpiryCheck = useCallback(async () => {
    try {
      const res = await fetch('/api/sponsored/expire-check', { method: 'POST' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.changed) {
        if (Array.isArray(data.hospitals)) setHospitals(data.hospitals);
        if (Array.isArray(data.waitlist)) setWaitlist(data.waitlist);
      }
    } catch {
      // ignore transient errors
    }
  }, []);

  // Initial load + 30s expiry & polling + live SSE + Firestore real-time hospital listener
  useEffect(() => {
    void fetchOverview();
    void runExpiryCheck();

    const poll = setInterval(() => {
      void runExpiryCheck();
      void fetchOverview();
    }, 30_000);

    const sse = new EventSource('/api/stream');
    sse.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type !== 'connected') {
          void fetchOverview();
          setHealthRefreshSignal((n) => n + 1);
        }
      } catch {
        // ignore malformed heartbeat
      }
    };

    const unsubHospitals = subscribeToApprovedHospitals((docsList) => {
      const nextMap: Record<string, Partial<HospitalRecord>> = {};
      for (const item of docsList) {
        if (item.id) {
          nextMap[item.id] = item;
        }
      }
      setFirestorePatches(nextMap);
    });

    return () => {
      clearInterval(poll);
      sse.close();
      unsubHospitals();
    };
  }, [fetchOverview, runExpiryCheck]);

  const mergedHospitals = useMemo(() => {
    if (Object.keys(firestorePatches).length === 0) return hospitals;
    return hospitals.map((h) => {
      const patch = firestorePatches[h.id];
      if (!patch) return h;
      const patchUpdated = patch.lastUpdatedAt ?? 0;
      if (patchUpdated > h.lastUpdatedAt) {
        return { ...h, ...patch };
      }
      return h;
    });
  }, [hospitals, firestorePatches]);

  const hospitalCoordsSignature = useMemo(
    () => hospitals.map((h) => `${h.id}:${h.lat.toFixed(4)},${h.lng.toFixed(4)}`).join('|'),
    [hospitals]
  );

  // Fetch travel matrix only when origin, transport mode, or hospital coordinates change
  const refreshTravelMatrix = useCallback(async () => {
    if (!hospitalCoordsSignature) return;
    const ids = hospitalCoordsSignature.split('|').map((entry) => entry.split(':')[0]);
    try {
      const res = await fetch('/api/maps/route-matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: userLocation,
          mode: transportMode,
          hospitalIds: ids,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.quotaExceeded) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        if (data.estimates) {
          setTravelMatrixByHospitalId(data.estimates);
        }
      }
    } catch {
      // Fallback handled transparently by rankHospitals()
    }
  }, [hospitalCoordsSignature, userLocation, transportMode]);

  useEffect(() => {
    void refreshTravelMatrix();
  }, [refreshTravelMatrix]);

  const ranked = useMemo(() => {
    return rankHospitals({
      hospitals: mergedHospitals,
      specialty,
      city,
      userLocation,
      transportMode,
      sortBy,
      openNowOnly,
      travelMatrixByHospitalId,
      nowMs,
    });
  }, [
    mergedHospitals,
    specialty,
    city,
    userLocation,
    transportMode,
    sortBy,
    openNowOnly,
    travelMatrixByHospitalId,
    nowMs,
  ]);

  const fetchPatientHealthRecords = useCallback(async () => {
    if (!currentPatientUid) {
      setHealthVisits([]);
      setRecordAuditLogs([]);
      return;
    }
    try {
      const res = await fetch(`/api/health-records/${encodeURIComponent(currentPatientUid)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.visits)) setHealthVisits(data.visits);
      if (Array.isArray(data.auditLogs)) setRecordAuditLogs(data.auditLogs);
    } catch {
      // ignore transient error
    }
  }, [currentPatientUid]);

  useEffect(() => {
    void fetchPatientHealthRecords();
  }, [fetchPatientHealthRecords, healthRefreshSignal]);

  // Load patient profile for signed-in patient (no seeded/demo fallback when logged out)
  useEffect(() => {
    let cancelled = false;
    if (!currentPatientUid) {
      setPatientProfile(null);
      return;
    }

    async function loadProfile(uid: string) {
      let loaded: PatientProfile | null = null;

      

      if (!loaded) {
        try {
          
const profileToken =
  patientSession?.uid === uid
    ? patientSession.token
    : firebaseUser?.uid === uid
      ? await getFirebaseIdToken()
      : null;

const res = await fetch(
  `/api/profile/${encodeURIComponent(uid)}`,
  {
    headers: {
      ...(profileToken
        ? { Authorization: `Bearer ${profileToken}` }
        : {}),
    },
  }
);

          if (res.ok) {
            const data = await res.json();
            if (data.profile) loaded = data.profile;
          }
        } catch {
          // ignore network hiccup
        }
      }

      if (!cancelled && loaded) {
        setPatientProfile(loaded);
      }
    }

    void loadProfile(currentPatientUid);
    return () => {
      cancelled = true;
    };
  }, [currentPatientUid, firebaseUser, patientSession]);


const handleSaveProfile = async (updated: PatientProfile) => {
  if (!currentPatientUid) {
    throw new Error('Please sign in to save your patient profile.');
  }

  const clean = sanitizePatientProfile(currentPatientUid, updated);

  const profileToken =
    patientSession?.uid === currentPatientUid
      ? patientSession.token
      : firebaseUser?.uid === currentPatientUid
        ? await getFirebaseIdToken()
        : null;

  const res = await fetch(
    `/api/profile/${encodeURIComponent(currentPatientUid)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(profileToken
          ? { Authorization: `Bearer ${profileToken}` }
          : {}),
      },
      body: JSON.stringify(clean),
    }
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Could not save patient profile.');
  }

  const data = await res.json();
  const saved: PatientProfile = data.profile || clean;

  setPatientProfile(saved);
};


  const activeBookingsCount = bookings.filter(
    (b) => b.status === 'waiting' || b.status === 'called'
  ).length;

  const openLoginWithIntent = (
    tab: LoginTab,
    notice: string | null,
    intent?: PendingPostLoginAction
  ) => {
    setLoginInitialTab(tab);
    setLoginNotice(notice);
    setPendingAction(intent ?? null);
    setLoginOpen(true);
  };

  const handleSelectNavTab = (tab: ActiveTab) => {
    if (
      (tab === 'profile' || tab === 'appointments' || tab === 'records') &&
      !isPatientSignedIn
    ) {
      openLoginWithIntent(
        'patient',
        'Please sign in or register as a patient to access your appointments, profile, and health records.',
        { type: 'tab', tab }
      );
      return;
    }
    setActiveTab(tab);
  };

  const handleStartBooking = (
    item: RankedHospital,
    initialDoctorName?: string,
    initialSpecialty?: Specialty
  ) => {
    if (!isPatientSignedIn) {
      openLoginWithIntent(
        'patient',
        'Please login or register to book an OPD appointment and receive your live token.',
        { type: 'book', item, initialDoctorName, initialSpecialty }
      );
      return;
    }
    setBookingTarget({ item, initialDoctorName, initialSpecialty });
  };

  const handleQueueAction = async (
    hospitalId: string,
    payload: {
      action:
        | 'add_walk_in'
        | 'call_next'
        | 'mark_done'
        | 'skip'
        | 'toggle_pause'
        | 'toggle_doctor'
        | 'update_settings';
      opd_id?: Specialty;
      bookingId?: string;
      doctorId?: string;
      avgConsultMinutes?: number;
      opdTimings?: string;
      consultationFee?: number;
    }
  ) => {
    const token = await getFirebaseIdToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`/api/hospitals/${hospitalId}/queue`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Could not update queue.');
    }
    await fetchOverview();
  };

  const handleAdminUpdateHospital = async (
    hospitalId: string,
    payload: {
      status?: 'pending' | 'approved' | 'rejected';
      is_sponsored?: boolean;
      sponsor_rank?: 1 | 2;
      sponsor_start_date?: string;
      sponsor_end_date?: string;
    }
  ) => {
    const token = await getFirebaseIdToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`/api/hospitals/${hospitalId}/admin`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      await fetchOverview();
    }
  };

  const handleAssignSponsoredSlot = async (payload: {
    city: string;
    specialty: Specialty;
    rank: 1 | 2;
    hospitalId: string | null;
    startDate?: string;
    endDate?: string;
  }) => {
    const token = await getFirebaseIdToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch('/api/admin/sponsored-slot', {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Could not update OPD sponsored slot.');
    }
    await fetchOverview();
  };

  const handleResetAllData = async (): Promise<ResetDataResult> => {
    const token = await getFirebaseIdToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch('/api/admin/reset-data', {
      method: 'POST',
      headers,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to reset platform data.');
    }
    await fetchOverview();
    setHealthRefreshSignal((n) => n + 1);
    return data as ResetDataResult;
  };

  const handleCancelBooking = async (bookingId: string) => {
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    if (res.ok) {
      await fetchOverview();
    }
  };

  const handleRescheduleBooking = async (
    bookingId: string,
    newDate: string,
    newSlot: string
  ) => {
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reschedule', date: newDate, timeSlot: newSlot }),
    });
    if (res.ok) {
      await fetchOverview();
    }
  };

  const handleRebookDoctor = (target: {
    hospitalId: string;
    doctorName: string;
    specialty: Specialty;
  }) => {
    const matchedHospital = hospitals.find((h) => h.id === target.hospitalId);
    if (!matchedHospital) {
      setActiveTab('search');
      return;
    }
    const rankedMatch = rankHospitals({
      hospitals: [matchedHospital],
      specialty: 'All',
      city: '',
      userLocation,
      transportMode,
      sortBy: 'least_total_time',
      openNowOnly: false,
      travelMatrixByHospitalId,
    });
    const rankedItem = rankedMatch.organic[0] ?? rankedMatch.sponsored[0];
    if (rankedItem) {
      handleStartBooking(rankedItem, target.doctorName, target.specialty);
    }
  };

  const handleLogoutAll = async () => {
    if (staffSession) {
      await fetch('/api/staff/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${staffSession.token}` },
      }).catch(() => {});
      setStaffSession(null);
    }
    if (patientSession) {
      await fetch('/api/patients/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${patientSession.token}` },
      }).catch(() => {});
      setPatientSession(null);
    }
    setOtpUser(null);
    setIsOwner(false);
    setIsAdmin(false);
    setPatientProfile(null);
    setBookings([]);
    setHealthVisits([]);
    setRecordAuditLogs([]);
    await logoutFirebase();
    setActiveTab('search');
  };

  const renderAccessDenied = (reason: string, suggestedLogin: LoginTab = 'owner_admin') => (
    <div
      className="max-w-lg mx-auto bg-white border border-[#FECACA] rounded-md p-6 text-center space-y-3"
      data-testid="access-denied-view"
    >
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#FEF2F2] text-[#B91C1C]">
        <ShieldAlert className="w-5 h-5" aria-hidden="true" />
      </div>
      <h1 className="text-lg font-bold text-[#111827]">Access denied</h1>
      <p className="text-sm text-[#4B5563]">{reason}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <button
          type="button"
          onClick={() => openLoginWithIntent(suggestedLogin, reason, { type: 'tab', tab: activeTab })}
          className="px-4 py-2 text-xs font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87]"
        >
          Sign in with authorized account
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('search')}
          className="px-4 py-2 text-xs font-medium border border-[#D1D5DB] text-[#374151] rounded hover:bg-[#F5F6F8]"
        >
          Back to Search
        </button>
      </div>
    </div>
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col bg-[#F5F6F8] text-[#111827]">
        {/* Required Google Maps Demo Key Quota Banner */}
        {gmpQuotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}

        <Navbar
          activeTab={activeTab}
          onSelectTab={handleSelectNavTab}
          language={language}
          onChangeLanguage={setLanguage}
          userLabel={userLabel}
          isPatientSignedIn={isPatientSignedIn}
          isOwner={isOwner}
          isAdmin={isAdmin}
          staffRole={staffSession?.role ?? null}
          onOpenLogin={() => openLoginWithIntent('patient', null)}
          onLogout={() => void handleLogoutAll()}
          appointmentCount={activeBookingsCount}
        />

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-6">
          {activeTab === 'search' && (
            <HomeSearchView
              language={language}
              specialty={specialty}
              onChangeSpecialty={setSpecialty}
              city={city}
              onChangeCity={setCity}
              userLocation={userLocation}
              onChangeUserLocation={(coords) => setUserLocation(coords)}
              transportMode={transportMode}
              onChangeTransportMode={setTransportMode}
              sortBy={sortBy}
              onChangeSortBy={setSortBy}
              openNowOnly={openNowOnly}
              onChangeOpenNowOnly={setOpenNowOnly}
              sponsored={ranked.sponsored}
              organic={ranked.organic}
              bestOption={ranked.bestOption}
              loading={loading}
              error={error}
              onSearch={() => {
                void fetchOverview();
                void refreshTravelMatrix();
              }}
              onBook={(item) => handleStartBooking(item)}
              nowMs={nowMs}
              quotaExceeded={gmpQuotaExceeded}
            />
          )}

          {activeTab === 'appointments' &&
            (isPatientSignedIn ? (
              <MyAppointmentsView
                bookings={bookings}
                hospitals={mergedHospitals}
                userLocation={userLocation}
                transportMode={transportMode}
                travelMatrixByHospitalId={travelMatrixByHospitalId}
                onCancelBooking={handleCancelBooking}
                onRescheduleBooking={handleRescheduleBooking}
                onRebookDoctor={handleRebookDoctor}
                onGoToSearch={() => setActiveTab('search')}
              />
            ) : (
              renderAccessDenied(
                'Please sign in or register as a patient to view your appointments.',
                'patient'
              )
            ))}

          {activeTab === 'records' &&
            (isPatientSignedIn ? (
              <MyHealthRecordsView
                pid={patientProfile?.pid || patientSession?.pid || 'Issuing PID...'}
                historyConsent={patientProfile?.historyConsent ?? true}
                visits={healthVisits}
                auditLogs={recordAuditLogs}
                onGoToProfile={() => setActiveTab('profile')}
              />
            ) : (
              renderAccessDenied(
                'Please sign in or register as a patient to view your Digital Health Records.',
                'patient'
              )
            ))}

          {activeTab === 'profile' &&
            (isPatientSignedIn && patientProfile ? (
              <MyProfileView
                profile={patientProfile}
                isFirebaseAuthenticated={Boolean(firebaseUser)}
                onSaveProfile={handleSaveProfile}
              />
            ) : isPatientSignedIn ? (
              <div className="bg-white border border-[#E2E6EC] rounded-md p-6 text-sm text-[#4B5563]">
                Loading your patient profile...
              </div>
            ) : (
              renderAccessDenied(
                'Please sign in or register as a patient to manage your profile and Health ID.',
                'patient'
              )
            ))}

          {activeTab === 'register' && (
            <HospitalRegisterView
              ownerUid={currentPatientUid || firebaseUser?.uid || 'hospital-applicant'}
              sponsoredConfig={sponsoredConfig}
              nowMs={nowMs}
              onRegistered={() => {
                void fetchOverview();
              }}
              onSponsorshipActivated={() => {
                void fetchOverview();
              }}
            />
          )}

          {activeTab === 'hospital_desk' &&
            (!authInitialized ? (
              <div className="bg-white border border-[#E2E6EC] rounded-md p-6 text-sm text-[#4B5563]">
                Verifying Hospital Desk owner credentials...
              </div>
            ) : isOwner ? (
              <HospitalDashboardView
                hospitals={mergedHospitals}
                bookings={bookings}
                waitlist={waitlist}
                doctorCompletionNotices={doctorCompletionNotices}
                sponsoredConfig={sponsoredConfig}
                nowMs={nowMs}
                onRefresh={() => {
                  void fetchOverview();
                }}
                onDismissDoctorNotice={async (hospId, noticeId) => {
                  const token = await getFirebaseIdToken();
                  await fetch(
                    `/api/hospitals/${encodeURIComponent(hospId)}/notices/${encodeURIComponent(noticeId)}`,
                    {
                      method: 'DELETE',
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    }
                  );
                  await fetchOverview();
                }}
                onQueueAction={handleQueueAction}
              />
            ) : (
              renderAccessDenied(
                'Access denied — Hospital Desk is restricted strictly to the verified hospital owner account.',
                'owner_admin'
              )
            ))}

          {activeTab === 'doctor_workspace' &&
            (staffSession?.role === 'doctor' ? (
              <DoctorWorkspaceView
                session={staffSession}
                refreshSignal={healthRefreshSignal}
                onLogout={() => void handleLogoutAll()}
              />
            ) : (
              renderAccessDenied(
                'Access denied — please sign in using your hospital-issued Doctor credentials.',
                'doctor'
              )
            ))}

          {activeTab === 'medical_workspace' &&
            (staffSession?.role === 'medical' ? (
              <MedicalWorkspaceView
                session={staffSession}
                refreshSignal={healthRefreshSignal}
                onLogout={() => void handleLogoutAll()}
              />
            ) : (
              renderAccessDenied(
                'Access denied — please sign in using your hospital-issued Medical / Pharmacy credentials.',
                'medical'
              )
            ))}

          {activeTab === 'admin' &&
            (!authInitialized ? (
              <div className="bg-white border border-[#E2E6EC] rounded-md p-6 text-sm text-[#4B5563]">
                Verifying Admin credentials...
              </div>
            ) : isAdmin ? (
              <AdminPanelView
                hospitals={mergedHospitals}
                bookings={bookings}
                emailPreviews={emailPreviews}
                onAdminUpdateHospital={handleAdminUpdateHospital}
                onAssignSponsoredSlot={handleAssignSponsoredSlot}
                onResetAllData={handleResetAllData}
              />
            ) : (
              renderAccessDenied(
                'Access denied — Admin Panel is restricted strictly to the authorized platform administrator.',
                'owner_admin'
              )
            ))}
        </main>

        {/* Practical Healthcare Directory Footer */}
        <footer className="bg-white border-t border-[#E2E6EC] mt-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#4B5563]">
            <div>
              <span className="font-semibold text-[#1F5FA8]">Pinnacle</span> ·{' '}
              <span>{t(language, 'tagline')}</span> · First Launch City: Nagpur, Maharashtra
              <p className="text-[#B91C1C] font-medium mt-1">
                {t(language, 'emergencyDisclaimer')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setActiveTab('register')}
                className="text-[#1F5FA8] font-medium hover:underline"
              >
                {t(language, 'navRegisterHospital')}
              </button>
              <button
                type="button"
                onClick={() => setLegalDoc('privacy')}
                className="hover:text-[#111827] hover:underline"
              >
                {t(language, 'privacyPolicy')}
              </button>
              <button
                type="button"
                onClick={() => setLegalDoc('terms')}
                className="hover:text-[#111827] hover:underline"
              >
                {t(language, 'termsOfService')}
              </button>
            </div>
          </div>
        </footer>

        {/* Modals */}
        {bookingTarget && currentPatientUid && (
          <BookingModal
            item={bookingTarget.item}
            selectedSpecialty={specialty}
            initialDoctorName={bookingTarget.initialDoctorName}
            initialSpecialty={bookingTarget.initialSpecialty}
            patientUid={currentPatientUid}
            getBookingToken={async () => {
  if (patientSession?.uid === currentPatientUid) {
    return patientSession.token;
  }

  if (firebaseUser?.uid === currentPatientUid) {
    return await getFirebaseIdToken();
  }

  return null;
}}
            patientProfile={patientProfile}
            defaultEmail={patientSession?.email || firebaseUser?.email || ''}
            defaultName={patientSession?.displayName || firebaseUser?.displayName || ''}
            onClose={() => setBookingTarget(null)}
            onBooked={() => {
              void fetchOverview();
            }}
            onViewMyAppointments={() => setActiveTab('appointments')}
            onCancelBooking={handleCancelBooking}
          />
        )}

        {loginOpen && (
          <LoginModal
            initialTab={loginInitialTab}
            notice={loginNotice}
            onClose={() => {
              setLoginOpen(false);
              setLoginNotice(null);
            }}
            onPatientAuthSuccess={(session, profile) => {
              setStaffSession(null);
              setOtpUser(null);
              setPatientSession(session);
              setPatientProfile(profile);
            }}
            onDemoLogin={(name, phone, historyConsent) => {
              const uid = phone ? `phone-${phone.replace(/\D/g, '').slice(-10)}` : `pat-${Date.now().toString(36)}`;
              setStaffSession(null);
              setOtpUser({ name, uid, phone });
              void fetch('/api/patients/ensure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  uid,
                  displayName: name,
                  phone: phone || '',
                  historyConsent: typeof historyConsent === 'boolean' ? historyConsent : true,
                }),
              })
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                  if (data?.profile) setPatientProfile(data.profile);
                  void fetchPatientHealthRecords();
                })
                .catch(() => {});
            }}
            onStaffLogin={(session) => {
              setPatientSession(null);
              setOtpUser(null);
              setStaffSession(session);
              setActiveTab(session.role === 'doctor' ? 'doctor_workspace' : 'medical_workspace');
            }}
          />
        )}

        {legalDoc && <LegalModal docType={legalDoc} onClose={() => setLegalDoc(null)} />}
      </div>
    </ErrorBoundary>
  );
}
