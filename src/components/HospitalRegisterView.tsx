import { getFirebaseIdToken } from '../lib/firebase';
import { useCallback, useEffect, useState } from 'react';
import { APIProvider, AdvancedMarker, Map as GoogleMap } from '@vis.gl/react-google-maps';
import { CheckCircle2, Mail, Plus, Trash2 } from 'lucide-react';
import { SPECIALTIES } from '../data/seedHospitals';
import { subscribeToSponsoredSlots, syncWaitlistToFirestore } from '../lib/firebase';
import type {
  EmailNotificationPreview,
  HospitalRecord,
  HospitalType,
  Specialty,
  SponsoredConfig,
  SponsoredSlotStatus,
} from '../types/pinnacle';
import { formatDurationLabel, formatOccupiedUntil, formatShortClock } from '../utils/sponsorship';
import { SponsoredCheckoutModal } from './SponsoredCheckoutModal';

interface HospitalRegisterViewProps {
  ownerUid: string;
  sponsoredConfig?: SponsoredConfig;
  nowMs?: number;
  onRegistered: (hospital: HospitalRecord, emailPreview?: EmailNotificationPreview) => void;
  onSponsorshipActivated?: () => void;
}

const HOSPITAL_TYPES: HospitalType[] = [
  'Hospital',
  'Clinic',
  'Eye Centre',
  'Diagnostic Centre',
  'Polyclinic',
];

const DEFAULT_SPONSORED_CONFIG: SponsoredConfig = {
  priceRank1: 999,
  priceRank2: 699,
  durationMinutes: 10080,
  paymentMode: 'mock',
};

export function HospitalRegisterView({
  ownerUid,
  sponsoredConfig = DEFAULT_SPONSORED_CONFIG,
  nowMs: propNowMs,
  onRegistered,
  onSponsorshipActivated,
}: HospitalRegisterViewProps) {
  const nowMs = propNowMs ?? Date.now();
  const [step, setStep] = useState<number>(1);
  const [submittedHospital, setSubmittedHospital] = useState<HospitalRecord | null>(null);
  const [emailPreview, setEmailPreview] = useState<EmailNotificationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutModalState, setCheckoutModalState] = useState<{
    open: boolean;
    rank?: 1 | 2;
  }>({ open: false });
  const [waitlistBanner, setWaitlistBanner] = useState<string | null>(null);

  // Step 1: Basic info
  const [name, setName] = useState('');
  const [type, setType] = useState<HospitalType>('Eye Centre');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [yearEstablished, setYearEstablished] = useState('2018');

  // Step 2: Contact person
  const [contactName, setContactName] = useState('');
  const [designation, setDesignation] = useState('Medical Director');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');

  // Step 3: Location
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('Sitabuldi');
  const [city, setCity] = useState('Nagpur');
  const [stateName, setStateName] = useState('Maharashtra');
  const [pincode, setPincode] = useState('440012');
  const [lat, setLat] = useState(21.1458);
  const [lng, setLng] = useState(79.0882);

  // Step 4: OPD details
  const [selectedSpecialties, setSelectedSpecialties] = useState<Specialty[]>(['Eye OPD']);
  const [doctors, setDoctors] = useState([
    { name: '', qualification: 'MBBS, MS', experienceYears: 8, specialty: 'Eye OPD' as Specialty },
  ]);
  const [opdDays, setOpdDays] = useState('Mon - Sat');
  const [opdTimings, setOpdTimings] = useState('09:30 AM - 07:30 PM');
  const [avgConsultMinutes, setAvgConsultMinutes] = useState('10');
  const [consultationFee, setConsultationFee] = useState('450');
  const [activeCounters, setActiveCounters] = useState('2');

  // Step 5: Documents
  const [licenseDocName, setLicenseDocName] = useState('');
  const [photoDocName, setPhotoDocName] = useState('');

  // Step 6: Plan & Live Slot Status
  const [requestedPlan, setRequestedPlan] = useState<'free' | 'sponsor_1' | 'sponsor_2'>('free');
  const [slotConfig, setSlotConfig] = useState<SponsoredConfig>(sponsoredConfig);
  const [serverSlots, setServerSlots] = useState<SponsoredSlotStatus[]>([]);
  const [firestoreSlots, setFirestoreSlots] = useState<Partial<Record<1 | 2, SponsoredSlotStatus>>>(
    {}
  );

  const primarySpecialty = selectedSpecialties[0] || 'Eye OPD';

  const fetchStep6Slots = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        city: city.trim() || 'Nagpur',
        specialty: primarySpecialty,
      });
      const res = await fetch(`/api/sponsored/slots?${qs.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.config) setSlotConfig(data.config);
      if (Array.isArray(data.slots)) setServerSlots(data.slots);
    } catch {
      // ignore transient errors
    }
  }, [city, primarySpecialty]);

  useEffect(() => {
    if (step !== 6) return;
    void fetchStep6Slots();
    const unsub = subscribeToSponsoredSlots(city.trim() || 'Nagpur', primarySpecialty, (rank, st) => {
      setFirestoreSlots((prev) => {
        const next = { ...prev };
        if (st) next[rank] = st;
        else delete next[rank];
        return next;
      });
    });
    const sse = new EventSource('/api/stream');
    sse.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed.type !== 'connected') {
          void fetchStep6Slots();
        }
      } catch {
        // ignore heartbeat
      }
    };
    return () => {
      unsub();
      sse.close();
    };
  }, [step, city, primarySpecialty, fetchStep6Slots]);

  const getLiveSlot = (rank: 1 | 2): SponsoredSlotStatus => {
    const fs = firestoreSlots[rank];
    const srv = serverSlots.find((s) => s.rank === rank);
    const active = [srv, fs].filter((s): s is SponsoredSlotStatus => {
      if (!s || s.status !== 'occupied') return false;
      if (typeof s.occupiedUntilMs === 'number' && s.occupiedUntilMs <= nowMs) return false;
      return true;
    });
    if (active.length > 0) return active[0];
    return {
      slotKey: `${city}-${primarySpecialty}-${rank}`,
      city,
      specialty: primarySpecialty,
      rank,
      status: 'available',
      updatedAt: nowMs,
    };
  };

  const slot1 = getLiveSlot(1);
  const slot2 = getLiveSlot(2);
  const rank1Occupied = slot1.status === 'occupied';
  const rank2Occupied = slot2.status === 'occupied';
  const bothOccupied = rank1Occupied && rank2Occupied;
  const earliestFreeMs = (() => {
    const times = [slot1.occupiedUntilMs, slot2.occupiedUntilMs].filter(
      (v): v is number => typeof v === 'number' && v > nowMs
    );
    return times.length > 0 ? Math.min(...times) : null;
  })();

  useEffect(() => {
    if (requestedPlan === 'sponsor_1' && rank1Occupied) {
      setRequestedPlan(!rank2Occupied ? 'sponsor_2' : 'free');
    } else if (requestedPlan === 'sponsor_2' && rank2Occupied) {
      setRequestedPlan(!rank1Occupied ? 'sponsor_1' : 'free');
    }
  }, [requestedPlan, rank1Occupied, rank2Occupied]);

  const toggleSpecialty = (sp: Specialty) => {
    setSelectedSpecialties((prev) =>
      prev.includes(sp) ? (prev.length > 1 ? prev.filter((x) => x !== sp) : prev) : [...prev, sp]
    );
  };

  const validateStep = (s: number): boolean => {
    setError(null);
    if (s === 1 && (name.trim().length < 2 || registrationNumber.trim().length < 3)) {
      setError('Please enter hospital name and registration/license number.');
      return false;
    }
    if (s === 2 && (contactName.trim().length < 2 || mobile.trim().length < 10 || !email.includes('@'))) {
      setError('Please provide contact person name, valid mobile, and email.');
      return false;
    }
    if (s === 3 && (address.trim().length < 5 || !/^[0-9]{6}$/.test(pincode.trim()))) {
      setError('Please enter full street address and a 6-digit pincode.');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const cleanedDoctors = doctors
        .filter((d) => d.name.trim().length >= 2)
        .map((d, idx) => ({
          id: `reg-doc-${idx}`,
          name: d.name.trim(),
          qualification: d.qualification.trim() || 'MBBS',
          experienceYears: Number(d.experienceYears) || 5,
          specialty: d.specialty,
          availableToday: true,
        }));
      const token = await getFirebaseIdToken();
      const res = await fetch('/api/hospitals/register', {
        method: 'POST',
        headers: {
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
},
        body: JSON.stringify({
          name: name.trim(),
          type,
          registrationNumber: registrationNumber.trim(),
          yearEstablished: Number(yearEstablished) || 2018,
          contactPerson: {
            name: contactName.trim(),
            designation: designation.trim(),
            mobile: mobile.trim(),
            email: email.trim(),
            alternatePhone: alternatePhone.trim(),
            licenseDocName: licenseDocName || 'clinic-registration.pdf',
          },
          address: address.trim(),
          area: area.trim(),
          city: city.trim(),
          state: stateName.trim(),
          pincode: pincode.trim(),
          lat,
          lng,
          specialties: selectedSpecialties,
          doctors: cleanedDoctors,
          opdDays,
          opdTimings,
          avgConsultMinutes: Number(avgConsultMinutes) || 10,
          consultationFee: Number(consultationFee) || 400,
          activeCounters: Number(activeCounters) || 1,
          requestedPlan,
          ownerUid,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not submit registration.');
        setSubmitting(false);
        return;
      }
      setSubmittedHospital(data.hospital);
      setEmailPreview(data.emailPreview || null);
      onRegistered(data.hospital, data.emailPreview);

      if (requestedPlan === 'sponsor_1' || requestedPlan === 'sponsor_2') {
        const chosenRank = requestedPlan === 'sponsor_1' ? 1 : 2;
        setCheckoutModalState({ open: true, rank: chosenRank });
      }
    } catch {
      setError('Network error while submitting hospital registration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterAndJoinWaitlist = async (desiredRank: 1 | 2) => {
    setError(null);
    setSubmitting(true);
    try {
      const cleanedDoctors = doctors
        .filter((d) => d.name.trim().length >= 2)
        .map((d, idx) => ({
          id: `reg-doc-${idx}`,
          name: d.name.trim(),
          qualification: d.qualification.trim() || 'MBBS',
          experienceYears: Number(d.experienceYears) || 5,
          specialty: d.specialty,
          availableToday: true,
        }));
      const token = await getFirebaseIdToken();

if (!token) {
  setError('Please sign in with Google to register a hospital.');
  return;
}
      const regRes = await fetch('/api/hospitals/register', {
        method: 'POST',
        headers: {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
},
        body: JSON.stringify({
          name: name.trim(),
          type,
          registrationNumber: registrationNumber.trim(),
          yearEstablished: Number(yearEstablished) || 2018,
          contactPerson: {
            name: contactName.trim(),
            designation: designation.trim(),
            mobile: mobile.trim(),
            email: email.trim(),
            alternatePhone: alternatePhone.trim(),
            licenseDocName: licenseDocName || 'clinic-registration.pdf',
          },
          address: address.trim(),
          area: area.trim(),
          city: city.trim(),
          state: stateName.trim(),
          pincode: pincode.trim(),
          lat,
          lng,
          specialties: selectedSpecialties,
          doctors: cleanedDoctors,
          opdDays,
          opdTimings,
          avgConsultMinutes: Number(avgConsultMinutes) || 10,
          consultationFee: Number(consultationFee) || 400,
          activeCounters: Number(activeCounters) || 1,
          requestedPlan: 'free',
          ownerUid,
        }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) {
        setError(regData.error || 'Could not submit registration.');
        return;
      }

      const wlRes = await fetch('/api/sponsored/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalId: regData.hospital.id,
          specialty: primarySpecialty,
          desiredRank,
          ownerUid,
        }),
      });
      const wlData = await wlRes.json();
      if (wlRes.ok && wlData.entry) {
        await syncWaitlistToFirestore(wlData.entry);
      }

      setSubmittedHospital(regData.hospital);
      setEmailPreview(regData.emailPreview || null);
      setWaitlistBanner(
        `Joined the Rank ${desiredRank} waitlist for ${primarySpecialty} (${city}). You will see a claim banner on your Hospital Desk when it opens.`
      );
      onRegistered(regData.hospital, regData.emailPreview);
      onSponsorshipActivated?.();
    } catch {
      setError('Network error while joining waitlist.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedHospital) {
    const isSponsoredActive = Boolean(submittedHospital.is_sponsored);
    return (
      <div className="bg-white border border-[#E2E6EC] rounded-md p-6 max-w-2xl mx-auto space-y-4">
        <div
          className={`p-4 border rounded flex items-start gap-3 ${
            isSponsoredActive
              ? 'bg-[#ECFDF5] border-[#BBF7D0]'
              : 'bg-[#FFFBEB] border-[#FDE68A]'
          }`}
        >
          <CheckCircle2
            className={`w-5 h-5 shrink-0 mt-0.5 ${
              isSponsoredActive ? 'text-[#15803D]' : 'text-[#B45309]'
            }`}
            aria-hidden="true"
          />
          <div>
            <h2 className="text-base font-semibold text-[#111827]">
              {isSponsoredActive
                ? 'Sponsored Placement Active — Hospital Live on Pinnacle'
                : 'Application Submitted — Status: Under Review'}
            </h2>
            <p className="text-xs sm:text-sm text-[#374151] mt-1">
              {isSponsoredActive ? (
                <>
                  <strong>{submittedHospital.name}</strong> ({submittedHospital.id}) is now live in the top sponsored slots for {primarySpecialty} in {submittedHospital.city}.
                </>
              ) : (
                <>
                  <strong>{submittedHospital.name}</strong> ({submittedHospital.id}) has been added to the Pinnacle Admin approval queue.
                </>
              )}
            </p>
          </div>
        </div>

        {waitlistBanner && (
          <div className="p-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded text-xs text-[#1F5FA8] font-medium">
            {waitlistBanner}
          </div>
        )}

        {emailPreview && (
          <div className="border border-[#E2E6EC] rounded p-4 bg-[#F9FAFB] text-xs space-y-1">
            <div className="font-semibold text-[#111827] flex items-center gap-1.5">
              <Mail className="w-4 h-4 text-[#1F5FA8]" aria-hidden="true" />
              Confirmation Email Sent to {emailPreview.to}
            </div>
            <p className="font-medium text-[#374151]">{emailPreview.subject}</p>
            <pre className="whitespace-pre-wrap font-sans text-[#4B5563] mt-1">
              {emailPreview.body}
            </pre>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!submittedHospital.is_sponsored && (
            <button
              type="button"
              onClick={() => setCheckoutModalState({ open: true })}
              className="px-4 py-2 text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87]"
            >
              Sponsor OPD Slot Now
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSubmittedHospital(null);
              setWaitlistBanner(null);
              setStep(1);
              setName('');
            }}
            className="px-4 py-2 text-sm font-medium border border-[#D1D5DB] rounded text-[#374151] hover:bg-[#F5F6F8]"
          >
            Register Another Facility
          </button>
        </div>

        {checkoutModalState.open && (
          <SponsoredCheckoutModal
            hospital={submittedHospital}
            initialSpecialty={primarySpecialty}
            initialRank={checkoutModalState.rank}
            config={slotConfig}
            nowMs={nowMs}
            onClose={() => setCheckoutModalState({ open: false })}
            onActivated={(receipt) => {
              setSubmittedHospital((prev) =>
                prev
                  ? {
                      ...prev,
                      status: 'approved',
                      is_sponsored: true,
                      sponsor_rank: receipt.rank,
                      sponsor_start_date: receipt.startIso,
                      sponsor_end_date: receipt.endIso,
                      sponsor_slots: {
                        ...(prev.sponsor_slots ?? {}),
                        [receipt.specialty]: {
                          rank: receipt.rank,
                          startDate: receipt.startIso,
                          endDate: receipt.endIso,
                        },
                      },
                    }
                  : prev
              );
              onSponsorshipActivated?.();
            }}
            onWaitlistJoined={() => {
              onSponsorshipActivated?.();
            }}
          />
        )}
      </div>
    );
  }

  const STEP_LABELS = [
    '1. Basic Info',
    '2. Contact',
    '3. Location',
    '4. OPD Details',
    '5. Documents',
    '6. Plan',
  ];

  return (
    <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-[#111827]">Register Your Hospital on Pinnacle</h1>
      <p className="text-sm text-[#4B5563] mt-0.5">
        Join Nagpur&apos;s live OPD queue network. Registrations are verified by our admin team before going live.
      </p>

      {/* Stepper */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-4 pb-4 border-b border-[#E2E6EC]">
        {STEP_LABELS.map((label, idx) => {
          const sNum = idx + 1;
          const active = step === sNum;
          const done = step > sNum;
          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (sNum < step) setStep(sNum);
              }}
              className={`px-2 py-2 text-xs font-medium rounded border text-left ${
                active
                  ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                  : done
                    ? 'bg-[#EFF6FF] text-[#1F5FA8] border-[#BFDBFE]'
                    : 'bg-[#F9FAFB] text-[#6B7280] border-[#E2E6EC]'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 p-3 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs sm:text-sm rounded">
          {error}
        </div>
      )}

      <div className="mt-5 space-y-4">
        {step === 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label htmlFor="reg-name" className="block text-xs font-medium text-[#374151] mb-1">
                Hospital / Clinic Name *
              </label>
              <input
                id="reg-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Nayan Jyoti Eye Clinic"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>
            <div>
              <label htmlFor="reg-type" className="block text-xs font-medium text-[#374151] mb-1">
                Facility Type *
              </label>
              <select
                id="reg-type"
                value={type}
                onChange={(e) => setType(e.target.value as HospitalType)}
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm bg-white"
              >
                {HOSPITAL_TYPES.map((ht) => (
                  <option key={ht} value={ht}>
                    {ht}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="reg-num" className="block text-xs font-medium text-[#374151] mb-1">
                Registration / License Number *
              </label>
              <input
                id="reg-num"
                type="text"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="e.g. MH-NGP-EYE-7812"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>
            <div>
              <label htmlFor="reg-year" className="block text-xs font-medium text-[#374151] mb-1">
                Year Established
              </label>
              <input
                id="reg-year"
                type="number"
                value={yearEstablished}
                onChange={(e) => setYearEstablished(e.target.value)}
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="reg-cname" className="block text-xs font-medium text-[#374151] mb-1">
                Contact Person Full Name *
              </label>
              <input
                id="reg-cname"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Dr. / Mr. / Ms."
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>
            <div>
              <label htmlFor="reg-desig" className="block text-xs font-medium text-[#374151] mb-1">
                Designation
              </label>
              <input
                id="reg-desig"
                type="text"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>
            <div>
              <label htmlFor="reg-mob" className="block text-xs font-medium text-[#374151] mb-1">
                Mobile Number *
              </label>
              <input
                id="reg-mob"
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="+91 98XXXXXXXX"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>
            <div>
              <label htmlFor="reg-email" className="block text-xs font-medium text-[#374151] mb-1">
                Official Email *
              </label>
              <input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="desk@hospital.in"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>
            <div>
              <label htmlFor="reg-alt" className="block text-xs font-medium text-[#374151] mb-1">
                Alternate Phone
              </label>
              <input
                id="reg-alt"
                type="tel"
                value={alternatePhone}
                onChange={(e) => setAlternatePhone(e.target.value)}
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3.5">
            <div>
              <label htmlFor="reg-addr" className="block text-xs font-medium text-[#374151] mb-1">
                Full Street Address *
              </label>
              <input
                id="reg-addr"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Plot/Building, Street, Landmark"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label htmlFor="reg-area" className="block text-xs font-medium text-[#374151] mb-1">
                  Area / Locality
                </label>
                <input
                  id="reg-area"
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
                />
              </div>
              <div>
                <label htmlFor="reg-city" className="block text-xs font-medium text-[#374151] mb-1">
                  City *
                </label>
                <input
                  id="reg-city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
                />
              </div>
              <div>
                <label htmlFor="reg-state" className="block text-xs font-medium text-[#374151] mb-1">
                  State
                </label>
                <input
                  id="reg-state"
                  type="text"
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
                />
              </div>
              <div>
                <label htmlFor="reg-pin" className="block text-xs font-medium text-[#374151] mb-1">
                  Pincode *
                </label>
                <input
                  id="reg-pin"
                  type="text"
                  maxLength={6}
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
                />
              </div>
            </div>

            <div className="p-3 bg-[#F5F6F8] border border-[#E2E6EC] rounded">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-[#374151]">
                  Map Pin Coordinates (Click preset Nagpur hub or fine-tune lat/lng)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'Sitabuldi', lat: 21.1445, lng: 79.0835 },
                    { label: 'Dhantoli', lat: 21.1329, lng: 79.0785 },
                    { label: 'Dharampeth', lat: 21.1422, lng: 79.0631 },
                    { label: 'Sadar', lat: 21.1618, lng: 79.0802 },
                  ].map((hub) => (
                    <button
                      key={hub.label}
                      type="button"
                      onClick={() => {
                        setLat(hub.lat);
                        setLng(hub.lng);
                        setArea(hub.label);
                      }}
                      className="px-2 py-1 text-[11px] bg-white border border-[#D1D5DB] rounded hover:bg-[#EFF6FF] text-[#1F5FA8]"
                    >
                      {hub.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-[11px] text-[#6B7280]">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lat}
                    onChange={(e) => setLat(Number(e.target.value))}
                    className="w-full h-9 px-2 bg-white border border-[#D1D5DB] rounded text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#6B7280]">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lng}
                    onChange={(e) => setLng(Number(e.target.value))}
                    className="w-full h-9 px-2 bg-white border border-[#D1D5DB] rounded text-xs tabular-nums"
                  />
                </div>
              </div>

              {import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? (
                <div className="h-48 w-full rounded overflow-hidden border border-[#D1D5DB]">
                  <APIProvider
                    apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string}
                    libraries={['marker']}
                    language="en"
                    region="IN"
                  >
                    <GoogleMap
                      mapId="DEMO_MAP_ID"
                      center={{ lat, lng }}
                      defaultZoom={13}
                      gestureHandling="greedy"
                      internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                      style={{ width: '100%', height: '100%' }}
                      onClick={(e) => {
                        if (e.detail.latLng) {
                          setLat(Number(e.detail.latLng.lat.toFixed(4)));
                          setLng(Number(e.detail.latLng.lng.toFixed(4)));
                        }
                      }}
                    >
                      <AdvancedMarker
                        position={{ lat, lng }}
                        draggable
                        onDragEnd={(e) => {
                          if (e.latLng) {
                            setLat(Number(e.latLng.lat().toFixed(4)));
                            setLng(Number(e.latLng.lng().toFixed(4)));
                          }
                        }}
                        title="Drag to set hospital OPD entrance"
                      >
                        <div className="px-2 py-0.5 bg-[#1F5FA8] text-white text-[11px] font-semibold rounded border border-white shadow">
                          OPD Pin
                        </div>
                      </AdvancedMarker>
                    </GoogleMap>
                  </APIProvider>
                </div>
              ) : (
                <div className="text-[11px] text-[#6B7280]">
                  Pin preview centered at {lat.toFixed(4)}, {lng.toFixed(4)} ({area}, Nagpur).
                </div>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <span className="block text-xs font-medium text-[#374151] mb-1.5">
                Specialties Offered *
              </span>
              <div className="flex flex-wrap gap-2">
                {SPECIALTIES.map((sp) => {
                  const selected = selectedSpecialties.includes(sp);
                  return (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => toggleSpecialty(sp)}
                      className={`px-3 py-1.5 text-xs font-medium rounded border ${
                        selected
                          ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                          : 'bg-white text-[#374151] border-[#D1D5DB]'
                      }`}
                    >
                      {sp}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-[#374151]">Doctors</span>
                <button
                  type="button"
                  onClick={() =>
                    setDoctors((prev) => [
                      ...prev,
                      {
                        name: '',
                        qualification: 'MBBS, MS',
                        experienceYears: 5,
                        specialty: selectedSpecialties[0] || 'Eye OPD',
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1F5FA8]"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Add Doctor
                </button>
              </div>
              <div className="space-y-2">
                {doctors.map((doc, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Doctor name"
                      value={doc.name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDoctors((prev) => prev.map((d, i) => (i === idx ? { ...d, name: val } : d)));
                      }}
                      className="sm:col-span-5 h-9 px-2.5 border border-[#D1D5DB] rounded text-xs"
                    />
                    <input
                      type="text"
                      placeholder="Qualification"
                      value={doc.qualification}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDoctors((prev) =>
                          prev.map((d, i) => (i === idx ? { ...d, qualification: val } : d))
                        );
                      }}
                      className="sm:col-span-4 h-9 px-2.5 border border-[#D1D5DB] rounded text-xs"
                    />
                    <input
                      type="number"
                      placeholder="Yrs"
                      value={doc.experienceYears}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDoctors((prev) =>
                          prev.map((d, i) => (i === idx ? { ...d, experienceYears: val } : d))
                        );
                      }}
                      className="sm:col-span-2 h-9 px-2.5 border border-[#D1D5DB] rounded text-xs"
                    />
                    {doctors.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setDoctors((prev) => prev.filter((_, i) => i !== idx))}
                        className="sm:col-span-1 h-9 inline-flex items-center justify-center text-[#B91C1C]"
                        aria-label="Remove doctor"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">OPD Days</label>
                <input
                  type="text"
                  value={opdDays}
                  onChange={(e) => setOpdDays(e.target.value)}
                  className="w-full h-9 px-2.5 border border-[#D1D5DB] rounded text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">OPD Timings</label>
                <input
                  type="text"
                  value={opdTimings}
                  onChange={(e) => setOpdTimings(e.target.value)}
                  className="w-full h-9 px-2.5 border border-[#D1D5DB] rounded text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">Avg Consult (min)</label>
                <input
                  type="number"
                  value={avgConsultMinutes}
                  onChange={(e) => setAvgConsultMinutes(e.target.value)}
                  className="w-full h-9 px-2.5 border border-[#D1D5DB] rounded text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">OPD Fee (₹)</label>
                <input
                  type="number"
                  value={consultationFee}
                  onChange={(e) => setConsultationFee(e.target.value)}
                  className="w-full h-9 px-2.5 border border-[#D1D5DB] rounded text-xs"
                />
              </div>
            </div>
            <div className="w-48">
              <label className="block text-xs font-medium text-[#374151] mb-1">Active Counters / Doctors</label>
              <input
                type="number"
                min={1}
                value={activeCounters}
                onChange={(e) => setActiveCounters(e.target.value)}
                className="w-full h-9 px-2.5 border border-[#D1D5DB] rounded text-xs"
              />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="doc-license" className="block text-xs font-medium text-[#374151] mb-1">
                Upload Hospital / Clinical Establishment License (PDF or Image)
              </label>
              <input
                id="doc-license"
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => setLicenseDocName(e.target.files?.[0]?.name || '')}
                className="block w-full text-xs text-[#374151] border border-[#D1D5DB] rounded p-2 bg-[#F9FAFB]"
              />
              {licenseDocName && (
                <p className="text-xs text-[#15803D] mt-1">Selected: {licenseDocName}</p>
              )}
            </div>
            <div>
              <label htmlFor="doc-photo" className="block text-xs font-medium text-[#374151] mb-1">
                Upload Clinic Exterior / Reception Photo
              </label>
              <input
                id="doc-photo"
                type="file"
                accept="image/*"
                onChange={(e) => setPhotoDocName(e.target.files?.[0]?.name || '')}
                className="block w-full text-xs text-[#374151] border border-[#D1D5DB] rounded p-2 bg-[#F9FAFB]"
              />
              {photoDocName && (
                <p className="text-xs text-[#15803D] mt-1">Selected: {photoDocName}</p>
              )}
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-3">
            <p className="text-xs text-[#4B5563]">
              Choose your Pinnacle listing plan for <strong>{primarySpecialty}</strong> in <strong>{city}</strong>. Sponsored listings activate automatically right after payment verification (no manual approval).
            </p>

            {bothOccupied ? (
              <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded text-xs space-y-1">
                <div className="font-semibold text-[#B91C1C]">
                  Both sponsored slots are currently occupied
                </div>
                {earliestFreeMs && (
                  <p className="text-[#7F1D1D]">
                    Earliest slot frees up at {formatShortClock(earliestFreeMs)} (
                    {formatOccupiedUntil(earliestFreeMs, nowMs).replace('Occupied until ', '')}).
                  </p>
                )}
              </div>
            ) : rank1Occupied ? (
              <div className="p-3 bg-[#FFFBEB] border border-[#FDE68A] rounded text-xs text-[#92400E]">
                Rank 1 is currently occupied. You can choose Rank 2, or join the waitlist for Rank 1.
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Free Listing */}
              <button
                type="button"
                onClick={() => setRequestedPlan('free')}
                className={`p-3.5 rounded border text-left transition-colors ${
                  requestedPlan === 'free'
                    ? 'border-[#1F5FA8] bg-[#EFF6FF]'
                    : 'border-[#D1D5DB] bg-white hover:bg-[#F9FAFB]'
                }`}
              >
                <div className="text-sm font-semibold text-[#111827]">Free Organic Listing</div>
                <div className="text-base font-bold text-[#1F5FA8] mt-1 tabular-nums">
                  ₹0 / month
                </div>
                <p className="text-xs text-[#4B5563] mt-1.5">
                  Listed in directory, ranked by least total time, live queue dashboard included.
                </p>
              </button>

              {/* Sponsored Slot #2 */}
              <div
                className={`p-3.5 rounded border text-left flex flex-col justify-between gap-2 ${
                  requestedPlan === 'sponsor_2' && !rank2Occupied
                    ? 'border-[#1F5FA8] bg-[#EFF6FF]'
                    : rank2Occupied
                      ? 'border-[#E2E6EC] bg-[#F9FAFB]'
                      : 'border-[#D1D5DB] bg-white'
                }`}
              >
                <button
                  type="button"
                  disabled={rank2Occupied}
                  onClick={() => setRequestedPlan('sponsor_2')}
                  className="text-left disabled:cursor-not-allowed"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold text-[#111827]">Sponsored Slot #2</span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                        rank2Occupied
                          ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                          : 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                      }`}
                    >
                      {rank2Occupied ? 'Occupied' : 'Available'}
                    </span>
                  </div>
                  <div className="text-base font-bold text-[#1F5FA8] mt-1 tabular-nums">
                    ₹{slotConfig.priceRank2} / {formatDurationLabel(slotConfig.durationMinutes)}
                  </div>
                  <p className="text-xs text-[#4B5563] mt-1">
                    {rank2Occupied && slot2.occupiedUntilMs
                      ? formatOccupiedUntil(slot2.occupiedUntilMs, nowMs)
                      : 'Guaranteed #2 placement for matching specialty & city with Sponsored label.'}
                  </p>
                </button>
                {rank2Occupied && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleRegisterAndJoinWaitlist(2)}
                    className="w-full py-1.5 text-xs font-semibold border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF]"
                  >
                    Join waitlist
                  </button>
                )}
              </div>

              {/* Sponsored Slot #1 */}
              <div
                className={`p-3.5 rounded border text-left flex flex-col justify-between gap-2 ${
                  requestedPlan === 'sponsor_1' && !rank1Occupied
                    ? 'border-[#1F5FA8] bg-[#EFF6FF]'
                    : rank1Occupied
                      ? 'border-[#E2E6EC] bg-[#F9FAFB]'
                      : 'border-[#D1D5DB] bg-white'
                }`}
              >
                <button
                  type="button"
                  disabled={rank1Occupied}
                  onClick={() => setRequestedPlan('sponsor_1')}
                  className="text-left disabled:cursor-not-allowed"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold text-[#111827]">Sponsored Slot #1</span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                        rank1Occupied
                          ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                          : 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                      }`}
                    >
                      {rank1Occupied ? 'Occupied' : 'Available'}
                    </span>
                  </div>
                  <div className="text-base font-bold text-[#1F5FA8] mt-1 tabular-nums">
                    ₹{slotConfig.priceRank1} / {formatDurationLabel(slotConfig.durationMinutes)}
                  </div>
                  <p className="text-xs text-[#4B5563] mt-1">
                    {rank1Occupied && slot1.occupiedUntilMs
                      ? formatOccupiedUntil(slot1.occupiedUntilMs, nowMs)
                      : 'Top #1 placement for matching specialty & city with Sponsored label.'}
                  </p>
                </button>
                {rank1Occupied && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleRegisterAndJoinWaitlist(1)}
                    className="w-full py-1.5 text-xs font-semibold border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF]"
                  >
                    Join waitlist
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="pt-4 border-t border-[#E2E6EC] flex items-center justify-between">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="px-4 py-2 text-sm font-medium border border-[#D1D5DB] rounded text-[#374151] disabled:opacity-40 min-h-[42px]"
          >
            Previous
          </button>

          {step < 6 ? (
            <button
              type="button"
              onClick={() => {
                if (validateStep(step)) setStep((s) => s + 1);
              }}
              className="px-5 py-2 text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] min-h-[42px]"
            >
              Next Step
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="px-5 py-2 text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] disabled:opacity-60 min-h-[42px]"
            >
              {submitting ? 'Submitting...' : 'Submit for Approval'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
