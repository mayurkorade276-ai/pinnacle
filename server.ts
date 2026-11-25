import { supabaseAdmin } from './supabase-server';
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { SEED_HOSPITALS, SPECIALTIES } from './src/data/seedHospitals';
import { estimateUrbanTravel } from './src/utils/ranking';
import { sanitizePatientProfile } from './src/utils/history';
import {
  evaluateMockCard,
  evaluateMockUpi,
  makeSlotKey,
  parseSlotBoundaryMs,
} from './src/utils/sponsorship';
import {
  SEED_PRESCRIPTION_TEMPLATES,
} from './src/data/seedHealthRecords';
import { deriveDeterministicPidForUid, generateUniquePid, isValidPid } from './src/utils/pid';
import firebaseConfig from './firebase-applet-config.json';
import type {
  ActiveStaffSession,
  BookingRecord,
  BookingStatus,
  Coordinates,
  DispensingMedicineUpdate,
  DispensingRecord,
  DoctorCompletionNotice,
  EmailNotificationPreview,
  HealthVisitRecord,
  HospitalRecord,
  HospitalStaffAccount,
  PatientAuthSession,
  PatientProfile,
  PaymentRecord,
  PrescriptionMedicineItem,
  PrescriptionTemplate,
  RecordAuditLogEntry,
  SharedPrescriptionMedicine,
  SharedPrescriptionRecord,
  Specialty,
  SponsoredConfig,
  SponsoredSlotStatus,
  SponsorReceipt,
  SponsorWaitlistEntry,
  StaffRole,
  TransportMode,
  TravelEstimate,
} from './src/types/pinnacle';

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.use(express.json({ limit: '2mb' }));
if (process.env.NODE_ENV === 'production') {
  const password = process.env.DEMO_ACCESS_PASSWORD;

  if (!password) {
    throw new Error('Missing demo access password');
  }

  const accessToken = crypto.randomBytes(32).toString('hex');

  app.get('/__demo', (_req, res) => {
    res.send(`
      <h2>Pinnacle Demo Access</h2>
      <form method="POST" action="/__demo">
        <input type="password" name="password" required>
        <button type="submit">Enter Pinnacle</button>
      </form>
    `);
  });

  app.post('/__demo', express.urlencoded({ extended: false }), (req, res) => {
    const hash = (value: string) =>
      crypto.createHash('sha256').update(value).digest();

    if (!crypto.timingSafeEqual(
      hash(String(req.body?.password || '')),
      hash(password)
    )) {
      return res.status(403).send('Incorrect password');
    }

    res.cookie('pinnacle_demo', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    });

    res.redirect(303, '/');
  });

  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path === '/api/health') {
      return next();
    }

    const allowed = req.headers.cookie
      ?.split(';')
      .some(c => c.trim() === `pinnacle_demo=${accessToken}`);

    if (allowed) return next();

    if (req.path.startsWith('/api/')) {
      return res.sendStatus(401);
    }

    res.redirect('/__demo');
  });
}

const SERVER_ORDER_HMAC_SECRET =
  process.env.ORDER_HMAC_SECRET || crypto.randomBytes(32).toString('hex');

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'swapnilkorade0203@gmail.com').trim().toLowerCase();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'mayurkorade276@gmail.com').trim().toLowerCase();

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

let cachedGoogleCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGoogleSecureTokenCerts(): Promise<Record<string, string>> {
  if (cachedGoogleCerts && cachedGoogleCerts.expiresAt > Date.now()) {
    return cachedGoogleCerts.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch Google public certificates (${resp.status})`);
  }
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlMs = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) * 1000 : 3600_000;
  const certs = (await resp.json()) as Record<string, string>;
  cachedGoogleCerts = { certs, expiresAt: Date.now() + ttlMs };
  return certs;
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  return Buffer.from(pad ? normalized + '='.repeat(4 - pad) : normalized, 'base64');
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(decodeBase64Url(headerB64).toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    const payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    if (header.alg !== 'RS256' || !header.kid) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.aud !== firebaseConfig.projectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${firebaseConfig.projectId}`) return null;
    if (!payload.sub || typeof payload.sub !== 'string') return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;

    const certs = await getGoogleSecureTokenCerts();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    const sigOk = verifier.verify(certPem, decodeBase64Url(signatureB64));
    if (!sigOk) return null;

    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    return {
      uid: payload.sub,
      email,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : email,
    };
  } catch (err) {
    console.error('Firebase token verification error:', err);
    return null;
  }
}

async function extractVerifiedFirebaseUser(
  req: express.Request
): Promise<VerifiedFirebaseUser | null> {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token.includes('.')) return null;
  return verifyFirebaseIdToken(token);
}

async function requireVerifiedOwner(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const user = await extractVerifiedFirebaseUser(req);
  if (!user) {
    res.status(401).json({ error: 'Verified sign-in required for Hospital Desk access.' });
    return;
  }
  if (!user.emailVerified || user.email !== OWNER_EMAIL) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  (req as express.Request & { firebaseUser?: VerifiedFirebaseUser }).firebaseUser = user;
  next();
}

async function requireVerifiedAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const user = await extractVerifiedFirebaseUser(req);
  if (!user) {
    res.status(401).json({ error: 'Verified Admin sign-in required.' });
    return;
  }
  if (!user.emailVerified || user.email !== ADMIN_EMAIL) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  (req as express.Request & { firebaseUser?: VerifiedFirebaseUser }).firebaseUser = user;
  next();
}

function getSponsoredConfig(): SponsoredConfig {
  const priceRank1 = Math.max(1, Number(process.env.SPONSOR_PRICE_RANK1) || 999);
  const priceRank2 = Math.max(1, Number(process.env.SPONSOR_PRICE_RANK2) || 699);
  const durationMinutes = Math.max(1, Number(process.env.SPONSOR_DURATION_MINUTES) || 10080);
  const razorpayKeyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const razorpayKeySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  const demoForced = process.env.DEMO_PAYMENT === 'true';
  const paymentMode: 'razorpay' | 'mock' =
    razorpayKeyId && razorpayKeySecret && !demoForced ? 'razorpay' : 'mock';

  return {
    priceRank1,
    priceRank2,
    durationMinutes,
    paymentMode,
    razorpayKeyId: paymentMode === 'razorpay' ? razorpayKeyId : undefined,
  };
}

// --- In-memory live operational store (Hospitals stay; NO seeded patients, bookings, visits, or prescriptions) ---
const hospitals: HospitalRecord[] = SEED_HOSPITALS.map((h) => ({
  ...h,
  pausedOpds: {},
  doctors: h.doctors.map((d) => ({ ...d })),
  recentReviews: h.recentReviews.map((r) => ({ ...r })),
}));

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const bookings: BookingRecord[] = [];

async function persistBooking(booking: BookingRecord) {
  const { error } = await supabaseAdmin
    .from('bookings')
    .upsert({
      id: booking.id,
      hospital_id: booking.hospitalId,
      patient_uid: booking.patientUid,
      doctor_id: booking.doctorId ?? null,
      specialty: booking.specialty,
      token_number: booking.tokenNumber,
      token_numeric: booking.tokenNumeric,
      queue_position: booking.queuePosition,
      status: booking.status,
      appointment_date: booking.date,
      booking_data: booking,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'id'
    });

  if (error) throw error;
}

const patientProfiles = new Map<string, PatientProfile>();
async function loadPatientProfile(uid: string) {
  const { data, error } = await supabaseAdmin
    .from('patient_profiles')
    .select('profile')
    .eq('uid', uid)
    .maybeSingle();

  if (error) throw error;

  return data ? data.profile as PatientProfile : null;
}

async function persistNewPatientProfile(profile: PatientProfile) {
  const { error } = await supabaseAdmin
    .from('patient_profiles')
    .upsert({
      uid: profile.uid,
      pid: profile.pid ?? null,
      profile: profile,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'uid',
      ignoreDuplicates: true
    });

  if (error) throw error;
}
const issuedPids = new Set<string>();

interface InternalPatientAuth {
  uid: string;
  pid: string;
  name: string;
  email: string;
  phone: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  passwordHash: string;
  createdAt: number;
}
const registeredPatients = new Map<string, InternalPatientAuth>();
const patientSessions = new Map<string, PatientAuthSession>();

function getOrIssuePermanentPid(uid: string): string {
  const existing = patientProfiles.get(uid);
  if (existing?.pid && isValidPid(existing.pid)) {
    issuedPids.add(existing.pid);
    return existing.pid;
  }
  const candidate = deriveDeterministicPidForUid(uid);
  const permanentPid = issuedPids.has(candidate) ? generateUniquePid(issuedPids) : candidate;
  issuedPids.add(permanentPid);
  return permanentPid;
}

// --- Digital Health Records Operational Store ---
interface InternalStaffRecord extends HospitalStaffAccount {
  passwordHash: string;
}

function hashStaffPasscode(passcode: string, existingSalt?: string): string {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyStaffPasscode(passcode: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(passcode, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  return derived.length === storedBuf.length && crypto.timingSafeEqual(derived, storedBuf);
}

const staffAccounts: InternalStaffRecord[] = [
  {
    id: 'staff-doc-kavita',
    role: 'doctor',
    hospitalId: 'ngp-eye-sitabuldi-drishti',
    hospitalName: 'Drishti Point Eye Clinic',
    name: 'Dr. Kavita Nagrale',
    email: 'dr.kavita@pinnacle.in',
    specialty: 'Eye OPD',
    qualification: 'MS Ophthalmology, FICO',
    registrationNumber: 'MMC-2013-06412',
    createdAt: Date.now() - 30 * 86_400_000,
    passwordHash: hashStaffPasscode(process.env.DEMO_DOCTOR_PASSCODE || 'Doctor@123'),
  },
  {
    id: 'staff-med-suresh',
    role: 'medical',
    hospitalId: 'ngp-eye-sitabuldi-drishti',
    hospitalName: 'Drishti Point Eye Clinic',
    name: 'Suresh Kulkarni',
    email: 'pharmacy@pinnacle.in',
    createdAt: Date.now() - 30 * 86_400_000,
    passwordHash: hashStaffPasscode(process.env.DEMO_MEDICAL_PASSCODE || 'Medical@123'),
  },
];

const staffSessions = new Map<string, ActiveStaffSession>();
const healthVisits: HealthVisitRecord[] = [];
const prescriptions: SharedPrescriptionRecord[] = [];
const prescriptionTemplates: PrescriptionTemplate[] = SEED_PRESCRIPTION_TEMPLATES.map((t) => ({
  ...t,
  medicines: t.medicines.map((m) => ({ ...m, when: [...m.when] })),
}));
const dispensingRecords: DispensingRecord[] = [];
const recordAuditLogs: RecordAuditLogEntry[] = [];
const doctorCompletionNotices: DoctorCompletionNotice[] = [];

function toPublicStaff(acc: InternalStaffRecord): HospitalStaffAccount {
  const { passwordHash: _omit, ...rest } = acc;
  return rest;
}

function getAuthenticatedStaff(req: express.Request): ActiveStaffSession | null {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return staffSessions.get(token) ?? null;
}

function requireStaffRole(requiredRole?: StaffRole) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const session = getAuthenticatedStaff(req);
    if (!session) {
      res.status(401).json({ error: 'Staff authentication required.' });
      return;
    }
    if (requiredRole && session.role !== requiredRole) {
      res.status(403).json({ error: `This action requires a ${requiredRole} login.` });
      return;
    }
    (req as express.Request & { staffSession?: ActiveStaffSession }).staffSession = session;
    next();
  };
}

const emailPreviews: EmailNotificationPreview[] = [];
const otpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();
const sponsorWaitlist: SponsorWaitlistEntry[] = [];
const paymentRecords: PaymentRecord[] = [];
const pendingOrders = new Map<
  string,
  {
    orderId: string;
    hospitalId: string;
    city: string;
    specialty: Specialty;
    rank: 1 | 2;
    amount: number;
    durationMinutes: number;
    mode: 'razorpay' | 'mock';
    challenge?: string;
    createdAt: number;
  }
>();

// --- SSE subscribers for live queue & sponsorship updates ---
const sseClients = new Set<express.Response>();

function broadcastState(eventType: string, payload: unknown) {
  const data = JSON.stringify({ type: eventType, payload, timestamp: Date.now() });
  for (const res of sseClients) {
    res.write(`data: ${data}\n\n`);
  }
}

function recordEmailNotification(to: string, subject: string, body: string): EmailNotificationPreview {
  const entry: EmailNotificationPreview = {
    id: `mail-${crypto.randomUUID().slice(0, 8)}`,
    to,
    subject,
    body,
    sentAt: new Date().toISOString(),
    channel: 'email',
  };
  emailPreviews.unshift(entry);
  if (emailPreviews.length > 50) emailPreviews.length = 50;
  return entry;
}

// --- Routes ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'Pinnacle API', timestamp: Date.now() });
});

app.get('/api/auth/session', async (req, res) => {
  const user = await extractVerifiedFirebaseUser(req);
  if (!user) {
    res.json({
      authenticated: false,
      email: null,
      emailVerified: false,
      isOwner: false,
      isAdmin: false,
    });
    return;
  }
  res.json({
    authenticated: true,
    uid: user.uid,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    isOwner: user.emailVerified && user.email === OWNER_EMAIL,
    isAdmin: user.emailVerified && user.email === ADMIN_EMAIL,
  });
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

app.get('/api/hospitals', (req, res) => {
  const includeAll = req.query.includeAll === '1';
  const list = includeAll ? hospitals : hospitals.filter((h) => h.status === 'approved');
  res.json({ hospitals: list, serverTime: Date.now() });
});

app.get('/api/directory', (_req, res) => {
  const nowMs = Date.now();
  purgeExpiredSponsorships(nowMs);
  res.json({
    hospitals: hospitals.filter((h) => h.status === 'approved'),
    waitlist: sponsorWaitlist,
    sponsoredConfig: getSponsoredConfig(),
    serverTime: nowMs,
  });
});

app.post('/api/hospitals/register', async (req, res) => {
  const user = await extractVerifiedFirebaseUser(req);
  const body = req.body ?? {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const city = typeof body.city === 'string' ? body.city.trim() : 'Nagpur';
  const contactEmail = typeof body.contactPerson?.email === 'string' ? body.contactPerson.email.trim() : '';

  if (name.length < 2 || address.length < 5) {
    res.status(400).json({ error: 'Hospital name and full address are required.' });
    return;
  }

  const id = `hosp-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`;
  const newHospital: HospitalRecord = {
    id,
    name,
    type: body.type || 'Hospital',
    registrationNumber: String(body.registrationNumber || `MH-REG-${Math.floor(1000 + Math.random() * 9000)}`),
    yearEstablished: Number(body.yearEstablished) || 2020,
    city,
    state: String(body.state || 'Maharashtra'),
    pincode: String(body.pincode || '440010'),
    address,
    area: String(body.area || city),
    lat: Number(body.lat) || 21.1458,
    lng: Number(body.lng) || 79.0882,
    deskPhone: String(body.contactPerson?.mobile || '+91 712 2400000'),
    specialties: Array.isArray(body.specialties) && body.specialties.length > 0 ? body.specialties : ['Eye OPD'],
    doctors: Array.isArray(body.doctors) ? body.doctors : [],
    opdDays: String(body.opdDays || 'Mon - Sat'),
    opdTimings: String(body.opdTimings || '09:30 AM - 07:00 PM'),
    openNow: true,
    consultationFee: Math.max(0, Number(body.consultationFee) || 400),
    avgConsultMinutes: Math.max(3, Number(body.avgConsultMinutes) || 10),
    activeCounters: Math.max(1, Number(body.activeCounters) || 1),
    patientsWaiting: 0,
    currentTokenNumber: 1,
    isPaused: false,
    isLiveQueue: true,
    historicalWaitMinutes: 15,
    lastUpdatedAt: Date.now(),
    googleRating: 4.5,
    reviewCount: 1,
    recentReviews: [],
    photoUrl: '/src/assets/images/nagpur_hospital_facade_three_1795551710826.jpg',
    status: 'pending',
    is_sponsored: false,
    sponsor_rank: body.requestedPlan === 'sponsor_1' ? 1 : body.requestedPlan === 'sponsor_2' ? 2 : undefined,
    ownerUid: user?.emailVerified
  ? user.uid
  : `unclaimed-${id}`,
    contactPerson: body.contactPerson,
    analytics: { patientsToday: 0, avgWaitTodayMinutes: 0 },
  };

  
const { error } = await supabaseAdmin
  .from('hospitals')
  .insert({
    id: newHospital.id,
    name: newHospital.name,
    owner_uid: newHospital.ownerUid,
    city: newHospital.city,
    status: newHospital.status,
    hospital_data: newHospital
  });

if (error) {
  console.error('Hospital database error:', error.code);

  return res.status(500).json({
    error: 'Unable to save hospital registration.'
  });
}

hospitals.push(newHospital);


  const mail = recordEmailNotification(
    contactEmail || 'hospital-desk@example.in',
    `Pinnacle Hospital Registration Under Review — ${newHospital.name}`,
    `Dear ${body.contactPerson?.name || 'Administrator'},\n\nThank you for registering ${newHospital.name} on Pinnacle.\nYour application (${newHospital.id}) is currently Under Review by our Nagpur onboarding team.\nRequested Plan: ${body.requestedPlan || 'Free Listing'}.\n\nRegards,\nPinnacle Healthcare Team`
  );

  broadcastState('hospital_registered', newHospital);
  res.status(201).json({ hospital: newHospital, emailPreview: mail });
});

app.get('/api/hospitals/:hospitalId/desk', requireVerifiedOwner, (req, res) => {
  const { hospitalId } = req.params;
  const hospital = hospitals.find((h) => h.id === hospitalId);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found.' });
    return;
  }
  const hospBookings = bookings
    .filter((b) => b.hospitalId === hospitalId)
    .map((b) => {
      if (b.PID || b.patientPid || b.patientUid.startsWith('walkin-')) return b;
      const prof = patientProfiles.get(b.patientUid);
      return prof?.pid ? { ...b, patientPid: prof.pid, PID: prof.pid } : b;
    });
  res.json({
    hospital,
    bookings: hospBookings,
    staff: staffAccounts.filter((a) => a.hospitalId === hospitalId).map(toPublicStaff),
    doctorCompletionNotices: doctorCompletionNotices.filter((n) => n.hospitalId === hospitalId),
    emailPreviews: emailPreviews.slice(0, 20),
  });
});

app.post('/api/hospitals/:id/walk-in', requireVerifiedOwner, (req, res) => {
  const { id } = req.params;
  const hospital = hospitals.find((h) => h.id === id);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found.' });
    return;
  }

  const body = req.body ?? {};
  const opdId = (typeof body.opd_id === 'string' ? body.opd_id.trim() : '') as Specialty;
  if (!opdId || !hospital.specialties.includes(opdId)) {
    res.status(400).json({ error: 'Select a valid OPD department offered by this hospital.' });
    return;
  }

  const patientName = typeof body.patient_name === 'string' ? body.patient_name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const age = Number(body.age);
  const genderRaw = body.gender;
  const gender: 'Male' | 'Female' | 'Other' =
    genderRaw === 'Female' || genderRaw === 'Other' ? genderRaw : 'Male';
  const rawPid = typeof body.PID === 'string' ? body.PID.trim().toUpperCase() : '';
  const requestedDoctorId = typeof body.doctor_id === 'string' ? body.doctor_id.trim() : '';

  if (patientName.length < 2) {
    res.status(400).json({ error: 'Patient full name is required.' });
    return;
  }
  if (phone.replace(/\D/g, '').length < 10) {
    res.status(400).json({ error: 'Valid 10-digit patient mobile number is required.' });
    return;
  }
  if (!Number.isFinite(age) || age < 0 || age > 120) {
    res.status(400).json({ error: 'Enter a valid patient age between 0 and 120.' });
    return;
  }

  let linkedPatientId: string | null = null;
  let linkedPid: string | null = null;
  let patientUid = `walkin-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`;
  let patientEmail = '';

  if (rawPid) {
    if (!isValidPid(rawPid)) {
      res.status(400).json({ error: 'PID format must be PID-XXXX-XXXX-XX.' });
      return;
    }
    const matchedProfile = Array.from(patientProfiles.values()).find((p) => p.pid === rawPid);
    if (!matchedProfile) {
      res.status(404).json({ error: `No registered patient found with PID ${rawPid}. Leave PID empty for a walk-in without PID.` });
      return;
    }
    linkedPatientId = matchedProfile.uid;
    linkedPid = matchedProfile.pid || rawPid;
    patientUid = matchedProfile.uid;
    patientEmail = matchedProfile.email || '';
  }

  let assignedDoctorId: string | null = null;
  let assignedDoctorName = `${opdId} Duty Doctor`;
  if (requestedDoctorId) {
    const docMatch = hospital.doctors.find(
      (d) => d.id === requestedDoctorId && d.specialty === opdId
    );
    if (!docMatch) {
      res.status(400).json({ error: 'Selected doctor does not belong to the selected OPD.' });
      return;
    }
    assignedDoctorId = docMatch.id;
    assignedDoctorName = docMatch.name;
  }

  const nowMs = Date.now();
  const maxHospitalToken = bookings
    .filter((b) => b.hospitalId === hospital.id)
    .reduce((max, b) => Math.max(max, b.tokenNumeric || 0), hospital.currentTokenNumber);
  const tokenNumeric = maxHospitalToken + 1;
  const prefix = opdId.slice(0, 3).toUpperCase();
  const tokenNumber = `${prefix}-${tokenNumeric}`;

  const activeOpdQueue = bookings.filter(
    (b) =>
      b.hospitalId === hospital.id &&
      (b.opd_id || b.specialty) === opdId &&
      (b.status === 'waiting' || b.status === 'called')
  );
  const queuePosition = activeOpdQueue.length + 1;
  const counters = Math.max(1, hospital.activeCounters);
  const initialEstimatedWaitMinutes = Math.round(
    ((queuePosition - 1) * hospital.avgConsultMinutes) / counters
  );

  const bookingId = `bk-${nowMs.toString(36)}-${crypto.randomUUID().slice(0, 4)}`;
  const entry: BookingRecord = {
    id: bookingId,
    queue_id: bookingId,
    hospitalId: hospital.id,
    hospital_id: hospital.id,
    hospitalOwnerUid: hospital.ownerUid,
    hospitalName: hospital.name,
    hospitalAddress: hospital.address,
    hospitalLat: hospital.lat,
    hospitalLng: hospital.lng,
    doctorId: assignedDoctorId,
    doctor_id: assignedDoctorId,
    doctorName: assignedDoctorName,
    specialty: opdId,
    opd_id: opdId,
    patientUid,
    patient_id: linkedPatientId,
    patientPid: linkedPid ?? undefined,
    PID: linkedPid,
    patientName,
    patientMobile: phone,
    patientEmail,
    patientAge: Math.round(age),
    patientGender: gender,
    reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : `${opdId} Walk-In Consultation`,
    date: getTodayStr(),
    timeSlot: 'Live Walk-In Queue',
    isWalkIn: true,
    tokenNumber,
    tokenNumeric,
    queuePosition,
    estimatedCallTimeIso: new Date(nowMs + initialEstimatedWaitMinutes * 60_000).toISOString(),
    initialEstimatedWaitMinutes,
    status: 'waiting',
    consentGiven: true,
    createdAt: nowMs,
    created_at: nowMs,
    updatedAt: nowMs,
  };

  bookings.push(entry);
  hospital.patientsWaiting = bookings.filter(
    (b) => b.hospitalId === hospital.id && (b.status === 'waiting' || b.status === 'called')
  ).length;
  if (hospital.analytics) hospital.analytics.patientsToday += 1;
  hospital.lastUpdatedAt = nowMs;

  broadcastState('queue_updated', {
    hospitalId: hospital.id,
    opdId,
    hospital,
    entry,
    bookings: bookings.filter((b) => b.hospitalId === hospital.id),
  });
  res.status(201).json({ entry, hospital, bookings: bookings.filter((b) => b.hospitalId === hospital.id) });
});

app.patch('/api/hospitals/:id/queue', requireVerifiedOwner, (req, res) => {
  const { id } = req.params;
  const hospital = hospitals.find((h) => h.id === id);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found.' });
    return;
  }

  const {
    action,
    opdId: rawOpdId,
    opd_id: rawOpdIdSnake,
    bookingId,
    patientsWaiting,
    isPaused,
    activeCounters,
    avgConsultMinutes,
    opdTimings,
    openNow,
    doctorId,
  } = req.body ?? {};
  const opdId = (rawOpdId || rawOpdIdSnake || '') as Specialty | '';
  const nowMs = Date.now();

  if (action === 'call_next' || action === 'mark_done' || action === 'skip') {
    const scopedQueue = bookings
      .filter(
        (b) =>
          b.hospitalId === id &&
          (!opdId || (b.opd_id || b.specialty) === opdId) &&
          (b.status === 'waiting' || b.status === 'called')
      )
      .sort((a, b) => a.tokenNumeric - b.tokenNumeric);

    if (scopedQueue.length > 0) {
      const target =
        (typeof bookingId === 'string' && scopedQueue.find((b) => b.id === bookingId)) ||
        (action === 'call_next'
          ? scopedQueue.find((b) => b.status === 'waiting') || scopedQueue[0]
          : scopedQueue.find((b) => b.status === 'called') || scopedQueue[0]);

      if (action === 'call_next') {
        // Move any previously called token in this OPD to completed before calling next waiting patient
        for (const b of scopedQueue) {
          if (b.id !== target.id && b.status === 'called') {
            b.status = 'completed';
            b.queuePosition = 0;
            b.updatedAt = nowMs;
          }
        }
        target.status = 'called';
        target.queuePosition = 1;
      } else if (action === 'mark_done') {
        target.status = 'completed';
        target.queuePosition = 0;
      } else if (action === 'skip') {
        target.status = 'skipped';
        target.queuePosition = 0;
      }
      target.updatedAt = nowMs;
      hospital.currentTokenNumber = Math.max(hospital.currentTokenNumber, target.tokenNumeric || 0);

      // Re-index waiting items in that OPD
      const targetOpd = target.opd_id || target.specialty;
      let pos = 1;
      for (const b of bookings
        .filter(
          (item) =>
            item.hospitalId === id &&
            (item.opd_id || item.specialty) === targetOpd &&
            item.status === 'waiting'
        )
        .sort((a, b) => a.tokenNumeric - b.tokenNumeric)) {
        b.queuePosition = pos;
        b.updatedAt = nowMs;
        pos += 1;
      }
    }

    hospital.patientsWaiting = bookings.filter(
      (b) => b.hospitalId === id && (b.status === 'waiting' || b.status === 'called')
    ).length;
  } else if (action === 'toggle_pause') {
    if (opdId && hospital.specialties.includes(opdId)) {
      hospital.pausedOpds = {
        ...(hospital.pausedOpds ?? {}),
        [opdId]: !hospital.pausedOpds?.[opdId],
      };
    } else {
      hospital.isPaused = !hospital.isPaused;
    }
  } else if (action === 'toggle_doctor' && doctorId) {
    const doc = hospital.doctors.find((d) => d.id === doctorId);
    if (doc) {
      doc.availableToday = !doc.availableToday;
      const availCount = hospital.doctors.filter((d) => d.availableToday).length;
      hospital.activeCounters = Math.max(1, availCount);
    }
  } else if (action === 'update_settings') {
    if (typeof patientsWaiting === 'number' && patientsWaiting >= 0) {
      hospital.patientsWaiting = Math.round(patientsWaiting);
    }
    if (typeof isPaused === 'boolean') hospital.isPaused = isPaused;
    if (typeof activeCounters === 'number' && activeCounters >= 1) {
      hospital.activeCounters = Math.round(activeCounters);
    }
    if (typeof avgConsultMinutes === 'number' && avgConsultMinutes >= 2) {
      hospital.avgConsultMinutes = Math.round(avgConsultMinutes);
    }
    if (typeof opdTimings === 'string' && opdTimings.trim()) {
      hospital.opdTimings = opdTimings.trim();
    }
    if (typeof openNow === 'boolean') {
      hospital.openNow = openNow;
    }
  }

  hospital.lastUpdatedAt = nowMs;
  broadcastState('queue_updated', {
    hospitalId: hospital.id,
    opdId: opdId || undefined,
    hospital,
    bookings: bookings.filter((b) => b.hospitalId === id),
  });
  res.json({ hospital, bookings: bookings.filter((b) => b.hospitalId === id) });
});

function syncLegacySponsorSummary(hospital: HospitalRecord) {
  const entries = Object.values(hospital.sponsor_slots ?? {}).filter(
    (entry): entry is NonNullable<typeof entry> => Boolean(entry)
  );
  if (entries.length > 0) {
    const primary = [...entries].sort((a, b) => a.rank - b.rank)[0];
    hospital.is_sponsored = true;
    hospital.sponsor_rank = primary.rank;
    hospital.sponsor_start_date = primary.startDate;
    hospital.sponsor_end_date = primary.endDate;
  } else {
    hospital.is_sponsored = false;
    delete hospital.sponsor_rank;
    delete hospital.sponsor_start_date;
    delete hospital.sponsor_end_date;
  }
}

function getActiveSlotHolder(
  city: string,
  specialty: Specialty,
  rank: 1 | 2,
  nowMs: number = Date.now()
): { hospital: HospitalRecord; endMs: number | null; endIso?: string } | null {
  const targetCity = city.trim().toLowerCase();
  for (const h of hospitals) {
    if (h.status !== 'approved') continue;
    if (targetCity && h.city.trim().toLowerCase() !== targetCity) continue;

    const slot = h.sponsor_slots?.[specialty];
    if (slot && slot.rank === rank) {
      const startMs = parseSlotBoundaryMs(slot.startDate, 'start');
      const endMs = parseSlotBoundaryMs(slot.endDate, 'end');
      if (startMs !== null && nowMs < startMs) continue;
      if (endMs !== null && nowMs > endMs) continue;
      return { hospital: h, endMs, endIso: slot.endDate };
    }

    if (
      (!h.sponsor_slots || Object.keys(h.sponsor_slots).length === 0) &&
      h.is_sponsored &&
      h.specialties.includes(specialty) &&
      (h.sponsor_rank ?? 1) === rank
    ) {
      const startMs = parseSlotBoundaryMs(h.sponsor_start_date, 'start');
      const endMs = parseSlotBoundaryMs(h.sponsor_end_date, 'end');
      if (startMs !== null && nowMs < startMs) continue;
      if (endMs !== null && nowMs > endMs) continue;
      return { hospital: h, endMs, endIso: h.sponsor_end_date };
    }
  }
  return null;
}

function promoteNextWaitlistEntry(
  city: string,
  specialty: Specialty,
  rank: 1 | 2,
  nowMs: number = Date.now()
): boolean {
  if (getActiveSlotHolder(city, specialty, rank, nowMs)) return false;

  const normalizedCity = city.trim().toLowerCase();
  const alreadyNotified = sponsorWaitlist.some(
    (w) =>
      w.city.trim().toLowerCase() === normalizedCity &&
      w.specialty === specialty &&
      w.desiredRank === rank &&
      w.status === 'notified' &&
      (w.claimExpiresAt ?? 0) > nowMs
  );
  if (alreadyNotified) return false;

  const nextEntry = sponsorWaitlist
    .filter(
      (w) =>
        w.city.trim().toLowerCase() === normalizedCity &&
        w.specialty === specialty &&
        w.desiredRank === rank &&
        w.status === 'waiting'
    )
    .sort((a, b) => a.createdAt - b.createdAt)[0];

  if (!nextEntry) return false;
  nextEntry.status = 'notified';
  nextEntry.notifiedAt = nowMs;
  nextEntry.claimExpiresAt = nowMs + 10 * 60_000;
  return true;
}

function purgeExpiredSponsorships(nowMs: number = Date.now()): boolean {
  let changed = false;
  const freedSlots: Array<{ city: string; specialty: Specialty; rank: 1 | 2 }> = [];

  for (const h of hospitals) {
    if (h.sponsor_slots) {
      for (const sp of Object.keys(h.sponsor_slots) as Specialty[]) {
        const slot = h.sponsor_slots[sp];
        if (!slot) continue;
        const endMs = parseSlotBoundaryMs(slot.endDate, 'end');
        if (endMs !== null && nowMs > endMs) {
          delete h.sponsor_slots[sp];
          freedSlots.push({ city: h.city, specialty: sp, rank: slot.rank });
          syncLegacySponsorSummary(h);
          h.lastUpdatedAt = nowMs;
          changed = true;
        }
      }
    }

    if (h.is_sponsored && (!h.sponsor_slots || Object.keys(h.sponsor_slots).length === 0)) {
      const endMs = parseSlotBoundaryMs(h.sponsor_end_date, 'end');
      if (endMs !== null && nowMs > endMs) {
        const fallbackRank = (h.sponsor_rank ?? 1) as 1 | 2;
        const primarySp = h.specialties[0] || 'Eye OPD';
        h.is_sponsored = false;
        delete h.sponsor_rank;
        delete h.sponsor_start_date;
        delete h.sponsor_end_date;
        freedSlots.push({ city: h.city, specialty: primarySp, rank: fallbackRank });
        h.lastUpdatedAt = nowMs;
        changed = true;
      }
    }
  }

  for (const entry of sponsorWaitlist) {
    if (entry.status === 'notified' && entry.claimExpiresAt && nowMs > entry.claimExpiresAt) {
      entry.status = 'expired';
      freedSlots.push({ city: entry.city, specialty: entry.specialty, rank: entry.desiredRank });
      changed = true;
    }
  }

  for (const freed of freedSlots) {
    if (promoteNextWaitlistEntry(freed.city, freed.specialty, freed.rank, nowMs)) {
      changed = true;
    }
  }

  if (changed) {
    broadcastState('sponsorship_updated', { nowMs });
  }
  return changed;
}

setInterval(() => {
  purgeExpiredSponsorships(Date.now());
}, 30_000);

function buildSlotStatusList(
  city: string,
  specialty: Specialty,
  nowMs: number = Date.now()
): SponsoredSlotStatus[] {
  return ([1, 2] as const).map((rank) => {
    const holder = getActiveSlotHolder(city, specialty, rank, nowMs);
    if (!holder) {
      return {
        slotKey: makeSlotKey(city, specialty, rank),
        city,
        specialty,
        rank,
        status: 'available',
        updatedAt: nowMs,
      };
    }
    // Intentionally omit hospitalId/hospitalName so current sponsor's identity stays private
    return {
      slotKey: makeSlotKey(city, specialty, rank),
      city,
      specialty,
      rank,
      status: 'occupied',
      occupiedUntilMs: holder.endMs ?? undefined,
      occupiedUntilIso: holder.endIso,
      updatedAt: nowMs,
    };
  });
}

async function tryFirestoreRestSponsoredCommit(params: {
  authHeader?: string;
  hospitalId: string;
  hospitalName: string;
  ownerUid: string;
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
}): Promise<{ conflict?: boolean; committed?: boolean }> {
  const match = params.authHeader?.match(/^Bearer\s+(.+)$/i);
  if (!match) return { committed: false };
  const idToken = match[1].trim();
  const slotKey = makeSlotKey(params.city, params.specialty, params.rank);
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

  try {
    const beginRes = await fetch(`${baseUrl}:beginTransaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    if (!beginRes.ok) return { committed: false };
    const beginData = (await beginRes.json()) as { transaction?: string };
    const tx = beginData.transaction;
    if (!tx) return { committed: false };

    const slotPath = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/sponsored_slots/${slotKey}`;
    const docGetRes = await fetch(`${baseUrl}/sponsored_slots/${slotKey}?transaction=${encodeURIComponent(tx)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (docGetRes.ok) {
      const existingDoc = (await docGetRes.json()) as {
        fields?: {
          status?: { stringValue?: string };
          occupiedUntilMs?: { integerValue?: string; doubleValue?: number };
          hospitalId?: { stringValue?: string };
        };
      };
      const st = existingDoc.fields?.status?.stringValue;
      const untilRaw =
        existingDoc.fields?.occupiedUntilMs?.doubleValue ??
        Number(existingDoc.fields?.occupiedUntilMs?.integerValue || 0);
      const holderId = existingDoc.fields?.hospitalId?.stringValue;
      if (st === 'occupied' && untilRaw > Date.now() && holderId && holderId !== params.hospitalId) {
        return { conflict: true, committed: false };
      }
    }

    const commitRes = await fetch(`${baseUrl}:commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        transaction: tx,
        writes: [
          {
            update: {
              name: slotPath,
              fields: {
                slotKey: { stringValue: slotKey },
                city: { stringValue: params.city },
                specialty: { stringValue: params.specialty },
                rank: { integerValue: String(params.rank) },
                status: { stringValue: 'occupied' },
                occupiedUntilMs: { integerValue: String(Math.round(params.endMs)) },
                occupiedUntilIso: { stringValue: params.endIso },
                hospitalId: { stringValue: params.hospitalId },
                ownerUid: { stringValue: params.ownerUid },
              },
            },
            updateTransforms: [
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
          {
            update: {
              name: `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/payments/${params.orderId}`,
              fields: {
                orderId: { stringValue: params.orderId },
                paymentId: { stringValue: params.paymentId },
                hospitalId: { stringValue: params.hospitalId },
                hospitalName: { stringValue: params.hospitalName },
                ownerUid: { stringValue: params.ownerUid },
                city: { stringValue: params.city },
                specialty: { stringValue: params.specialty },
                rank: { integerValue: String(params.rank) },
                amount: { integerValue: String(Math.round(params.amount)) },
                currency: { stringValue: 'INR' },
                mode: { stringValue: params.mode },
                status: { stringValue: 'paid' },
                startIso: { stringValue: params.startIso },
                endIso: { stringValue: params.endIso },
                timestamp: { integerValue: String(Date.now()) },
              },
            },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        ],
      }),
    });
    return { committed: commitRes.ok };
  } catch {
    return { committed: false };
  }
}

app.get('/api/sponsored/config', (_req, res) => {
  res.json({ config: getSponsoredConfig() });
});

app.get('/api/sponsored/slots', (req, res) => {
  const nowMs = Date.now();
  purgeExpiredSponsorships(nowMs);
  const city = typeof req.query.city === 'string' && req.query.city.trim() ? req.query.city.trim() : 'Nagpur';
  const specialty = (typeof req.query.specialty === 'string' && SPECIALTIES.includes(req.query.specialty as Specialty)
    ? req.query.specialty
    : 'Eye OPD') as Specialty;
  const hospitalId = typeof req.query.hospitalId === 'string' ? req.query.hospitalId.trim() : '';

  const slots = buildSlotStatusList(city, specialty, nowMs);
  const normalizedCity = city.toLowerCase();
  const matchingWaitlist = sponsorWaitlist.filter(
    (w) =>
      w.city.trim().toLowerCase() === normalizedCity &&
      w.specialty === specialty &&
      (w.status === 'waiting' || w.status === 'notified')
  );
  const myHospitalWaitlist = hospitalId
    ? sponsorWaitlist.filter(
        (w) => w.hospitalId === hospitalId && (w.status === 'waiting' || w.status === 'notified')
      )
    : [];

  res.json({
    config: getSponsoredConfig(),
    slots,
    waitlistCount: {
      rank1: matchingWaitlist.filter((w) => w.desiredRank === 1).length,
      rank2: matchingWaitlist.filter((w) => w.desiredRank === 2).length,
    },
    myHospitalWaitlist,
    serverTime: nowMs,
  });
});

app.post('/api/sponsored/waitlist', (req, res) => {
  const nowMs = Date.now();
  purgeExpiredSponsorships(nowMs);
  const body = req.body ?? {};
  const hospitalId = typeof body.hospitalId === 'string' ? body.hospitalId.trim() : '';
  const specialty = body.specialty as Specialty;
  const desiredRank = Number(body.desiredRank) as 1 | 2;

  const hospital = hospitals.find((h) => h.id === hospitalId);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found.' });
    return;
  }
  if (!SPECIALTIES.includes(specialty)) {
    res.status(400).json({ error: 'Valid OPD specialty is required.' });
    return;
  }
  if (desiredRank !== 1 && desiredRank !== 2) {
    res.status(400).json({ error: 'Desired rank must be 1 or 2.' });
    return;
  }

  const existing = sponsorWaitlist.find(
    (w) =>
      w.hospitalId === hospitalId &&
      w.city.trim().toLowerCase() === hospital.city.trim().toLowerCase() &&
      w.specialty === specialty &&
      w.desiredRank === desiredRank &&
      (w.status === 'waiting' || w.status === 'notified')
  );
  if (existing) {
    res.json({ entry: existing, alreadyWaiting: true });
    return;
  }

  const entry: SponsorWaitlistEntry = {
    id: `wl-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
    hospitalId: hospital.id,
    ownerUid: String(body.ownerUid || hospital.ownerUid || 'hospital-desk'),
    city: hospital.city,
    specialty,
    desiredRank,
    status: 'waiting',
    createdAt: nowMs,
  };
  sponsorWaitlist.push(entry);
  broadcastState('waitlist_updated', entry);
  res.status(201).json({ entry });
});

app.post('/api/sponsored/expire-check', (_req, res) => {
  const nowMs = Date.now();
  const changed = purgeExpiredSponsorships(nowMs);
  res.json({
    changed,
    nowMs,
    hospitals,
    waitlist: sponsorWaitlist,
  });
});

app.post('/api/payments/create-order', async (req, res) => {
  const nowMs = Date.now();
  purgeExpiredSponsorships(nowMs);
  const body = req.body ?? {};
  const hospitalId = typeof body.hospitalId === 'string' ? body.hospitalId.trim() : '';
  const specialty = body.specialty as Specialty;
  const rank = Number(body.rank) as 1 | 2;

  const hospital = hospitals.find((h) => h.id === hospitalId);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found.' });
    return;
  }
  if (!SPECIALTIES.includes(specialty)) {
    res.status(400).json({ error: 'Valid OPD specialty is required.' });
    return;
  }
  if (rank !== 1 && rank !== 2) {
    res.status(400).json({ error: 'Rank must be 1 or 2.' });
    return;
  }

  const currentHolder = getActiveSlotHolder(hospital.city, specialty, rank, nowMs);
  if (currentHolder && currentHolder.hospital.id !== hospital.id) {
    res.status(409).json({
      conflict: true,
      error: `Rank ${rank} is currently occupied. Choose an available slot or join the waitlist.`,
    });
    return;
  }

  const cfg = getSponsoredConfig();
  const amount = rank === 1 ? cfg.priceRank1 : cfg.priceRank2;

  if (cfg.paymentMode === 'razorpay' && cfg.razorpayKeyId) {
    const secret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    try {
      const authBasic = Buffer.from(`${cfg.razorpayKeyId}:${secret}`).toString('base64');
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${authBasic}`,
        },
        body: JSON.stringify({
          amount: Math.round(amount * 100),
          currency: 'INR',
          receipt: `pin_${hospital.id.slice(0, 12)}_${Date.now().toString(36)}`,
          notes: {
            hospitalId: hospital.id,
            city: hospital.city,
            specialty,
            rank: String(rank),
          },
        }),
      });
      if (!rzpRes.ok) {
        const errBody = await rzpRes.text();
        res.status(502).json({ error: `Razorpay order creation failed: ${errBody}` });
        return;
      }
      const rzpOrder = (await rzpRes.json()) as { id: string; amount: number; currency: string };
      pendingOrders.set(rzpOrder.id, {
        orderId: rzpOrder.id,
        hospitalId: hospital.id,
        city: hospital.city,
        specialty,
        rank,
        amount,
        durationMinutes: cfg.durationMinutes,
        mode: 'razorpay',
        createdAt: nowMs,
      });
      res.json({
        mode: 'razorpay',
        keyId: cfg.razorpayKeyId,
        orderId: rzpOrder.id,
        amount,
        amountPaise: rzpOrder.amount,
        currency: 'INR',
        durationMinutes: cfg.durationMinutes,
      });
      return;
    } catch {
      res.status(502).json({ error: 'Unable to reach Razorpay Orders API. Check keys or enable DEMO_PAYMENT=true.' });
      return;
    }
  }

  const orderId = `order_demo_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const challenge = crypto
    .createHmac('sha256', SERVER_ORDER_HMAC_SECRET)
    .update(`${orderId}|${hospital.id}|${specialty}|${rank}|${amount}`)
    .digest('hex');

  pendingOrders.set(orderId, {
    orderId,
    hospitalId: hospital.id,
    city: hospital.city,
    specialty,
    rank,
    amount,
    durationMinutes: cfg.durationMinutes,
    mode: 'mock',
    challenge,
    createdAt: nowMs,
  });

  res.json({
    mode: 'mock',
    orderId,
    orderChallenge: challenge,
    amount,
    amountPaise: Math.round(amount * 100),
    currency: 'INR',
    durationMinutes: cfg.durationMinutes,
  });
});

app.post('/api/payments/verify', async (req, res) => {
  const nowMs = Date.now();
  purgeExpiredSponsorships(nowMs);
  const body = req.body ?? {};
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const pending = pendingOrders.get(orderId);
  if (!pending) {
    res.status(400).json({ verified: false, error: 'Order session not found or already processed.' });
    return;
  }

  const hospital = hospitals.find((h) => h.id === pending.hospitalId);
  if (!hospital) {
    pendingOrders.delete(orderId);
    res.status(404).json({ verified: false, error: 'Hospital record not found.' });
    return;
  }

  let verified = false;
  let failureReason = 'Payment verification failed.';
  let paymentId = typeof body.paymentId === 'string' ? body.paymentId.trim() : '';

  if (pending.mode === 'razorpay') {
    const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
    const secret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!paymentId || !signature || !secret) {
      failureReason = 'Missing Razorpay payment signature.';
    } else {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expected, 'utf8');
      if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
        verified = true;
      } else {
        failureReason = 'Razorpay payment signature mismatch.';
      }
    }
  } else {
    const orderChallenge = typeof body.orderChallenge === 'string' ? body.orderChallenge.trim() : '';
    const expectedChallenge = pending.challenge || '';
    const chalBuf = Buffer.from(orderChallenge, 'utf8');
    const expChalBuf = Buffer.from(expectedChallenge, 'utf8');
    if (chalBuf.length !== expChalBuf.length || !crypto.timingSafeEqual(chalBuf, expChalBuf)) {
      failureReason = 'Invalid demo checkout token.';
    } else {
      const mockMethod = body.mockMethod === 'card' ? 'card' : 'upi';
      if (mockMethod === 'upi') {
        const upiResult = evaluateMockUpi(String(body.upiId || ''));
        verified = upiResult.ok;
        if (!upiResult.ok && upiResult.reason) failureReason = upiResult.reason;
      } else {
        const cardResult = evaluateMockCard({
          cardNumber: String(body.cardNumber || ''),
          expiry: String(body.cardExpiry || ''),
          cvv: String(body.cardCvv || ''),
        });
        verified = cardResult.ok;
        if (!cardResult.ok && cardResult.reason) failureReason = cardResult.reason;
      }
      paymentId = `pay_demo_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    }
  }

  pendingOrders.delete(orderId);

  if (!verified) {
    const failedRec: PaymentRecord = {
      id: `pmt-${Date.now().toString(36)}`,
      orderId,
      paymentId: paymentId || 'failed',
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      ownerUid: String(body.ownerUid || hospital.ownerUid),
      city: pending.city,
      specialty: pending.specialty,
      rank: pending.rank,
      amount: pending.amount,
      currency: 'INR',
      mode: pending.mode,
      status: 'failed',
      failureReason,
      timestamp: nowMs,
    };
    paymentRecords.unshift(failedRec);
    res.status(400).json({ verified: false, activated: false, error: failureReason });
    return;
  }

  // Re-check atomic availability right before activating (after verification succeeds)
  const existingHolder = getActiveSlotHolder(pending.city, pending.specialty, pending.rank, nowMs);
  if (existingHolder && existingHolder.hospital.id !== hospital.id) {
    const conflictRec: PaymentRecord = {
      id: `pmt-${Date.now().toString(36)}`,
      orderId,
      paymentId,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      ownerUid: String(body.ownerUid || hospital.ownerUid),
      city: pending.city,
      specialty: pending.specialty,
      rank: pending.rank,
      amount: pending.amount,
      currency: 'INR',
      mode: pending.mode,
      status: 'conflict_not_charged',
      failureReason: 'This slot was just taken. No amount was charged',
      timestamp: nowMs,
    };
    paymentRecords.unshift(conflictRec);
    res.status(409).json({
      verified: true,
      activated: false,
      conflict: true,
      message: 'This slot was just taken. No amount was charged',
    });
    return;
  }

  const startMs = nowMs;
  const endMs = startMs + pending.durationMinutes * 60_000;
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  // Attempt transactional Firestore commit if caller supplied Firebase ID token
  const fsCommit = await tryFirestoreRestSponsoredCommit({
    authHeader: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    hospitalId: hospital.id,
    hospitalName: hospital.name,
    ownerUid: String(body.ownerUid || hospital.ownerUid),
    city: pending.city,
    specialty: pending.specialty,
    rank: pending.rank,
    orderId,
    paymentId,
    amount: pending.amount,
    mode: pending.mode,
    startIso,
    endIso,
    endMs,
  });
  if (fsCommit.conflict) {
    res.status(409).json({
      verified: true,
      activated: false,
      conflict: true,
      message: 'This slot was just taken. No amount was charged',
    });
    return;
  }

  // Automatic server-side activation (no manual approval anywhere)
  hospital.status = 'approved';
  hospital.sponsor_slots = {
    ...(hospital.sponsor_slots ?? {}),
    [pending.specialty]: {
      rank: pending.rank,
      startDate: startIso,
      endDate: endIso,
    },
  };
  syncLegacySponsorSummary(hospital);
  hospital.lastUpdatedAt = nowMs;

  // Claim matching waitlist entry for this hospital if any
  for (const w of sponsorWaitlist) {
    if (
      w.hospitalId === hospital.id &&
      w.city.trim().toLowerCase() === pending.city.toLowerCase() &&
      w.specialty === pending.specialty &&
      w.desiredRank === pending.rank &&
      (w.status === 'waiting' || w.status === 'notified')
    ) {
      w.status = 'claimed';
    }
  }

  const paidRec: PaymentRecord = {
    id: `pmt-${Date.now().toString(36)}`,
    orderId,
    paymentId,
    hospitalId: hospital.id,
    hospitalName: hospital.name,
    ownerUid: String(body.ownerUid || hospital.ownerUid),
    city: pending.city,
    specialty: pending.specialty,
    rank: pending.rank,
    amount: pending.amount,
    currency: 'INR',
    mode: pending.mode,
    status: 'paid',
    startIso,
    endIso,
    timestamp: nowMs,
  };
  paymentRecords.unshift(paidRec);

  const receipt: SponsorReceipt = {
    hospitalId: hospital.id,
    hospitalName: hospital.name,
    city: pending.city,
    specialty: pending.specialty,
    rank: pending.rank,
    orderId,
    paymentId,
    amount: pending.amount,
    startIso,
    endIso,
    durationMinutes: pending.durationMinutes,
  };

  recordEmailNotification(
    hospital.contactPerson?.email || 'hospital-desk@example.in',
    `Pinnacle Sponsored Slot Activated — Rank #${pending.rank} (${pending.specialty}, ${pending.city})`,
    `Hello ${hospital.name},\n\nYour Sponsored Rank #${pending.rank} placement for ${pending.specialty} in ${pending.city} is now LIVE.\nOrder ID: ${orderId}\nPayment ID: ${paymentId}\nAmount: ₹${pending.amount}\nValid Until: ${new Date(endMs).toLocaleString('en-IN')}\n\n— Pinnacle`
  );

  broadcastState('sponsorship_activated', { hospitalId: hospital.id, receipt });
  res.json({ verified: true, activated: true, hospital, receipt });
});

app.put('/api/admin/sponsored-slot', requireVerifiedAdmin, (req, res) => {
  const nowMs = Date.now();
  purgeExpiredSponsorships(nowMs);
  const body = req.body ?? {};
  const specialty = body.specialty as Specialty;
  const rank = Number(body.rank) as 1 | 2;
  const requestedCity = typeof body.city === 'string' && body.city.trim() ? body.city.trim() : '';
  const hospitalId = typeof body.hospitalId === 'string' && body.hospitalId.trim() ? body.hospitalId.trim() : null;
  const startDate =
    typeof body.startDate === 'string' && body.startDate.trim()
      ? body.startDate.trim()
      : new Date().toISOString().slice(0, 10);
  const endDate =
    typeof body.endDate === 'string' && body.endDate.trim()
      ? body.endDate.trim()
      : '2027-12-31';

  if (!SPECIALTIES.includes(specialty)) {
    res.status(400).json({ error: 'Invalid OPD specialty.' });
    return;
  }
  if (rank !== 1 && rank !== 2) {
    res.status(400).json({ error: 'Sponsor rank must be 1 or 2.' });
    return;
  }

  let targetHospital: HospitalRecord | undefined;
  if (hospitalId) {
    targetHospital = hospitals.find((h) => h.id === hospitalId);
    if (!targetHospital) {
      res.status(404).json({ error: 'Selected hospital was not found.' });
      return;
    }
    if (targetHospital.status !== 'approved') {
      res.status(400).json({ error: 'Only approved hospitals can hold a Sponsored slot.' });
      return;
    }
    if (!targetHospital.specialties.includes(specialty)) {
      res.status(400).json({ error: `${targetHospital.name} does not offer ${specialty}.` });
      return;
    }
  }

  const effectiveCity = (targetHospital?.city || requestedCity || 'Nagpur').trim().toLowerCase();

  for (const h of hospitals) {
    if (!h.sponsor_slots) continue;
    if (h.city.trim().toLowerCase() !== effectiveCity) continue;
    const existingSlot = h.sponsor_slots[specialty];
    if (existingSlot && (existingSlot.rank === rank || (hospitalId && h.id === hospitalId))) {
      delete h.sponsor_slots[specialty];
      syncLegacySponsorSummary(h);
      h.lastUpdatedAt = nowMs;
    }
  }

  if (targetHospital) {
    targetHospital.sponsor_slots = {
      ...(targetHospital.sponsor_slots ?? {}),
      [specialty]: { rank, startDate, endDate },
    };
    syncLegacySponsorSummary(targetHospital);
    targetHospital.lastUpdatedAt = nowMs;
  } else if (requestedCity) {
    promoteNextWaitlistEntry(requestedCity, specialty, rank, nowMs);
  }

  broadcastState('admin_updated_hospital', { city: effectiveCity, specialty, rank, hospitalId });
  res.json({ hospitals });
});

app.patch('/api/hospitals/:id/admin', requireVerifiedAdmin, (req, res) => {
  const { id } = req.params;
  const hospital = hospitals.find((h) => h.id === id);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found.' });
    return;
  }

  const { status, is_sponsored, sponsor_rank, sponsor_start_date, sponsor_end_date, sponsor_slots } = req.body ?? {};
  if (status === 'approved' || status === 'rejected' || status === 'pending') {
    hospital.status = status;
  }
  if (sponsor_slots && typeof sponsor_slots === 'object') {
    hospital.sponsor_slots = sponsor_slots;
    syncLegacySponsorSummary(hospital);
  } else {
    if (typeof is_sponsored === 'boolean') {
      hospital.is_sponsored = is_sponsored;
    }
    if (sponsor_rank === 1 || sponsor_rank === 2) {
      hospital.sponsor_rank = sponsor_rank;
    }
    if (typeof sponsor_start_date === 'string') {
      hospital.sponsor_start_date = sponsor_start_date;
    }
    if (typeof sponsor_end_date === 'string') {
      hospital.sponsor_end_date = sponsor_end_date;
    }
  }
  hospital.lastUpdatedAt = Date.now();
  broadcastState('admin_updated_hospital', hospital);
  res.json({ hospital });
});

// --- OTP endpoints (server-verified fallback alongside Firebase Phone Auth) ---
app.post('/api/otp/send', (req, res) => {
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  if (!/^[+\d\s-]{10,16}$/.test(phone)) {
    res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
    return;
  }
  const normalized = phone.replace(/[^\d+]/g, '');
  const code = '123456'; // Deterministic test code for preview mode; expires in 5 min
  otpStore.set(normalized, { code, expiresAt: Date.now() + 5 * 60_000, attempts: 0 });
  res.json({
    sent: true,
    maskedPhone: normalized.replace(/.(?=.{4})/g, '*'),
    previewHint: 'Demo OTP: 123456',
  });
});

app.post('/api/otp/verify', (req, res) => {
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().replace(/[^\d+]/g, '') : '';
  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
  const entry = otpStore.get(phone);
  if (!entry) {
    res.status(400).json({ error: 'Please request an OTP first.' });
    return;
  }
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phone);
    res.status(400).json({ error: 'OTP expired. Request a new code.' });
    return;
  }
  if (entry.attempts >= 5) {
    res.status(429).json({ error: 'Too many attempts. Request a new OTP.' });
    return;
  }
  entry.attempts += 1;
  if (otp !== entry.code) {
    res.status(400).json({ error: 'Invalid OTP code. Please check and try again.' });
    return;
  }
  otpStore.delete(phone);
  res.json({ verified: true, phone });
});

// --- Bookings ---
app.get('/api/bookings', async (req, res) => {
  const hospitalId = typeof req.query.hospitalId === 'string' ? req.query.hospitalId : undefined;
  const patientUid = typeof req.query.patientUid === 'string' ? req.query.patientUid : undefined;

  if (!patientUid) {
    const user = await extractVerifiedFirebaseUser(req);
    const authorized =
      Boolean(user?.emailVerified) &&
      (user?.email === OWNER_EMAIL || user?.email === ADMIN_EMAIL);
    if (!authorized) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
  } else if (patientUid === 'demo-patient') {
    res.json({ bookings: [] });
    return;
  }

  let rawList = hospitalId ? bookings.filter((b) => b.hospitalId === hospitalId) : bookings;
  if (patientUid) {
    rawList = rawList.filter((b) => b.patientUid === patientUid);
  }
  const enriched = rawList.map((b) => {
    if (b.PID || b.patientPid || b.patientUid.startsWith('walkin-')) return b;
    const prof = patientProfiles.get(b.patientUid);
    return prof?.pid ? { ...b, patientPid: prof.pid, PID: prof.pid } : b;
  });
  res.json({ bookings: enriched });
});

app.post('/api/bookings', async (req, res) => {
  const body = req.body ?? {};
  const hospital = hospitals.find((h) => h.id === body.hospitalId);
  if (!hospital || hospital.status !== 'approved') {
    res.status(404).json({ error: 'Selected hospital was not found.' });
    return;
  }
  if (!body.consentGiven) {
    res.status(400).json({ error: 'Data usage consent is required before booking.' });
    return;
  }
  if (!body.patientName || String(body.patientName).trim().length < 2) {
    res.status(400).json({ error: 'Patient full name is required.' });
    return;
  }
  if (!body.patientMobile || String(body.patientMobile).trim().length < 10) {
    res.status(400).json({ error: 'Verified patient mobile number is required.' });
    return;
  }

  const patientUid = String(body.patientUid || '').trim();
  const access = await getProfileAccess(req, patientUid);

if (access !== 'firebase' && access !== 'session') {
  return res.status(401).json({
    error: 'Verified patient login required.'
  });
}
  if (!patientUid || patientUid === 'demo-patient') {
    res.status(401).json({ error: 'Please sign in or register as a patient before booking an appointment.' });
    return;
  }

  const opdId = ((typeof body.opd_id === 'string' && body.opd_id.trim()) ||
    body.specialty ||
    hospital.specialties[0] ||
    'Eye OPD') as Specialty;
  const nowMs = Date.now();

  const maxHospitalToken = bookings
    .filter((b) => b.hospitalId === hospital.id)
    .reduce((max, b) => Math.max(max, b.tokenNumeric || 0), hospital.currentTokenNumber);
  const tokenNumeric = maxHospitalToken + 1;
  const prefix = String(opdId).slice(0, 3).toUpperCase();
  const tokenNumber = `${prefix}-${tokenNumeric}`;

  const activeOpdQueue = bookings.filter(
    (b) =>
      b.hospitalId === hospital.id &&
      (b.opd_id || b.specialty) === opdId &&
      (b.status === 'waiting' || b.status === 'called')
  );
  const queuePosition = activeOpdQueue.length + 1;
  const counters = Math.max(1, hospital.activeCounters);
  const initialEstimatedWaitMinutes = Math.round(
    ((queuePosition - 1) * hospital.avgConsultMinutes) / counters
  );

  const profileForPatient = await loadPatientProfile(patientUid);

if (!profileForPatient?.pid) {
  return res.status(404).json({
    error: 'Patient profile not found.'
  });
}

const resolvedPid = profileForPatient.pid;
  const requestedDoctorId = typeof body.doctorId === 'string' ? body.doctorId.trim() : '';
  const requestedDoctorName = typeof body.doctorName === 'string' ? body.doctorName.trim() : '';
  const matchedDoctor =
    (requestedDoctorId && hospital.doctors.find((d) => d.id === requestedDoctorId)) ||
    (requestedDoctorName && hospital.doctors.find((d) => d.name === requestedDoctorName)) ||
    null;

  const id = `bk-${nowMs.toString(36)}-${crypto.randomUUID().slice(0, 4)}`;
  const booking: BookingRecord = {
    id,
    queue_id: id,
    hospitalId: hospital.id,
    hospital_id: hospital.id,
    hospitalOwnerUid: hospital.ownerUid,
    hospitalName: hospital.name,
    hospitalAddress: hospital.address,
    hospitalLat: hospital.lat,
    hospitalLng: hospital.lng,
    doctorId: matchedDoctor?.id ?? null,
    doctor_id: matchedDoctor?.id ?? null,
    doctorName: matchedDoctor?.name || requestedDoctorName || `${opdId} Duty Doctor`,
    specialty: opdId,
    opd_id: opdId,
    patientUid,
    patient_id: patientUid,
    patientPid: resolvedPid,
    PID: resolvedPid,
    patientName: String(body.patientName).trim(),
    patientMobile: String(body.patientMobile).trim(),
    patientEmail: String(body.patientEmail || '').trim(),
    patientAge: Math.max(0, Math.min(120, Number(body.patientAge) || 30)),
    patientGender: body.patientGender || 'Male',
    reason: String(body.reason || 'Routine OPD consultation').trim(),
    date: String(body.date || getTodayStr()),
    timeSlot: body.isWalkIn ? 'Live Walk-In Queue' : String(body.timeSlot || '10:30 AM'),
    isWalkIn: Boolean(body.isWalkIn),
    tokenNumber,
    tokenNumeric,
    queuePosition,
    estimatedCallTimeIso: new Date(nowMs + initialEstimatedWaitMinutes * 60_000).toISOString(),
    initialEstimatedWaitMinutes,
    status: 'waiting',
    consentGiven: true,
    createdAt: nowMs,
    created_at: nowMs,
    updatedAt: nowMs,
  };

  try {
  await persistBooking(booking);
} catch (error) {
  console.error('Booking database error:', error);

  return res.status(500).json({
    error: 'Unable to save appointment. Please try again.'
  });
}

bookings.push(booking);
  hospital.patientsWaiting = bookings.filter(
    (b) => b.hospitalId === hospital.id && (b.status === 'waiting' || b.status === 'called')
  ).length;
  hospital.lastUpdatedAt = nowMs;
  if (hospital.analytics) hospital.analytics.patientsToday += 1;

  const emailPreview = recordEmailNotification(
    booking.patientEmail || `${booking.patientMobile}@sms.pinnacle.local`,
    `Pinnacle Appointment Confirmed — Token ${booking.tokenNumber} at ${hospital.name}`,
    `Hello ${booking.patientName},\n\nYour OPD booking is confirmed.\nHospital: ${hospital.name}\nOPD: ${opdId}\nAddress: ${hospital.address}\nToken: ${booking.tokenNumber} (Position #${booking.queuePosition})\nEstimated Wait: ~${initialEstimatedWaitMinutes} min\nDate & Slot: ${booking.date} (${booking.timeSlot})\n\nNot for medical emergencies. Call 108 / 112 in an emergency.\n— Pinnacle`
  );

  broadcastState('booking_created', { booking, hospital });
  res.status(201).json({ booking, hospital, emailPreview });
});

app.patch('/api/bookings/:id', (req, res) => {
  const { id } = req.params;
  const booking = bookings.find((b) => b.id === id);
  if (!booking) {
    res.status(404).json({ error: 'Booking not found.' });
    return;
  }

  const { action, date, timeSlot, status, queuePosition } = req.body ?? {};
  const hospital = hospitals.find((h) => h.id === booking.hospitalId);

  if (action === 'cancel' || status === 'cancelled') {
    booking.status = 'cancelled';
    booking.queuePosition = 0;
    if (hospital) {
      hospital.patientsWaiting = bookings.filter(
        (b) => b.hospitalId === hospital.id && (b.status === 'waiting' || b.status === 'called')
      ).length;
      hospital.lastUpdatedAt = Date.now();
    }
  } else if (action === 'reschedule') {
    if (typeof date === 'string' && date) booking.date = date;
    if (typeof timeSlot === 'string' && timeSlot) booking.timeSlot = timeSlot;
    booking.isWalkIn = false;
  } else if (
    status === 'waiting' ||
    status === 'called' ||
    status === 'completed' ||
    status === 'skipped' ||
    status === 'cancelled'
  ) {
    booking.status = status as BookingStatus;
  }
  if (typeof queuePosition === 'number') {
    booking.queuePosition = queuePosition;
  }
  booking.updatedAt = Date.now();

  broadcastState('booking_updated', { booking, hospital });
  res.json({ booking, hospital });
});

app.get('/api/admin/overview', requireVerifiedAdmin, (_req, res) => {
  purgeExpiredSponsorships(Date.now());
  const enrichedBookings = bookings.map((b) => {
    if (b.patientPid || b.patientUid.startsWith('walkin-')) return b;
    const prof = patientProfiles.get(b.patientUid);
    return prof?.pid ? { ...b, patientPid: prof.pid, PID: prof.pid } : b;
  });
  res.json({
    hospitals,
    bookings: enrichedBookings,
    emailPreviews,
    waitlist: sponsorWaitlist,
    paymentRecords,
    doctorCompletionNotices,
    sponsoredConfig: getSponsoredConfig(),
    stats: {
      totalHospitals: hospitals.length,
      approvedHospitals: hospitals.filter((h) => h.status === 'approved').length,
      pendingHospitals: hospitals.filter((h) => h.status === 'pending').length,
      sponsoredActive: hospitals
        .filter((h) => h.status === 'approved')
        .reduce((acc, h) => {
          const slotCount = h.sponsor_slots ? Object.keys(h.sponsor_slots).length : h.is_sponsored ? 1 : 0;
          return acc + slotCount;
        }, 0),
      totalBookings: bookings.length,
      activeWaiting: bookings.filter((b) => b.status === 'waiting' || b.status === 'called').length,
    },
  });
});

app.post('/api/admin/reset-data', requireVerifiedAdmin, (_req, res) => {
  const deleted = {
    patients: patientProfiles.size,
    bookings: bookings.length,
    prescriptions: prescriptions.length,
    healthVisits: healthVisits.length,
    dispensingRecords: dispensingRecords.length,
    auditLogs: recordAuditLogs.length,
  };

  bookings.length = 0;
  prescriptions.length = 0;
  healthVisits.length = 0;
  dispensingRecords.length = 0;
  recordAuditLogs.length = 0;
  doctorCompletionNotices.length = 0;
  emailPreviews.length = 0;
  patientProfiles.clear();
  issuedPids.clear();
  registeredPatients.clear();
  patientSessions.clear();

  const nowMs = Date.now();
  for (const h of hospitals) {
    h.patientsWaiting = 0;
    h.currentTokenNumber = 0;
    h.isPaused = false;
    h.pausedOpds = {};
    if (h.analytics) {
      h.analytics.patientsToday = 0;
    }
    h.lastUpdatedAt = nowMs;
  }

  broadcastState('data_reset', { timestamp: nowMs });
  res.json({ ok: true, deleted });
});

// --- Patient Authentication & Profile Endpoints ---
app.post('/api/patients/register', async (req, res) => {
  const body = req.body ?? {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const age = Number(body.age);
  const gender: 'Male' | 'Female' | 'Other' =
    body.gender === 'Female' || body.gender === 'Other' ? body.gender : 'Male';
  const historyConsent = body.historyConsent !== false;

  if (name.length < 2) {
    res.status(400).json({ error: 'Full name (at least 2 characters) is required.' });
    return;
  }
  if (!email.includes('@') || email.length < 5) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }
  if (phone.replace(/\D/g, '').length < 10) {
    res.status(400).json({ error: 'Valid 10-digit mobile number is required.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }
  for (const existing of registeredPatients.values()) {
    if (existing.email === email) {
      res.status(409).json({ error: 'A patient account with this email already exists. Please sign in.' });
      return;
    }
  }

  const nowMs = Date.now();
  const uid = `pat-${nowMs.toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
  const pid = getOrIssuePermanentPid(uid);
  const authRecord: InternalPatientAuth = {
    uid,
    pid,
    name,
    email,
    phone,
    age: Number.isFinite(age) && age >= 0 && age <= 120 ? Math.round(age) : 28,
    gender,
    passwordHash: hashStaffPasscode(password),
    createdAt: nowMs,
  };

  const profile = sanitizePatientProfile(uid, {
    uid,
    pid,
    historyConsent,
    displayName: name,
    email,
    phone,
    age: authRecord.age,
    gender,
    bloodGroup: body.bloodGroup || 'Unknown',
    allergies: Array.isArray(body.allergies) ? body.allergies : [],
    emergencyContacts: Array.isArray(body.emergencyContacts) ? body.emergencyContacts : [],
  });
  
const { error } = await supabaseAdmin.rpc(
  'register_patient_account',
  {
    p_uid: uid,
    p_pid: pid,
    p_email: email,
    p_phone: phone.replace(/\D/g, '').slice(-10),
    p_password_hash: authRecord.passwordHash,
    p_profile: profile
  }
);

if (error) {
  console.error('Registration database error:', error.code);

  res.status(error.code === '23505' ? 409 : 500).json({
    error: error.code === '23505'
      ? 'Account or patient ID already exists.'
      : 'Unable to register patient.'
  });
  return;
}

registeredPatients.set(uid, authRecord);
patientProfiles.set(uid, profile);


  const token = crypto.randomBytes(32).toString('hex');
  const session: PatientAuthSession = {
    uid,
    pid,
    displayName: profile.displayName,
    email: profile.email,
    phone: profile.phone,
    token,
    authMethod: 'password',
  };
  patientSessions.set(token, session);

  res.status(201).json({ session, profile });
});


app.post('/api/patients/login', async (req, res) => {
  try {
    const identifier = String(
      req.body?.identifier || ''
    ).trim().toLowerCase();

    const password = String(req.body?.password || '');

    if (!identifier || !password) {
      return res.status(400).json({
        error: 'Email/phone and password are required.'
      });
    }

    const isEmail = identifier.includes('@');

    const { data: account, error } = await supabaseAdmin
      .from('patient_accounts')
      .select('uid, password_hash')
      .eq(
        isEmail ? 'email' : 'phone',
        isEmail
          ? identifier
          : identifier.replace(/\D/g, '').slice(-10)
      )
      .maybeSingle();

    if (error) throw error;

    if (
      !account ||
      !verifyStaffPasscode(password, account.password_hash)
    ) {
      return res.status(401).json({
        error: 'Invalid patient credentials.'
      });
    }

    const profile = await loadPatientProfile(account.uid);

    if (!profile || !profile.pid) {
      return res.status(404).json({
        error: 'Patient profile not found.'
      });
    }

    patientProfiles.set(account.uid, profile);
    issuedPids.add(profile.pid);

    const token = crypto.randomBytes(32).toString('hex');

    const session: PatientAuthSession = {
      uid: account.uid,
      pid: profile.pid,
      displayName: profile.displayName,
      email: profile.email,
      phone: profile.phone,
      token,
      authMethod: 'password'
    };

    patientSessions.set(token, session);

    return res.json({ session, profile });

  } catch (error) {
    console.error('Patient login failed');

    return res.status(500).json({
      error: 'Unable to sign in.'
    });
  }
});


app.post('/api/patients/ensure', async (req, res) => {
  try {
    const verifiedUser = await extractVerifiedFirebaseUser(req);
    const body = req.body ?? {};

    // Local demonstration login only
    if (!verifiedUser) {
      const uid = String(body.uid || '').trim();

      if (
        process.env.NODE_ENV === 'production' ||
        req.headers.authorization ||
        !/^(phone-\d{10}|pat-[a-z0-9]+)$/.test(uid)
      ) {
        return res.status(401).json({
          error: 'Verified login required.'
        });
      }

      const existing = patientProfiles.get(uid);

      if (existing) {
        return res.json({
          profile: existing,
          pid: existing.pid
        });
      }

      const pid = getOrIssuePermanentPid(uid);

      const profile = sanitizePatientProfile(uid, {
        uid,
        pid,
        displayName: String(body.displayName || 'Demo Patient'),
        phone: String(body.phone || ''),
        historyConsent: body.historyConsent === true
      });

      patientProfiles.set(uid, profile);

      return res.json({ profile, pid });
    }

    // Firebase-verified patient
    const uid = verifiedUser.uid;

    let profile = await loadPatientProfile(uid);

    if (!profile) {
      const pid = getOrIssuePermanentPid(uid);

      const created = sanitizePatientProfile(uid, {
        uid,
        pid,
        displayName: verifiedUser.name || 'Patient',
        email: verifiedUser.email,
        phone: String(body.phone || ''),
        historyConsent: false,
        bloodGroup: 'Unknown',
        allergies: [],
        emergencyContacts: []
      });

      await persistNewPatientProfile(created);

      profile = await loadPatientProfile(uid);
    }

    if (!profile || !profile.pid) {
      throw new Error('Patient profile could not be loaded');
    }

    patientProfiles.set(uid, profile);
    issuedPids.add(profile.pid);

    return res.json({
      profile,
      pid: profile.pid
    });

  } catch (error) {
    console.error('Patient profile database error:', error);

    return res.status(500).json({
      error: 'Unable to load or create patient profile.'
    });
  }
});

app.post('/api/patients/logout', (req, res) => {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) {
    patientSessions.delete(match[1].trim());
  }
  res.json({ ok: true });
});


async function getProfileAccess(
  req: express.Request,
  uid: string
): Promise<'firebase' | 'session' | 'demo' | null> {

  const user = await extractVerifiedFirebaseUser(req);

  if (user) {
    return user.uid === uid ? 'firebase' : null;
  }

  const match = req.headers.authorization?.match(
    /^Bearer\s+(.+)$/i
  );

  if (match) {
    const session = patientSessions.get(match[1]);

    return session?.uid === uid ? 'session' : null;
  }

  if (
    !req.headers.authorization &&
    process.env.NODE_ENV !== 'production' &&
    /^(phone-\d{10}|pat-[a-z0-9]+)$/.test(uid) &&
    patientProfiles.has(uid) &&
    !registeredPatients.has(uid)
  ) {
    return 'demo';
  }

  return null;
}

app.get('/api/profile/:uid', async (req, res) => {
  try {
    const uid = req.params.uid;
    const access = await getProfileAccess(req, uid);

    if (!access) {
      return res.status(403).json({
        error: 'Access denied.'
      });
    }

    const profile = (access === 'firebase' || access === 'session')
  ? await loadPatientProfile(uid)
  : patientProfiles.get(uid) || null;

    if (profile) {
      patientProfiles.set(uid, profile);
    }

    return res.json({ profile });

  } catch {
    return res.status(500).json({
      error: 'Unable to load patient profile.'
    });
  }
});

app.put('/api/profile/:uid', async (req, res) => {
  try {
    const uid = req.params.uid;
    const access = await getProfileAccess(req, uid);

    if (!access) {
      return res.status(403).json({
        error: 'Access denied.'
      });
    }

    const existing = (access === 'firebase' || access === 'session')
  ? await loadPatientProfile(uid)
  : patientProfiles.get(uid);

    if (!existing) {
      return res.status(404).json({
        error: 'Patient profile not found.'
      });
    }

    const saved = sanitizePatientProfile(uid, {
      ...existing,
      ...req.body,
      uid,
      pid: existing.pid,
      email: existing.email,
      historyConsent:
        typeof req.body?.historyConsent === 'boolean'
          ? req.body.historyConsent
          : existing.historyConsent ?? false,
      updatedAt: Date.now()
    });

    if (access === 'firebase' || access === 'session') {
      const { error } = await supabaseAdmin
        .from('patient_profiles')
        .update({
          profile: saved,
          updated_at: new Date().toISOString()
        })
        .eq('uid', uid)
        .select('uid')
        .single();

      if (error) throw error;
    }

    patientProfiles.set(uid, saved);

    return res.json({
      profile: saved
    });

  } catch {
    return res.status(500).json({
      error: 'Unable to save patient profile.'
    });
  }
});

// --- Digital Health Records Endpoints (Staff Auth, Doctor, Medical, Patient) ---
app.post('/api/staff/login', (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const expectedRole = req.body?.role as StaffRole | undefined;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and passcode are required.' });
    return;
  }

  const account = staffAccounts.find((a) => a.email.toLowerCase() === email);
  if (!account || !verifyStaffPasscode(password, account.passwordHash)) {
    res.status(401).json({ error: 'Invalid hospital staff credentials.' });
    return;
  }
  if (expectedRole && account.role !== expectedRole) {
    res.status(403).json({
      error: `This account is registered under ${account.role === 'doctor' ? 'Doctor Login' : 'Medical Login'}.`,
    });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const session: ActiveStaffSession = {
    staffId: account.id,
    role: account.role,
    name: account.name,
    email: account.email,
    hospitalId: account.hospitalId,
    hospitalName: account.hospitalName,
    specialty: account.specialty,
    qualification: account.qualification,
    registrationNumber: account.registrationNumber,
    token,
  };
  staffSessions.set(token, session);
  res.json({ session });
});

app.post('/api/staff/logout', (req, res) => {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) {
    staffSessions.delete(match[1].trim());
  }
  res.json({ ok: true });
});

app.get('/api/staff/me', (req, res) => {
  const session = getAuthenticatedStaff(req);
  if (!session) {
    res.status(401).json({ error: 'Session expired or not signed in.' });
    return;
  }
  res.json({ session });
});

app.get('/api/hospitals/:hospitalId/staff', requireVerifiedOwner, (req, res) => {
  const { hospitalId } = req.params;
  const hospital = hospitals.find((h) => h.id === hospitalId);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found.' });
    return;
  }
  const list = staffAccounts.filter((a) => a.hospitalId === hospitalId).map(toPublicStaff);
  res.json({ staff: list });
});

app.post('/api/hospitals/:hospitalId/staff', requireVerifiedOwner, (req, res) => {
  const { hospitalId } = req.params;
  const hospital = hospitals.find((h) => h.id === hospitalId);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found.' });
    return;
  }
  const body = req.body ?? {};
  const role: StaffRole = body.role === 'medical' ? 'medical' : 'doctor';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const passcode = typeof body.passcode === 'string' ? body.passcode : '';
  const registrationNumber =
    typeof body.registrationNumber === 'string' ? body.registrationNumber.trim() : '';
  const qualification = typeof body.qualification === 'string' ? body.qualification.trim() : '';
  const specialty = (typeof body.specialty === 'string' && body.specialty.trim()
    ? body.specialty.trim()
    : hospital.specialties[0] || 'Eye OPD') as Specialty;

  if (name.length < 2) {
    res.status(400).json({ error: 'Staff full name is required.' });
    return;
  }
  if (!email.includes('@') || email.length < 5) {
    res.status(400).json({ error: 'Valid staff login email is required.' });
    return;
  }
  if (passcode.length < 6) {
    res.status(400).json({ error: 'Passcode must be at least 6 characters.' });
    return;
  }
  if (role === 'doctor') {
    if (!hospital.specialties.includes(specialty)) {
      res.status(400).json({ error: 'Doctor OPD/specialty must be one offered by this hospital.' });
      return;
    }
    if (registrationNumber.length < 3) {
      res.status(400).json({ error: 'Medical registration number is required for doctor accounts.' });
      return;
    }
  }
  if (staffAccounts.some((a) => a.email.toLowerCase() === email)) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const created: InternalStaffRecord = {
    id: `staff-${role}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`,
    role,
    hospitalId: hospital.id,
    hospitalName: hospital.name,
    name,
    email,
    specialty: role === 'doctor' ? specialty : undefined,
    qualification: role === 'doctor' ? qualification || 'MBBS' : undefined,
    registrationNumber: role === 'doctor' ? registrationNumber : undefined,
    createdAt: Date.now(),
    passwordHash: hashStaffPasscode(passcode),
  };

  staffAccounts.push(created);

  if (role === 'doctor') {
    hospital.doctors.push({
      id: created.id,
      name: created.name,
      qualification: created.qualification || 'MBBS',
      experienceYears: 5,
      specialty,
      availableToday: true,
    });
  }

  broadcastState('staff_created', { hospitalId: hospital.id, staffId: created.id });
  res.status(201).json({ account: toPublicStaff(created) });
});

app.delete('/api/hospitals/:hospitalId/notices/:noticeId', requireVerifiedOwner, (req, res) => {
  const { hospitalId, noticeId } = req.params;
  const idx = doctorCompletionNotices.findIndex(
    (n) => n.id === noticeId && n.hospitalId === hospitalId
  );
  if (idx !== -1) {
    doctorCompletionNotices.splice(idx, 1);
  }
  res.json({ ok: true });
});

function isBookingVisibleToDoctor(b: BookingRecord, session: ActiveStaffSession, hospital: HospitalRecord | null): boolean {
  if ((b.hospital_id || b.hospitalId) !== session.hospitalId) return false;
  if (b.status !== 'waiting' && b.status !== 'called') return false;
  const entryOpd = b.opd_id || b.specialty;
  if (session.specialty && entryOpd !== session.specialty) return false;

  const assignedDocId = b.doctor_id ?? b.doctorId;
  if (assignedDocId) {
    if (assignedDocId === session.staffId) return true;
    if (b.doctorName && b.doctorName.trim().toLowerCase() === session.name.trim().toLowerCase()) {
      return true;
    }
    return false;
  }
  if (b.doctorName && !b.doctorName.includes('Duty Doctor')) {
    if (b.doctorName === session.name) return true;
    // If named to another specific doctor in this hospital, keep isolated to that doctor
    if (hospital && hospital.doctors.some((d) => d.name === b.doctorName)) {
      return false;
    }
  }
  return true;
}

app.get('/api/doctor/workspace', requireStaffRole('doctor'), (req, res) => {
  const session = (req as express.Request & { staffSession: ActiveStaffSession }).staffSession;
  const hospital = hospitals.find((h) => h.id === session.hospitalId) || null;
  const queue = bookings
    .filter((b) => isBookingVisibleToDoctor(b, session, hospital))
    .sort((a, b) => (a.tokenNumeric - b.tokenNumeric) || (a.createdAt - b.createdAt))
    .map((b) => {
      if (b.PID || b.patientPid || b.patientUid.startsWith('walkin-')) return b;
      const prof = patientProfiles.get(b.patientUid);
      return prof?.pid ? { ...b, patientPid: prof.pid, PID: prof.pid } : b;
    });

  const consultations = healthVisits
    .filter((v) => v.hospitalId === session.hospitalId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const hospitalPrescriptions = prescriptions
    .filter((p) => p.hospital_id === session.hospitalId)
    .sort((a, b) => b.created_at - a.created_at);

  const templates = prescriptionTemplates.filter((t) => t.hospitalId === session.hospitalId);

  res.json({
    hospital,
    queue,
    consultations,
    prescriptions: hospitalPrescriptions,
    templates,
  });
});

app.get('/api/doctor/patient-history', requireStaffRole('doctor'), (req, res) => {
  const session = (req as express.Request & { staffSession: ActiveStaffSession }).staffSession;
  const hospital = hospitals.find((h) => h.id === session.hospitalId) || null;
  const bookingId = typeof req.query.bookingId === 'string' ? req.query.bookingId.trim() : '';

  const booking = bookings.find(
    (b) => b.id === bookingId && (b.hospital_id || b.hospitalId) === session.hospitalId
  );
  if (!booking || !isBookingVisibleToDoctor(booking, session, hospital)) {
    res.status(404).json({ error: 'Patient queue entry not found for your hospital / OPD.' });
    return;
  }

  const profile = booking.patientUid.startsWith('walkin-')
    ? undefined
    : patientProfiles.get(booking.patientUid);
  const pid = booking.PID || booking.patientPid || profile?.pid || null;

  if (!pid) {
    res.json({
      isWalkIn: true,
      consentGranted: false,
      history: [],
      patient: {
        name: booking.patientName,
        age: booking.patientAge,
        gender: booking.patientGender,
      },
    });
    return;
  }

  const consentGranted = profile?.historyConsent ?? true;
  if (!consentGranted) {
    res.json({
      isWalkIn: false,
      pid,
      consentGranted: false,
      history: [],
      message: 'This patient has turned off medical history sharing in their privacy settings.',
      patient: {
        name: booking.patientName,
        age: booking.patientAge,
        gender: booking.patientGender,
      },
    });
    return;
  }

  const nowMs = Date.now();
  const recentSame = recordAuditLogs.find(
    (log) =>
      log.bookingId === booking.id &&
      log.viewerId === session.staffId &&
      nowMs - log.viewedAt < 20_000
  );
  if (!recentSame) {
    const auditEntry: RecordAuditLogEntry = {
      id: `aud-${nowMs.toString(36)}-${crypto.randomUUID().slice(0, 4)}`,
      patientUid: booking.patientUid,
      patientPid: pid,
      viewerId: session.staffId,
      viewerName: session.name,
      viewerRole: 'doctor',
      viewerSpecialty: session.specialty,
      hospitalId: session.hospitalId,
      hospitalName: session.hospitalName,
      bookingId: booking.id,
      action: 'Viewed medical history during active OPD visit',
      viewedAt: nowMs,
    };
    recordAuditLogs.unshift(auditEntry);
  }

  const history = healthVisits
    .filter((v) => v.patientPid === pid || v.patientUid === booking.patientUid)
    .sort((a, b) => b.createdAt - a.createdAt);

  res.json({
    isWalkIn: false,
    pid,
    consentGranted: true,
    history,
    patient: {
      name: booking.patientName,
      age: booking.patientAge,
      gender: booking.patientGender,
    },
  });
});

app.post('/api/doctor/consultations', requireStaffRole('doctor'), (req, res) => {
  const session = (req as express.Request & { staffSession: ActiveStaffSession }).staffSession;
  const hospital = hospitals.find((h) => h.id === session.hospitalId);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital record not found.' });
    return;
  }

  const body = req.body ?? {};
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId.trim() : '';
  const booking = bookings.find(
    (b) => b.id === bookingId && (b.hospital_id || b.hospitalId) === session.hospitalId
  );
  if (!booking) {
    res.status(404).json({ error: 'Queue entry not found in your hospital.' });
    return;
  }

  const diagnosis = typeof body.diagnosis === 'string' ? body.diagnosis.trim() : '';
  if (!diagnosis) {
    res.status(400).json({ error: 'Diagnosis is required before saving prescription.' });
    return;
  }

  const rawMedicines = Array.isArray(body.medicines) ? body.medicines : [];
  const cleanMedicines: PrescriptionMedicineItem[] = rawMedicines
    .slice(0, 25)
    .filter((m: unknown) => m && typeof m === 'object' && String((m as PrescriptionMedicineItem).medicineName || '').trim())
    .map((m: PrescriptionMedicineItem, idx: number) => ({
      id: String(m.id || `med-${Date.now()}-${idx}`),
      medicineName: String(m.medicineName).trim().slice(0, 160),
      strength: String(m.strength || '').trim().slice(0, 64),
      when: Array.isArray(m.when) && m.when.length > 0 ? m.when : ['Morning'],
      foodTiming: m.foodTiming === 'Before food' ? 'Before food' : 'After food',
      howMuch: String(m.howMuch || '1 unit').trim().slice(0, 64),
      durationDays: Math.max(1, Math.min(365, Number(m.durationDays) || 5)),
      totalQuantity: String(m.totalQuantity || 'As directed').trim().slice(0, 64),
    }));

  if (body.sendToMedical && cleanMedicines.length === 0) {
    res.status(400).json({ error: 'Add at least one medicine before sending prescription to Medical.' });
    return;
  }

  const sharedMedicines: SharedPrescriptionMedicine[] = cleanMedicines.map((m) => ({
    id: m.id,
    name: m.medicineName,
    strength: m.strength,
    when: [...m.when],
    food_timing: m.foodTiming,
    how_much: m.howMuch,
    duration: m.durationDays,
    total_qty: m.totalQuantity,
  }));

  const nowMs = Date.now();
  const profile = booking.patientUid.startsWith('walkin-')
    ? undefined
    : patientProfiles.get(booking.patientUid);
  const resolvedPid = booking.PID || booking.patientPid || profile?.pid || null;
  const resolvedPatientId = booking.patientUid.startsWith('walkin-') ? null : booking.patientUid;
  const symptoms = String(body.symptoms || '').trim().slice(0, 500);
  const notes = String(body.notes || '').trim().slice(0, 500);
  const followUpDate =
    typeof body.followUpDate === 'string' && body.followUpDate.trim()
      ? body.followUpDate.trim().slice(0, 24)
      : undefined;

  let visit = healthVisits.find(
    (v) => v.bookingId === booking.id && v.hospitalId === session.hospitalId
  );

  if (visit) {
    visit.symptoms = symptoms;
    visit.diagnosis = diagnosis.slice(0, 300);
    visit.notes = notes;
    visit.followUpDate = followUpDate;
    visit.medicines = cleanMedicines;
    if (body.sendToMedical) {
      visit.medicalStatus = 'New';
      visit.dispensingSummary = undefined;
    }
    visit.updatedAt = nowMs;
  } else {
    visit = {
      id: `hv-${nowMs.toString(36)}-${crypto.randomUUID().slice(0, 4)}`,
      bookingId: booking.id,
      tokenNumber: booking.tokenNumber,
      patientUid: booking.patientUid,
      patientPid: resolvedPid ?? undefined,
      patientName: booking.patientName,
      patientAge: booking.patientAge,
      patientGender: booking.patientGender,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      hospitalAddress: hospital.address,
      city: hospital.city,
      doctorId: session.staffId,
      doctorName: session.name,
      doctorQualification: session.qualification || 'MBBS',
      doctorRegNumber: session.registrationNumber || 'MMC-REG',
      doctorSpecialty: session.specialty || booking.specialty,
      visitDate: new Date(nowMs).toISOString().slice(0, 10),
      visitTime: new Date(nowMs).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }),
      symptoms,
      diagnosis: diagnosis.slice(0, 300),
      notes,
      followUpDate,
      medicines: cleanMedicines,
      consultationStatus: 'in_progress',
      medicalStatus: 'New',
      createdAt: nowMs,
      updatedAt: nowMs,
    };
    healthVisits.unshift(visit);
  }

  let sharedPrescription = prescriptions.find(
    (p) => p.visit_id === visit!.id && p.hospital_id === session.hospitalId
  );
  if (sharedMedicines.length > 0) {
    if (sharedPrescription) {
      sharedPrescription.medicines = sharedMedicines;
      sharedPrescription.symptoms = symptoms;
      sharedPrescription.diagnosis = visit.diagnosis;
      sharedPrescription.notes = notes;
      sharedPrescription.follow_up_date = followUpDate;
      if (body.sendToMedical) {
        sharedPrescription.status = 'New';
        sharedPrescription.dispensing_summary = undefined;
        sharedPrescription.dispensing_details = undefined;
      }
      sharedPrescription.updated_at = nowMs;
    } else {
      sharedPrescription = {
        prescription_id: `rx-${nowMs.toString(36)}-${crypto.randomUUID().slice(0, 4)}`,
        visit_id: visit.id,
        booking_id: booking.id,
        token_number: booking.tokenNumber,
        patient_id: resolvedPatientId,
        patient_name: booking.patientName,
        patient_age: booking.patientAge,
        patient_gender: booking.patientGender,
        PID: resolvedPid,
        doctor_id: session.staffId,
        doctor_name: session.name,
        doctor_qualification: session.qualification || 'MBBS',
        doctor_reg_number: session.registrationNumber || 'MMC-REG',
        hospital_id: hospital.id,
        hospital_name: hospital.name,
        opd_id: session.specialty || booking.opd_id || booking.specialty,
        medicines: sharedMedicines,
        symptoms,
        diagnosis: visit.diagnosis,
        notes,
        follow_up_date: followUpDate,
        status: 'New',
        created_at: nowMs,
        updated_at: nowMs,
      };
      prescriptions.unshift(sharedPrescription);
    }
  }

  broadcastState('prescription_created', {
    hospitalId: session.hospitalId,
    prescription: sharedPrescription ?? null,
    visit,
  });
  broadcastState('health_records_updated', { hospitalId: session.hospitalId, visitId: visit.id });
  res.status(201).json({ visit, prescription: sharedPrescription ?? null });
});

app.post('/api/doctor/patient-left', requireStaffRole('doctor'), (req, res) => {
  const session = (req as express.Request & { staffSession: ActiveStaffSession }).staffSession;
  const bookingId = typeof req.body?.bookingId === 'string' ? req.body.bookingId.trim() : '';
  const booking = bookings.find(
    (b) => b.id === bookingId && (b.hospital_id || b.hospitalId) === session.hospitalId
  );
  if (!booking) {
    res.status(404).json({ error: 'Queue entry not found in your hospital.' });
    return;
  }

  // CRITICAL QUEUE RULE: Do NOT alter booking.status, booking.queuePosition, hospital.patientsWaiting, or wait times!
  const nowMs = Date.now();
  const visit = healthVisits.find(
    (v) => v.bookingId === booking.id && v.hospitalId === session.hospitalId
  );
  if (visit) {
    visit.consultationStatus = 'finished';
    visit.updatedAt = nowMs;
  }

  const notice: DoctorCompletionNotice = {
    id: `not-${nowMs.toString(36)}-${crypto.randomUUID().slice(0, 4)}`,
    hospitalId: session.hospitalId,
    doctorId: session.staffId,
    doctorName: session.name,
    tokenNumber: booking.tokenNumber,
    bookingId: booking.id,
    createdAt: nowMs,
  };
  doctorCompletionNotices.unshift(notice);
  if (doctorCompletionNotices.length > 30) doctorCompletionNotices.length = 30;

  broadcastState('doctor_finished_patient', { notice });
  res.json({ notice, visit: visit ?? null });
});

app.post('/api/doctor/templates', requireStaffRole('doctor'), (req, res) => {
  const session = (req as express.Request & { staffSession: ActiveStaffSession }).staffSession;
  const body = req.body ?? {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const diagnosis = typeof body.diagnosis === 'string' ? body.diagnosis.trim() : '';
  const rawMedicines = Array.isArray(body.medicines) ? body.medicines : [];
  if (name.length < 2 || rawMedicines.length === 0) {
    res.status(400).json({ error: 'Template name and at least one medicine are required.' });
    return;
  }

  const tpl: PrescriptionTemplate = {
    id: `tpl-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`,
    hospitalId: session.hospitalId,
    doctorId: session.staffId,
    name: name.slice(0, 120),
    diagnosis: diagnosis.slice(0, 240),
    medicines: rawMedicines.slice(0, 20),
    createdAt: Date.now(),
  };
  prescriptionTemplates.unshift(tpl);
  res.status(201).json({ template: tpl });
});

app.get('/api/medical/prescriptions', requireStaffRole('medical'), (req, res) => {
  const session = (req as express.Request & { staffSession: ActiveStaffSession }).staffSession;
  const hospital = hospitals.find((h) => h.id === session.hospitalId) || null;
  const list = prescriptions
    .filter((p) => p.hospital_id === session.hospitalId)
    .sort((a, b) => b.created_at - a.created_at);

  const history = dispensingRecords
    .filter((r) => r.hospitalId === session.hospitalId)
    .sort((a, b) => b.dispensedAt - a.dispensedAt);

  res.json({ hospital, prescriptions: list, dispensingHistory: history });
});

app.patch('/api/medical/prescriptions/:id', requireStaffRole('medical'), (req, res) => {
  const session = (req as express.Request & { staffSession: ActiveStaffSession }).staffSession;
  const { id } = req.params;
  const rx = prescriptions.find(
    (p) => (p.prescription_id === id || p.visit_id === id) && p.hospital_id === session.hospitalId
  );
  if (!rx) {
    res.status(404).json({ error: 'Prescription not found for your linked hospital.' });
    return;
  }

  const body = req.body ?? {};
  const nextStatus = body.status;
  if (nextStatus !== 'New' && nextStatus !== 'In progress' && nextStatus !== 'Completed') {
    res.status(400).json({ error: 'Invalid prescription status.' });
    return;
  }

  const nowMs = Date.now();
  const dateStr = new Date(nowMs).toISOString().slice(0, 10);
  const items: DispensingMedicineUpdate[] = Array.isArray(body.items) ? body.items : [];

  if (items.length > 0) {
    rx.dispensing_details = items.map((it) => ({
      medicineItemId: String(it.medicineItemId || ''),
      medicineName: String(it.medicineName || ''),
      strength: String(it.strength || ''),
      prescribedTotal: String(it.prescribedTotal || ''),
      status:
        it.status === 'Dispensed' || it.status === 'Out of stock' || it.status === 'Substituted'
          ? it.status
          : 'Pending',
      quantityDispensed: String(it.quantityDispensed || ''),
      note: it.note ? String(it.note).trim().slice(0, 200) : undefined,
    }));
  }

  rx.status = nextStatus;
  rx.updated_at = nowMs;

  if (nextStatus === 'Completed') {
    const details = rx.dispensing_details || [];
    const dispensedCount = details.filter(
      (d) => d.status === 'Dispensed' || d.status === 'Substituted'
    ).length;
    const outOfStockCount = details.filter((d) => d.status === 'Out of stock').length;

    if (dispensedCount > 0 && outOfStockCount > 0) {
      rx.dispensing_summary = 'Medicines partially collected';
    } else if (dispensedCount > 0) {
      rx.dispensing_summary = 'Medicines collected';
    } else if (outOfStockCount > 0) {
      rx.dispensing_summary = 'Out of stock at hospital medical';
    } else {
      rx.dispensing_summary = 'Medicines collected';
    }

    for (const item of details) {
      if (item.status === 'Pending') continue;
      dispensingRecords.unshift({
        id: `disp-${nowMs.toString(36)}-${crypto.randomUUID().slice(0, 4)}`,
        prescriptionId: rx.prescription_id,
        visitId: rx.visit_id,
        hospitalId: session.hospitalId,
        patientName: rx.patient_name,
        patientPid: rx.PID ?? undefined,
        medicineName: item.medicineName,
        strength: item.strength,
        quantityDispensed:
          item.status === 'Out of stock' ? '0' : item.quantityDispensed || item.prescribedTotal,
        status: item.status,
        note: item.note,
        staffId: session.staffId,
        staffName: session.name,
        dispensedAt: nowMs,
        date: dateStr,
      });
    }
  } else if (nextStatus === 'In progress') {
    rx.dispensing_summary = 'Dispensing in progress';
  }

  const visit = healthVisits.find(
    (v) => v.id === rx.visit_id && v.hospitalId === session.hospitalId
  );
  if (visit) {
    visit.medicalStatus = rx.status;
    visit.dispensingSummary = rx.dispensing_summary;
    visit.dispensingDetails = rx.dispensing_details;
    visit.updatedAt = nowMs;
  }

  broadcastState('medical_dispensed', {
    hospitalId: session.hospitalId,
    prescriptionId: rx.prescription_id,
    visitId: rx.visit_id,
    prescription: rx,
  });
  res.json({
    prescription: rx,
    dispensingHistory: dispensingRecords
      .filter((r) => r.hospitalId === session.hospitalId)
      .sort((a, b) => b.dispensedAt - a.dispensedAt),
  });
});

app.get('/api/medical/dispensing-history', requireStaffRole('medical'), (req, res) => {
  const session = (req as express.Request & { staffSession: ActiveStaffSession }).staffSession;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const dateFilter = typeof req.query.date === 'string' ? req.query.date.trim() : '';

  const filtered = dispensingRecords
    .filter((r) => r.hospitalId === session.hospitalId)
    .filter((r) => {
      if (dateFilter && r.date !== dateFilter) return false;
      if (!q) return true;
      return (
        r.patientName.toLowerCase().includes(q) ||
        (r.patientPid || '').toLowerCase().includes(q) ||
        r.medicineName.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => b.dispensedAt - a.dispensedAt);

  res.json({ dispensingHistory: filtered });
});

app.get('/api/health-records/:uid', (req, res) => {
  const uid = String(req.params.uid || '').trim().slice(0, 128);
  if (!uid || !/^[a-zA-Z0-9_-]+$/.test(uid)) {
    res.status(400).json({ error: 'Invalid user identifier.' });
    return;
  }

  const profile = patientProfiles.get(uid);
  if (!profile) {
    res.json({
      pid: null,
      historyConsent: true,
      visits: [],
      auditLogs: [],
    });
    return;
  }
  const pid = profile.pid || getOrIssuePermanentPid(uid);
  const historyConsent = profile.historyConsent ?? true;

  const visits = healthVisits
    .filter((v) => v.patientUid === uid || (pid && v.patientPid === pid))
    .sort((a, b) => b.createdAt - a.createdAt);

  const auditLogs = recordAuditLogs
    .filter((l) => l.patientUid === uid || (pid && l.patientPid === pid))
    .sort((a, b) => b.viewedAt - a.viewedAt);

  res.json({
    pid,
    historyConsent,
    visits,
    auditLogs,
  });
});

// --- Server-Side Google Maps Platform Proxies (avoids browser CORS trap) ---
app.post('/api/maps/route-matrix', async (req, res) => {
  const origin: Coordinates = req.body?.origin ?? { lat: 21.1458, lng: 79.0882 };
  const mode: TransportMode = req.body?.mode ?? 'car';
  const targetIds: string[] = Array.isArray(req.body?.hospitalIds) ? req.body.hospitalIds : [];
  const targets = hospitals.filter((h) => targetIds.length === 0 || targetIds.includes(h.id));

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey || targets.length === 0) {
    const fallback: Record<string, TravelEstimate> = {};
    for (const h of targets) {
      fallback[h.id] = estimateUrbanTravel(origin, { lat: h.lat, lng: h.lng }, mode);
    }
    res.json({ estimates: fallback, source: 'estimated' });
    return;
  }

  const travelModeMap: Record<TransportMode, string> = {
    car: 'DRIVE',
    bike: 'TWO_WHEELER',
    transit: 'TRANSIT',
  };

  try {
    const routesPayload = {
      origins: [
        {
          waypoint: {
            location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
          },
        },
      ],
      destinations: targets.slice(0, 25).map((h) => ({
        waypoint: {
          location: { latLng: { latitude: h.lat, longitude: h.lng } },
        },
      })),
      travelMode: travelModeMap[mode],
      routingPreference: mode === 'transit' ? undefined : 'TRAFFIC_AWARE',
    };

    const gmpRes = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition',
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      },
      body: JSON.stringify(routesPayload),
    });

    if (!gmpRes.ok) {
      const quotaHit = gmpRes.status === 429;
      const fallback: Record<string, TravelEstimate> = {};
      for (const h of targets) {
        fallback[h.id] = estimateUrbanTravel(origin, { lat: h.lat, lng: h.lng }, mode);
      }
      res.json({ estimates: fallback, source: 'estimated', quotaExceeded: quotaHit });
      return;
    }

    const elements = (await gmpRes.json()) as Array<{
      destinationIndex?: number;
      duration?: string;
      distanceMeters?: number;
      condition?: string;
    }>;

    const estimates: Record<string, TravelEstimate> = {};
    for (const h of targets) {
      estimates[h.id] = estimateUrbanTravel(origin, { lat: h.lat, lng: h.lng }, mode);
    }
    if (Array.isArray(elements)) {
      for (const el of elements) {
        if (typeof el.destinationIndex === 'number' && targets[el.destinationIndex] && el.condition === 'ROUTE_EXISTS') {
          const hosp = targets[el.destinationIndex];
          const seconds = parseInt(String(el.duration || '600').replace('s', ''), 10) || 600;
          const distKm = Number(((el.distanceMeters || 2000) / 1000).toFixed(1));
          estimates[hosp.id] = {
            distanceKm: distKm,
            travelMinutes: Math.max(2, Math.round(seconds / 60)),
            source: 'routes_api',
          };
        }
      }
    }

    res.json({ estimates, source: 'routes_api' });
  } catch {
    const fallback: Record<string, TravelEstimate> = {};
    for (const h of targets) {
      fallback[h.id] = estimateUrbanTravel(origin, { lat: h.lat, lng: h.lng }, mode);
    }
    res.json({ estimates: fallback, source: 'estimated' });
  }
});

app.post('/api/maps/place-reviews', async (req, res) => {
  const hospitalId = String(req.body?.hospitalId || '');
  const hospital = hospitals.find((h) => h.id === hospitalId);
  if (!hospital) {
    res.status(404).json({ error: 'Hospital not found' });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.json({
      rating: hospital.googleRating,
      reviewCount: hospital.reviewCount,
      reviews: hospital.recentReviews,
      source: 'seed',
    });
    return;
  }

  try {
    const placeRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.reviews',
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      },
      body: JSON.stringify({
        textQuery: `${hospital.name}, ${hospital.city}`,
        maxResultCount: 1,
      }),
    });

    if (!placeRes.ok) {
      res.json({
        rating: hospital.googleRating,
        reviewCount: hospital.reviewCount,
        reviews: hospital.recentReviews,
        source: 'seed',
        quotaExceeded: placeRes.status === 429,
      });
      return;
    }

    const data = (await placeRes.json()) as {
      places?: Array<{
        rating?: number;
        userRatingCount?: number;
        reviews?: Array<{
          rating?: number;
          relativePublishTimeDescription?: string;
          text?: { text?: string };
          authorAttribution?: { displayName?: string; uri?: string };
        }>;
      }>;
    };

    const place = data.places?.[0];
    if (!place) {
      res.json({
        rating: hospital.googleRating,
        reviewCount: hospital.reviewCount,
        reviews: hospital.recentReviews,
        source: 'seed',
      });
      return;
    }

    const mappedReviews = (place.reviews || []).slice(0, 3).map((r) => ({
      authorName: r.authorAttribution?.displayName || 'Google Reviewer',
      authorUri: r.authorAttribution?.uri,
      rating: r.rating || 5,
      relativeTime: r.relativePublishTimeDescription || 'Recently',
      text: r.text?.text || '',
    }));

    res.json({
      rating: place.rating ?? hospital.googleRating,
      reviewCount: place.userRatingCount ?? hospital.reviewCount,
      reviews: mappedReviews.length > 0 ? mappedReviews : hospital.recentReviews,
      source: 'places_api',
    });
  } catch {
    res.json({
      rating: hospital.googleRating,
      reviewCount: hospital.reviewCount,
      reviews: hospital.recentReviews,
      source: 'seed',
    });
  }
});

async function startServer() {

const { data: savedHospitals, error } = await supabaseAdmin
  .from('hospitals')
  .select('hospital_data');

if (error) {
  throw new Error('Failed to load hospitals from Supabase');
}

for (const row of savedHospitals || []) {
  const hospital = row.hospital_data as HospitalRecord;

  const existingIndex = hospitals.findIndex(
    (h) => h.id === hospital.id
  );

  if (existingIndex >= 0) {
    hospitals[existingIndex] = hospital;
  } else {
    hospitals.push(hospital);
  }
}

console.log('Hospitals loaded from Supabase:', savedHospitals?.length || 0);
const { data: savedBookings, error: bookingLoadError } =
  await supabaseAdmin
    .from('bookings')
    .select('booking_data');

if (bookingLoadError) {
  throw new Error('Failed to load bookings from Supabase');
}

for (const row of savedBookings || []) {
  bookings.push(row.booking_data as BookingRecord);
}

console.log(
  'Bookings loaded from Supabase:',
  savedBookings?.length || 0
);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pinnacle server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
