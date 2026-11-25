import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Calendar, Share2, CheckCircle2, Mail } from 'lucide-react';
import type {
  BookingRecord,
  EmailNotificationPreview,
  PatientProfile,
  RankedHospital,
  Specialty,
} from '../types/pinnacle';
import { buildWhatsAppShareUrl, downloadCalendarInvite } from '../utils/calendarAndShare';

interface BookingModalProps {
  item: RankedHospital;
  selectedSpecialty: Specialty | 'All';
  initialDoctorName?: string;
  initialSpecialty?: Specialty;
  patientUid: string;
  getBookingToken: () => Promise<string | null>;
  patientProfile?: PatientProfile | null;
  defaultEmail?: string;
  defaultName?: string;
  onClose: () => void;
  onBooked: (booking: BookingRecord, emailPreview?: EmailNotificationPreview) => void;
  onViewMyAppointments: () => void;
  onCancelBooking: (bookingId: string) => Promise<void>;
}

const TIME_SLOTS = [
  '10:00 AM',
  '10:30 AM',
  '11:15 AM',
  '12:00 PM',
  '04:30 PM',
  '05:30 PM',
  '06:15 PM',
];

export function BookingModal({
  item,
  selectedSpecialty,
  initialDoctorName,
  initialSpecialty,
  patientUid,
  getBookingToken,
  patientProfile,
  defaultEmail = '',
  defaultName = '',
  onClose,
  onBooked,
  onViewMyAppointments,
  onCancelBooking,
}: BookingModalProps) {
  const { hospital } = item;
  const today = new Date().toISOString().slice(0, 10);

  const defaultOpd: Specialty =
    initialSpecialty ||
    (selectedSpecialty !== 'All' && hospital.specialties.includes(selectedSpecialty)
      ? selectedSpecialty
      : hospital.specialties[0] || 'Eye OPD');

  const [step, setStep] = useState<'slot' | 'details' | 'confirm'>('slot');
  const [selectedOpd, setSelectedOpd] = useState<Specialty>(defaultOpd);
  const [doctorName, setDoctorName] = useState(
    initialDoctorName ||
      hospital.doctors.find((d) => d.availableToday && d.specialty === defaultOpd)?.name ||
      hospital.doctors.find((d) => d.availableToday)?.name ||
      'Any available OPD doctor'
  );
  const [date, setDate] = useState(today);
  const [isWalkIn, setIsWalkIn] = useState(true);
  const [timeSlot, setTimeSlot] = useState(TIME_SLOTS[0]);

  const [patientName, setPatientName] = useState(patientProfile?.displayName || defaultName);
  const [patientMobile, setPatientMobile] = useState(patientProfile?.phone || '');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const [patientEmail, setPatientEmail] = useState(patientProfile?.email || defaultEmail);
  const [patientAge, setPatientAge] = useState(
    patientProfile?.age !== undefined ? String(patientProfile.age) : '32'
  );
  const [patientGender, setPatientGender] = useState<'Male' | 'Female' | 'Other'>(
    patientProfile?.gender || 'Male'
  );
  const [reason, setReason] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<BookingRecord | null>(null);
  const [emailPreview, setEmailPreview] = useState<EmailNotificationPreview | null>(null);

  const handleSendOtp = async () => {
    setError(null);
    setOtpMessage(null);
    try {
      const res = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: patientMobile }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not send OTP.');
        return;
      }
      setOtpSent(true);
      setOtpMessage(
        data.previewHint
          ? `OTP sent to ${data.maskedPhone}. (${data.previewHint})`
          : `OTP sent to ${data.maskedPhone}.`
      );
    } catch {
      setError('Network error while sending OTP.');
    }
  };

  const handleVerifyOtp = async () => {
    setError(null);
    try {
      const res = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: patientMobile, otp: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'OTP verification failed.');
        return;
      }
      setOtpVerified(true);
      setOtpMessage('Mobile number verified.');
    } catch {
      setError('Network error while verifying OTP.');
    }
  };

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (patientName.trim().length < 2) {
      setError('Please enter the patient’s full name.');
      return;
    }
    if (!otpVerified) {
      setError('Please verify the mobile number with OTP before confirming.');
      return;
    }
    if (!consentGiven) {
      setError('Please accept the data consent checkbox to proceed.');
      return;
    }

    setSubmitting(true);
    try {
      const specialtyToBook: Specialty = selectedOpd;
      const matchedDoctor = hospital.doctors.find((d) => d.name === doctorName);
      const token = await getBookingToken();

if (!token) {
  setError('Please sign in to book an appointment.');
  return;
}
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
},
        body: JSON.stringify({
          hospitalId: hospital.id,
          doctorId: matchedDoctor?.id ?? null,
          doctorName,
          specialty: specialtyToBook,
          opd_id: specialtyToBook,
          patientUid,
          patientPid: patientProfile?.pid,
          patientName: patientName.trim(),
          patientMobile: patientMobile.trim(),
          patientEmail: patientEmail.trim(),
          patientAge: Number(patientAge) || 30,
          patientGender,
          reason: reason.trim() || 'OPD consultation',
          date,
          timeSlot: isWalkIn ? 'Live Walk-In Queue' : timeSlot,
          isWalkIn,
          consentGiven,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unable to confirm booking.');
        setSubmitting(false);
        return;
      }
      setConfirmedBooking(data.booking);
      setEmailPreview(data.emailPreview || null);
      onBooked(data.booking, data.emailPreview);
      setStep('confirm');
    } catch {
      setError('Network error while booking appointment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-modal-title"
    >
      <div className="bg-white border border-[#E2E6EC] rounded-md w-full max-w-xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-[#E2E6EC] flex items-center justify-between gap-3 sticky top-0 bg-white z-10">
          <div>
            <h2 id="booking-modal-title" className="text-base sm:text-lg font-semibold text-[#111827]">
              {step === 'confirm' ? 'Appointment Confirmed' : `Book OPD — ${hospital.name}`}
            </h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {hospital.area}, {hospital.city} · Fee ₹{hospital.consultationFee}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded border border-[#E2E6EC] text-[#4B5563] hover:bg-[#F5F6F8]"
            aria-label="Close booking dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {error && (
            <div className="mb-4 p-3 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs sm:text-sm rounded">
              {error}
            </div>
          )}

          {/* Step 1: OPD, Doctor, Date, Walk-In vs Slot */}
          {step === 'slot' && (
            <div className="space-y-4">
              {hospital.specialties.length > 1 && (
                <div>
                  <label htmlFor="bk-opd" className="block text-xs font-medium text-[#374151] mb-1">
                    Select OPD Department *
                  </label>
                  <select
                    id="bk-opd"
                    value={selectedOpd}
                    onChange={(e) => {
                      const nextOpd = e.target.value as Specialty;
                      setSelectedOpd(nextOpd);
                      const docInOpd = hospital.doctors.find(
                        (d) => d.specialty === nextOpd && d.availableToday
                      );
                      setDoctorName(docInOpd ? docInOpd.name : 'Any available OPD doctor');
                    }}
                    className="w-full h-11 px-3 bg-white border border-[#D1D5DB] rounded text-sm text-[#111827]"
                  >
                    {hospital.specialties.map((sp) => (
                      <option key={sp} value={sp}>
                        {sp}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="bk-doctor" className="block text-xs font-medium text-[#374151] mb-1">
                  Select Doctor (Optional)
                </label>
                <select
                  id="bk-doctor"
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  className="w-full h-11 px-3 bg-white border border-[#D1D5DB] rounded text-sm text-[#111827]"
                >
                  <option value="Any available OPD doctor">Any available OPD doctor (Fastest)</option>
                  {initialDoctorName &&
                    !hospital.doctors.some((d) => d.name === initialDoctorName) && (
                      <option value={initialDoctorName}>{initialDoctorName} (Previous Doctor)</option>
                    )}
                  {hospital.doctors
                    .filter((d) => !selectedOpd || d.specialty === selectedOpd)
                    .map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name} — {d.qualification} ({d.experienceYears} yrs)
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="bk-date" className="block text-xs font-medium text-[#374151] mb-1">
                    Appointment Date
                  </label>
                  <input
                    id="bk-date"
                    type="date"
                    min={today}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full h-11 px-3 bg-white border border-[#D1D5DB] rounded text-sm text-[#111827]"
                  />
                </div>
                <div>
                  <span className="block text-xs font-medium text-[#374151] mb-1">
                    Queue Option
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIsWalkIn(true)}
                      className={`h-11 px-2 text-xs font-medium rounded border ${
                        isWalkIn
                          ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                          : 'bg-white text-[#374151] border-[#D1D5DB]'
                      }`}
                    >
                      Join live queue now
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsWalkIn(false)}
                      className={`h-11 px-2 text-xs font-medium rounded border ${
                        !isWalkIn
                          ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                          : 'bg-white text-[#374151] border-[#D1D5DB]'
                      }`}
                    >
                      Pick time slot
                    </button>
                  </div>
                </div>
              </div>

              {isWalkIn ? (
                <div className="p-3 bg-[#F5F6F8] border border-[#E2E6EC] rounded text-xs text-[#374151]">
                  Live queue token will be issued immediately. Current queue: <strong>{hospital.patientsWaiting} patients</strong> (~{item.estimatedWaitMinutes} min wait) · Your travel: <strong>{item.travelMinutes} min</strong>.
                </div>
              ) : (
                <div>
                  <span className="block text-xs font-medium text-[#374151] mb-1.5">
                    Available OPD Slots
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {TIME_SLOTS.map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setTimeSlot(slot)}
                        className={`py-2 px-2 text-xs font-medium rounded border min-h-[40px] ${
                          timeSlot === slot
                            ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                            : 'bg-white text-[#374151] border-[#D1D5DB] hover:bg-[#F5F6F8]'
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep('details')}
                  className="px-5 py-2.5 bg-[#1F5FA8] hover:bg-[#184C87] text-white text-sm font-medium rounded min-h-[44px]"
                >
                  Continue to Patient Details
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Patient Details + OTP Verification */}
          {step === 'details' && (
            <form onSubmit={handleSubmitBooking} className="space-y-3.5">
              {patientProfile && (patientProfile.bloodGroup !== 'Unknown' || patientProfile.allergies.length > 0) && (
                <div className="p-2.5 bg-[#EFF6FF] border border-[#BFDBFE] rounded text-xs text-[#111827]">
                  <span className="font-semibold text-[#1F5FA8]">My Profile Linked:</span>{' '}
                  {patientProfile.bloodGroup !== 'Unknown' && (
                    <span>Blood Group {patientProfile.bloodGroup}</span>
                  )}
                  {patientProfile.allergies.length > 0 && (
                    <span> · Allergies: {patientProfile.allergies.join(', ')}</span>
                  )}
                </div>
              )}
              <div>
                <label htmlFor="pt-name" className="block text-xs font-medium text-[#374151] mb-1">
                  Full Name *
                </label>
                <input
                  id="pt-name"
                  type="text"
                  required
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="Enter patient full name"
                  className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
                />
              </div>

              <div>
                <label htmlFor="pt-mobile" className="block text-xs font-medium text-[#374151] mb-1">
                  Mobile Number (OTP Verification Required) *
                </label>
                <div className="flex gap-2">
                  <input
                    id="pt-mobile"
                    type="tel"
                    required
                    value={patientMobile}
                    onChange={(e) => {
                      setPatientMobile(e.target.value);
                      setOtpVerified(false);
                    }}
                    placeholder="+91 98XXXXXXXX"
                    className="flex-1 h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
                  />
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    className="px-3 h-10 text-xs font-medium border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF] whitespace-nowrap"
                  >
                    {otpSent ? 'Resend OTP' : 'Send OTP'}
                  </button>
                </div>

                {otpSent && !otpVerified && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      aria-label="Enter 6-digit OTP"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="Enter 6-digit OTP"
                      className="flex-1 h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyOtp}
                      className="px-4 h-10 text-xs font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87]"
                    >
                      Verify OTP
                    </button>
                  </div>
                )}
                {otpMessage && (
                  <p className={`text-xs mt-1 ${otpVerified ? 'text-[#15803D] font-medium' : 'text-[#4B5563]'}`}>
                    {otpMessage}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label htmlFor="pt-age" className="block text-xs font-medium text-[#374151] mb-1">
                    Age *
                  </label>
                  <input
                    id="pt-age"
                    type="number"
                    min={0}
                    max={120}
                    required
                    value={patientAge}
                    onChange={(e) => setPatientAge(e.target.value)}
                    className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="pt-gender" className="block text-xs font-medium text-[#374151] mb-1">
                    Gender *
                  </label>
                  <select
                    id="pt-gender"
                    value={patientGender}
                    onChange={(e) => setPatientGender(e.target.value as 'Male' | 'Female' | 'Other')}
                    className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827] bg-white"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="pt-email" className="block text-xs font-medium text-[#374151] mb-1">
                  Email (for booking confirmation & queue receipt)
                </label>
                <input
                  id="pt-email"
                  type="email"
                  value={patientEmail}
                  onChange={(e) => setPatientEmail(e.target.value)}
                  placeholder="patient@example.com"
                  className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
                />
              </div>

              <div>
                <label htmlFor="pt-reason" className="block text-xs font-medium text-[#374151] mb-1">
                  Reason for visit (short text)
                </label>
                <input
                  id="pt-reason"
                  type="text"
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Eye irritation, power checkup, follow-up"
                  className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
                />
              </div>

              <label className="flex items-start gap-2 text-xs text-[#374151] pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#1F5FA8]"
                />
                <span>
                  I consent to Pinnacle storing my minimal visit details to issue my OPD token and share live queue updates with {hospital.name}.
                </span>
              </label>

              <div className="pt-3 flex items-center justify-between gap-3 border-t border-[#E2E6EC]">
                <button
                  type="button"
                  onClick={() => setStep('slot')}
                  className="px-4 py-2 text-sm font-medium border border-[#D1D5DB] text-[#374151] rounded hover:bg-[#F5F6F8] min-h-[44px]"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-[#1F5FA8] hover:bg-[#184C87] text-white text-sm font-medium rounded disabled:opacity-60 min-h-[44px]"
                >
                  {submitting ? 'Confirming...' : 'Confirm Booking'}
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Confirmation Screen with QR, Token, Calendar, WhatsApp */}
          {step === 'confirm' && confirmedBooking && (
            <div className="space-y-4">
              <div className="p-4 bg-[#ECFDF5] border border-[#BBF7D0] rounded flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#15803D] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-[#15803D]">
                    Booking Confirmed — Token {confirmedBooking.tokenNumber}
                  </p>
                  <p className="text-xs text-[#111827] mt-0.5">
                    Queue Position: <strong>#{confirmedBooking.queuePosition}</strong> · Estimated call time:{' '}
                    <strong>
                      {new Date(confirmedBooking.estimatedCallTimeIso).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </strong>
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 items-center border border-[#E2E6EC] rounded p-4 bg-[#F9FAFB]">
                <div className="bg-white p-2 border border-[#E2E6EC] rounded shrink-0">
                  <QRCodeSVG
                    value={JSON.stringify({
                      token: confirmedBooking.tokenNumber,
                      id: confirmedBooking.id,
                      hospital: confirmedBooking.hospitalId,
                    })}
                    size={108}
                  />
                </div>
                <div className="text-xs text-[#374151] space-y-1 flex-1">
                  <p className="text-sm font-semibold text-[#111827]">{confirmedBooking.hospitalName}</p>
                  <p>Doctor: {confirmedBooking.doctorName}</p>
                  <p>Patient: {confirmedBooking.patientName} ({confirmedBooking.patientAge}y, {confirmedBooking.patientGender})</p>
                  <p>Date & Slot: {confirmedBooking.date} · {confirmedBooking.timeSlot}</p>
                  <p className="text-[#6B7280]">Show this QR code at the OPD reception desk on arrival.</p>
                </div>
              </div>

              {emailPreview && (
                <div className="border border-[#E2E6EC] rounded p-3 bg-white text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-[#111827]">
                    <Mail className="w-3.5 h-3.5 text-[#1F5FA8]" aria-hidden="true" />
                    Confirmation Email Dispatched ({emailPreview.to})
                  </div>
                  <p className="text-[#4B5563] mt-1">{emailPreview.subject}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => downloadCalendarInvite(confirmedBooking)}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium border border-[#D1D5DB] text-[#374151] bg-white rounded hover:bg-[#F5F6F8] min-h-[42px]"
                >
                  <Calendar className="w-4 h-4" aria-hidden="true" />
                  Add to Calendar (.ics)
                </button>
                <a
                  href={buildWhatsAppShareUrl(confirmedBooking)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium border border-[#D1D5DB] text-[#374151] bg-white rounded hover:bg-[#F5F6F8] min-h-[42px]"
                >
                  <Share2 className="w-4 h-4" aria-hidden="true" />
                  Share on WhatsApp
                </a>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E6EC]">
                <button
                  type="button"
                  onClick={async () => {
                    await onCancelBooking(confirmedBooking.id);
                    onClose();
                  }}
                  className="px-3 py-2 text-xs font-medium text-[#B91C1C] border border-[#FECACA] rounded hover:bg-[#FEF2F2]"
                >
                  Cancel Booking
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onViewMyAppointments();
                  }}
                  className="px-4 py-2.5 text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] min-h-[42px]"
                >
                  Track Live Queue in My Appointments
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
