export type Specialty =
  | 'Eye OPD'
  | 'ENT'
  | 'Dental'
  | 'Cardiology'
  | 'Pediatrics'
  | 'Orthopedics'
  | 'General Physician'
  | 'Skin'
  | 'Gynecology';

export type TransportMode = 'car' | 'bike' | 'transit';

export type SortOption =
  | 'least_total_time'
  | 'nearest'
  | 'shortest_queue'
  | 'highest_rated'
  | 'lowest_fee';

export type Language = 'en' | 'hi' | 'mr';

export type QueueLevel = 'green' | 'amber' | 'red';

export type HospitalType =
  | 'Hospital'
  | 'Clinic'
  | 'Eye Centre'
  | 'Diagnostic Centre'
  | 'Polyclinic';

export interface DoctorInfo {
  id: string;
  name: string;
  qualification: string;
  experienceYears: number;
  specialty: Specialty;
  availableToday: boolean;
  photoUrl?: string;
}

export interface GoogleReviewAttribution {
  authorName: string;
  authorUri?: string;
  rating: number;
  relativeTime: string;
  text: string;
}

export interface SponsorSlotConfig {
  rank: 1 | 2;
  startDate?: string;
  endDate?: string;
}

export interface HospitalRecord {
  id: string;
  name: string;
  type: HospitalType;
  registrationNumber: string;
  yearEstablished: number;
  city: string;
  state: string;
  pincode: string;
  address: string;
  area: string;
  lat: number;
  lng: number;
  placeId?: string;
  deskPhone: string;
  specialties: Specialty[];
  doctors: DoctorInfo[];
  opdDays: string;
  opdTimings: string;
  openNow: boolean;
  consultationFee: number;
  avgConsultMinutes: number;
  activeCounters: number;
  patientsWaiting: number;
  currentTokenNumber: number;
  isPaused: boolean;
  pausedOpds?: Partial<Record<Specialty, boolean>>;
  isLiveQueue: boolean;
  historicalWaitMinutes: number;
  lastUpdatedAt: number; // epoch ms
  googleRating: number;
  reviewCount: number;
  recentReviews: GoogleReviewAttribution[];
  photoUrl: string;
  status: 'pending' | 'approved' | 'rejected';
  is_sponsored: boolean;
  sponsor_rank?: 1 | 2;
  sponsor_start_date?: string;
  sponsor_end_date?: string;
  sponsor_slots?: Partial<Record<Specialty, SponsorSlotConfig>>;
  ownerUid: string;
  contactPerson?: {
    name: string;
    designation: string;
    mobile: string;
    email: string;
    alternatePhone?: string;
    licenseDocName?: string;
  };
  analytics?: {
    patientsToday: number;
    avgWaitTodayMinutes: number;
  };
}

export interface TravelEstimate {
  distanceKm: number;
  travelMinutes: number;
  source: 'routes_api' | 'estimated';
}

export interface RankedHospital {
  hospital: HospitalRecord;
  distanceKm: number;
  travelMinutes: number;
  travelSource: 'routes_api' | 'estimated';
  estimatedWaitMinutes: number;
  waitAtArrivalMinutes: number;
  totalTimeMinutes: number;
  queueLevel: QueueLevel;
  isEstimatedQueue: boolean;
  isSponsoredSlot: boolean;
  sponsorRank?: 1 | 2;
}

export interface BestOptionSummary {
  hospitalId: string;
  hospitalName: string;
  totalTimeMinutes: number;
  travelMinutes: number;
  waitAtArrivalMinutes: number;
  consultMinutes: number;
  savedMinutesVsNext: number;
  explanation: string;
}

export type BookingStatus = 'waiting' | 'called' | 'completed' | 'skipped' | 'cancelled';

export interface BookingRecord {
  id: string;
  queue_id?: string;
  hospitalId: string;
  hospital_id?: string;
  hospitalOwnerUid: string;
  hospitalName: string;
  hospitalAddress: string;
  hospitalLat: number;
  hospitalLng: number;
  doctorId?: string | null;
  doctor_id?: string | null;
  doctorName: string;
  specialty: Specialty;
  opd_id?: Specialty;
  patientUid: string;
  patient_id?: string | null;
  patientPid?: string;
  PID?: string | null;
  patientName: string;
  patientMobile: string;
  patientEmail: string;
  patientAge: number;
  patientGender: 'Male' | 'Female' | 'Other';
  reason: string;
  date: string;
  timeSlot: string;
  isWalkIn: boolean;
  tokenNumber: string;
  tokenNumeric: number;
  queuePosition: number;
  estimatedCallTimeIso: string;
  initialEstimatedWaitMinutes: number;
  status: BookingStatus;
  consentGiven: boolean;
  createdAt: number;
  created_at?: number;
  updatedAt: number;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface EmailNotificationPreview {
  id: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
  channel: 'email';
}

export type BloodGroup =
  | 'A+'
  | 'A-'
  | 'B+'
  | 'B-'
  | 'AB+'
  | 'AB-'
  | 'O+'
  | 'O-'
  | 'Unknown';

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
}

export interface PatientProfile {
  uid: string;
  pid?: string;
  historyConsent?: boolean;
  displayName: string;
  email: string;
  phone: string;
  age?: number;
  gender: 'Male' | 'Female' | 'Other';
  bloodGroup: BloodGroup;
  allergies: string[];
  allergyNotes: string;
  chronicConditions: string;
  emergencyContacts: EmergencyContact[];
  updatedAt: number;
}

export interface PreviousDoctorSummary {
  hospitalId: string;
  hospitalName: string;
  doctorName: string;
  specialty: Specialty;
  lastVisitDate: string;
  visitCount: number;
  lastStatus: BookingStatus;
}

export interface SponsoredConfig {
  priceRank1: number;
  priceRank2: number;
  durationMinutes: number;
  paymentMode: 'razorpay' | 'mock';
  razorpayKeyId?: string;
}

export interface SponsoredSlotStatus {
  slotKey: string;
  city: string;
  specialty: Specialty;
  rank: 1 | 2;
  status: 'available' | 'occupied';
  occupiedUntilMs?: number;
  occupiedUntilIso?: string;
  updatedAt: number;
}

export interface SponsorWaitlistEntry {
  id: string;
  hospitalId: string;
  ownerUid: string;
  city: string;
  specialty: Specialty;
  desiredRank: 1 | 2;
  status: 'waiting' | 'notified' | 'claimed' | 'expired';
  createdAt: number;
  notifiedAt?: number;
  claimExpiresAt?: number;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  paymentId: string;
  hospitalId: string;
  hospitalName: string;
  ownerUid: string;
  city: string;
  specialty: Specialty;
  rank: 1 | 2;
  amount: number;
  currency: 'INR';
  mode: 'razorpay' | 'mock';
  status: 'paid' | 'failed' | 'conflict_not_charged';
  failureReason?: string;
  startIso?: string;
  endIso?: string;
  timestamp: number;
}

export interface SponsorReceipt {
  hospitalId: string;
  hospitalName: string;
  city: string;
  specialty: Specialty;
  rank: 1 | 2;
  orderId: string;
  paymentId: string;
  amount: number;
  startIso: string;
  endIso: string;
  durationMinutes: number;
}

// --- Digital Health Records Module Types ---

export type StaffRole = 'doctor' | 'medical';

export interface HospitalStaffAccount {
  id: string;
  role: StaffRole;
  hospitalId: string;
  hospitalName: string;
  name: string;
  email: string;
  specialty?: Specialty;
  qualification?: string;
  registrationNumber?: string;
  createdAt: number;
}

export interface ActiveStaffSession {
  staffId: string;
  role: StaffRole;
  name: string;
  email: string;
  hospitalId: string;
  hospitalName: string;
  specialty?: Specialty;
  qualification?: string;
  registrationNumber?: string;
  token: string;
}

export type MedicineTiming = 'Morning' | 'Afternoon' | 'Night';
export type MealRelation = 'Before food' | 'After food';

export interface PrescriptionMedicineItem {
  id: string;
  medicineName: string;
  strength: string;
  when: MedicineTiming[];
  foodTiming: MealRelation;
  howMuch: string;
  durationDays: number;
  totalQuantity: string;
}

export interface PrescriptionTemplate {
  id: string;
  hospitalId: string;
  doctorId: string;
  name: string;
  diagnosis: string;
  medicines: PrescriptionMedicineItem[];
  createdAt: number;
}

export type DispenseItemStatus = 'Pending' | 'Dispensed' | 'Out of stock' | 'Substituted';

export interface DispensingMedicineUpdate {
  medicineItemId: string;
  medicineName: string;
  strength: string;
  prescribedTotal: string;
  status: DispenseItemStatus;
  quantityDispensed: string;
  note?: string;
}

export type MedicalPrescriptionStatus = 'New' | 'In progress' | 'Completed';

export interface HealthVisitRecord {
  id: string;
  bookingId?: string;
  tokenNumber?: string;
  patientUid?: string;
  patientPid?: string;
  patientName: string;
  patientAge: number;
  patientGender: 'Male' | 'Female' | 'Other';
  hospitalId: string;
  hospitalName: string;
  hospitalAddress: string;
  city: string;
  doctorId: string;
  doctorName: string;
  doctorQualification: string;
  doctorRegNumber: string;
  doctorSpecialty: Specialty;
  visitDate: string;
  visitTime: string;
  symptoms: string;
  diagnosis: string;
  notes: string;
  followUpDate?: string;
  medicines: PrescriptionMedicineItem[];
  consultationStatus: 'in_progress' | 'finished';
  medicalStatus: MedicalPrescriptionStatus;
  dispensingSummary?: string;
  dispensingDetails?: DispensingMedicineUpdate[];
  createdAt: number;
  updatedAt: number;
}

export interface DispensingRecord {
  id: string;
  prescriptionId: string;
  visitId: string;
  hospitalId: string;
  patientName: string;
  patientPid?: string;
  medicineName: string;
  strength: string;
  quantityDispensed: string;
  status: DispenseItemStatus;
  note?: string;
  staffId: string;
  staffName: string;
  dispensedAt: number;
  date: string;
}

export interface RecordAuditLogEntry {
  id: string;
  patientUid: string;
  patientPid: string;
  viewerId: string;
  viewerName: string;
  viewerRole: 'doctor' | 'medical' | 'patient';
  viewerSpecialty?: string;
  hospitalId: string;
  hospitalName: string;
  bookingId?: string;
  action: string;
  viewedAt: number;
}

export interface DoctorCompletionNotice {
  id: string;
  hospitalId: string;
  doctorId: string;
  doctorName: string;
  tokenNumber: string;
  bookingId: string;
  createdAt: number;
}

export interface SeededMedicineOption {
  name: string;
  defaultStrength: string;
  defaultHowMuch: string;
  category: string;
}

export interface SharedPrescriptionMedicine {
  id: string;
  name: string;
  strength: string;
  when: MedicineTiming[];
  food_timing: MealRelation;
  how_much: string;
  duration: number;
  total_qty: string;
}

export interface SharedPrescriptionRecord {
  prescription_id: string;
  visit_id: string;
  booking_id?: string;
  token_number?: string;
  patient_id: string | null;
  patient_name: string;
  patient_age: number;
  patient_gender: 'Male' | 'Female' | 'Other';
  PID: string | null;
  doctor_id: string;
  doctor_name: string;
  doctor_qualification?: string;
  doctor_reg_number?: string;
  hospital_id: string;
  hospital_name: string;
  opd_id: Specialty;
  medicines: SharedPrescriptionMedicine[];
  symptoms: string;
  diagnosis: string;
  notes: string;
  follow_up_date?: string;
  status: MedicalPrescriptionStatus;
  dispensing_summary?: string;
  dispensing_details?: DispensingMedicineUpdate[];
  created_at: number;
  updated_at: number;
}

export interface PatientAuthSession {
  uid: string;
  pid: string;
  displayName: string;
  email: string;
  phone: string;
  token: string;
  authMethod: 'password' | 'google' | 'otp';
}

export interface ResetDataResult {
  ok: boolean;
  deleted: {
    patients: number;
    bookings: number;
    prescriptions: number;
    healthVisits: number;
    dispensingRecords: number;
    auditLogs: number;
  };
}
