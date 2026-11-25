import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Pause, Play, UserPlus, ArrowRight, Check, SkipForward, Bell, KeyRound, X } from 'lucide-react';
import { getFirebaseIdToken } from '../lib/firebase';
import type {
  BookingRecord,
  DoctorCompletionNotice,
  HospitalRecord,
  HospitalStaffAccount,
  Specialty,
  SponsoredConfig,
  SponsorWaitlistEntry,
  StaffRole,
} from '../types/pinnacle';
import { calculateEstimatedWaitMinutes } from '../utils/ranking';
import { formatRemainingDuration, formatSponsoredUntil, parseSlotBoundaryMs } from '../utils/sponsorship';
import { SponsoredCheckoutModal } from './SponsoredCheckoutModal';

interface HospitalDashboardViewProps {
  hospitals: HospitalRecord[];
  bookings: BookingRecord[];
  waitlist: SponsorWaitlistEntry[];
  doctorCompletionNotices?: DoctorCompletionNotice[];
  sponsoredConfig: SponsoredConfig;
  nowMs: number;
  onRefresh: () => void;
  onDismissDoctorNotice?: (hospitalId: string, noticeId: string) => Promise<void>;
  onQueueAction: (
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
  ) => Promise<void>;
}

export function HospitalDashboardView({
  hospitals,
  bookings,
  waitlist,
  doctorCompletionNotices = [],
  sponsoredConfig,
  nowMs,
  onRefresh,
  onDismissDoctorNotice,
  onQueueAction,
}: HospitalDashboardViewProps) {
  const approved = hospitals.filter((h) => h.status === 'approved');
  const [selectedId, setSelectedId] = useState<string>(approved[0]?.id ?? '');
  const hospital = approved.find((h) => h.id === selectedId) ?? approved[0];

  const [activeOpdTab, setActiveOpdTab] = useState<Specialty | 'All'>('All');
  const [deskBookings, setDeskBookings] = useState<BookingRecord[]>([]);
  const [deskNotices, setDeskNotices] = useState<DoctorCompletionNotice[]>([]);
  const [queueActionError, setQueueActionError] = useState<string | null>(null);

  const [editTimings, setEditTimings] = useState('');
  const [editConsultMin, setEditConsultMin] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [sponsorModalState, setSponsorModalState] = useState<{
    open: boolean;
    specialty?: Specialty;
    rank?: 1 | 2;
  }>({ open: false });

  // Walk-in registration modal state
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInOpd, setWalkInOpd] = useState<Specialty>(hospital?.specialties[0] || 'Eye OPD');
  const [walkInDoctorId, setWalkInDoctorId] = useState('');
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInAge, setWalkInAge] = useState('32');
  const [walkInGender, setWalkInGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [walkInPid, setWalkInPid] = useState('');
  const [walkInReason, setWalkInReason] = useState('');
  const [walkInError, setWalkInError] = useState<string | null>(null);
  const [submittingWalkIn, setSubmittingWalkIn] = useState(false);

  // Hospital staff provisioning state (Doctor & Medical logins)
  const [staffList, setStaffList] = useState<HospitalStaffAccount[]>([]);
  const [staffRole, setStaffRole] = useState<StaffRole>('doctor');
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPasscode, setStaffPasscode] = useState('');
  const [staffQualification, setStaffQualification] = useState('MS / MD');
  const [staffRegNo, setStaffRegNo] = useState('');
  const [staffSpecialty, setStaffSpecialty] = useState<Specialty>(
    hospital?.specialties[0] || 'Eye OPD'
  );
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffSuccess, setStaffSuccess] = useState<string | null>(null);
  const [creatingStaff, setCreatingStaff] = useState(false);

  const loadHospitalDeskData = useCallback(async (hospId: string) => {
    try {
      const token = await getFirebaseIdToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/hospitals/${encodeURIComponent(hospId)}/desk`, { headers });
      if (res.ok) {
        const data = await res.json();
        setDeskBookings(Array.isArray(data.bookings) ? data.bookings : []);
        setStaffList(Array.isArray(data.staff) ? data.staff : []);
        setDeskNotices(
          Array.isArray(data.doctorCompletionNotices) ? data.doctorCompletionNotices : []
        );
      }
    } catch (err) {
      console.error('Failed to load hospital desk data:', err);
    }
  }, []);

  useEffect(() => {
    if (hospital?.id) {
      void loadHospitalDeskData(hospital.id);
      if (hospital.specialties[0]) {
        setStaffSpecialty(hospital.specialties[0]);
        setWalkInOpd(hospital.specialties[0]);
      }
      setActiveOpdTab('All');
    }
  }, [hospital?.id, loadHospitalDeskData]);

  // Keep deskBookings synced whenever parent bookings/refresh ticks update
  useEffect(() => {
    if (hospital?.id) {
      void loadHospitalDeskData(hospital.id);
    }
  }, [hospital?.id, bookings.length, nowMs, loadHospitalDeskData]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hospital) return;
    setStaffError(null);
    setStaffSuccess(null);
    setCreatingStaff(true);
    try {
      const token = await getFirebaseIdToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`/api/hospitals/${encodeURIComponent(hospital.id)}/staff`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          role: staffRole,
          name: staffName.trim(),
          email: staffEmail.trim(),
          passcode: staffPasscode,
          qualification: staffRole === 'doctor' ? staffQualification.trim() : undefined,
          registrationNumber: staffRole === 'doctor' ? staffRegNo.trim() : undefined,
          specialty: staffRole === 'doctor' ? staffSpecialty : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStaffError(data.error || 'Unable to create staff account.');
        return;
      }
      setStaffList((prev) => [...prev, data.account]);
      setStaffSuccess(
        `Created ${staffRole === 'doctor' ? 'Doctor' : 'Medical'} account for ${data.account.name} (${data.account.email}).`
      );
      setStaffName('');
      setStaffEmail('');
      setStaffPasscode('');
      setStaffRegNo('');
      await loadHospitalDeskData(hospital.id);
      onRefresh();
    } catch (err) {
      console.error('Staff creation failed:', err);
      setStaffError('Network error creating staff account.');
    } finally {
      setCreatingStaff(false);
    }
  };

  const handleOpenWalkIn = () => {
    if (!hospital) return;
    const defaultOpd =
      activeOpdTab !== 'All' && hospital.specialties.includes(activeOpdTab)
        ? activeOpdTab
        : hospital.specialties[0] || 'Eye OPD';
    setWalkInOpd(defaultOpd);
    setWalkInDoctorId('');
    setWalkInName('');
    setWalkInPhone('');
    setWalkInAge('32');
    setWalkInGender('Male');
    setWalkInPid('');
    setWalkInReason('');
    setWalkInError(null);
    setWalkInOpen(true);
  };

  const handleSubmitWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hospital) return;
    setWalkInError(null);
    setSubmittingWalkIn(true);
    try {
      const token = await getFirebaseIdToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`/api/hospitals/${encodeURIComponent(hospital.id)}/walk-in`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          opd_id: walkInOpd,
          doctor_id: walkInDoctorId || undefined,
          patient_name: walkInName.trim(),
          phone: walkInPhone.trim(),
          age: Number(walkInAge),
          gender: walkInGender,
          PID: walkInPid.trim().toUpperCase() || undefined,
          reason: walkInReason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWalkInError(data.error || 'Could not register walk-in patient.');
        return;
      }
      if (Array.isArray(data.bookings)) {
        setDeskBookings(data.bookings);
      } else {
        await loadHospitalDeskData(hospital.id);
      }
      setWalkInOpen(false);
      onRefresh();
    } catch (err) {
      console.error('Walk-in registration error:', err);
      setWalkInError('Network error registering walk-in patient.');
    } finally {
      setSubmittingWalkIn(false);
    }
  };

  const runScopedQueueAction = async (payload: {
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
  }) => {
    if (!hospital) return;
    setQueueActionError(null);
    try {
      await onQueueAction(hospital.id, {
        ...payload,
        opd_id: payload.opd_id ?? (activeOpdTab !== 'All' ? activeOpdTab : undefined),
      });
      await loadHospitalDeskData(hospital.id);
    } catch (err) {
      console.error('Queue action error:', err);
      setQueueActionError(err instanceof Error ? err.message : 'Unable to update queue.');
    }
  };

  const walkInDoctorsForOpd = useMemo(() => {
    if (!hospital) return [];
    return hospital.doctors.filter((d) => !d.specialty || d.specialty === walkInOpd);
  }, [hospital, walkInOpd]);

  if (!hospital) {
    return (
      <div className="bg-white border border-[#E2E6EC] rounded-md p-6 text-sm text-[#4B5563]">
        No approved hospitals available yet. Approve a pending registration in the Admin panel first.
      </div>
    );
  }

  const { estimatedWaitMinutes } = calculateEstimatedWaitMinutes(hospital);
  const hospBookings =
    deskBookings.length > 0
      ? deskBookings
      : bookings.filter((b) => b.hospitalId === hospital.id);

  const visibleOpdBookings = useMemo(() => {
    if (activeOpdTab === 'All') return hospBookings;
    return hospBookings.filter((b) => (b.opd_id || b.specialty) === activeOpdTab);
  }, [hospBookings, activeOpdTab]);

  const activeWaitCountForView = visibleOpdBookings.filter(
    (b) => b.status === 'waiting' || b.status === 'called'
  ).length;
  const isCurrentScopePaused =
    activeOpdTab !== 'All' ? Boolean(hospital.pausedOpds?.[activeOpdTab]) : hospital.isPaused;

  // Active notified waitlist claim banner for this hospital
  const activeClaimAlerts = waitlist.filter(
    (w) =>
      w.hospitalId === hospital.id &&
      w.status === 'notified' &&
      typeof w.claimExpiresAt === 'number' &&
      w.claimExpiresAt > nowMs
  );

  // Active non-expired sponsorships on this hospital
  const activeSponsorEntries = (() => {
    const entries: Array<{ specialty: string; rank: 1 | 2; endMs: number | null }> = [];
    if (hospital.sponsor_slots && Object.keys(hospital.sponsor_slots).length > 0) {
      for (const [sp, slot] of Object.entries(hospital.sponsor_slots)) {
        if (!slot) continue;
        const endMs = parseSlotBoundaryMs(slot.endDate, 'end');
        if (endMs !== null && nowMs > endMs) continue;
        entries.push({ specialty: sp, rank: slot.rank, endMs });
      }
    } else if (hospital.is_sponsored) {
      const endMs = parseSlotBoundaryMs(hospital.sponsor_end_date, 'end');
      if (endMs === null || nowMs <= endMs) {
        entries.push({
          specialty: hospital.specialties[0] || 'OPD',
          rank: (hospital.sponsor_rank ?? 1) as 1 | 2,
          endMs,
        });
      }
    }
    return entries;
  })();

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    await runScopedQueueAction({
      action: 'update_settings',
      opdTimings: editTimings || hospital.opdTimings,
      avgConsultMinutes: Number(editConsultMin) || hospital.avgConsultMinutes,
    });
    setSavingSettings(false);
    setEditTimings('');
    setEditConsultMin('');
  };

  const hospNotices =
    deskNotices.length > 0
      ? deskNotices
      : doctorCompletionNotices.filter((n) => n.hospitalId === hospital.id);

  return (
    <div className="space-y-4">
      {/* Doctor Completion Notices ("Dr [name] finished with token #[N]") */}
      {hospNotices.map((notice) => (
        <div
          key={notice.id}
          data-testid={`doctor-finished-notice-${notice.tokenNumber}`}
          className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-md px-4 py-3 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 text-xs sm:text-sm text-[#1E3A8A]">
            <Bell className="w-4 h-4 text-[#1F5FA8] shrink-0" aria-hidden="true" />
            <span>
              <strong>{notice.doctorName}</strong> finished with token{' '}
              <strong>#{notice.tokenNumber}</strong>. Update the queue manually below when ready.
            </span>
          </div>
          {onDismissDoctorNotice && (
            <button
              type="button"
              onClick={async () => {
                await onDismissDoctorNotice(hospital.id, notice.id);
                await loadHospitalDeskData(hospital.id);
              }}
              aria-label="Dismiss doctor notice"
              className="p-1 text-[#1F5FA8] hover:bg-white rounded"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}

      {/* Waitlist 10-Minute Claim Banner */}
      {activeClaimAlerts.map((alert) => (
        <div
          key={alert.id}
          data-testid="waitlist-claim-banner"
          className="bg-[#FFFBEB] border border-[#FDE68A] rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div>
            <div className="text-sm font-bold text-[#92400E]">
              Rank {alert.desiredRank} is now available. Claim it within 10 minutes.
            </div>
            <p className="text-xs text-[#78350F] mt-0.5">
              {alert.specialty} · {alert.city} ·{' '}
              {alert.claimExpiresAt
                ? `Claim window: ${formatRemainingDuration(alert.claimExpiresAt, nowMs)}`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSponsorModalState({
                open: true,
                specialty: alert.specialty,
                rank: alert.desiredRank,
              })
            }
            className="px-4 py-2 text-xs sm:text-sm font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] shrink-0 min-h-[38px]"
          >
            Claim Rank {alert.desiredRank}
          </button>
        </div>
      ))}

      {/* Header & Hospital Switcher */}
      <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111827]">Hospital OPD Desk Dashboard</h1>
          <p className="text-xs sm:text-sm text-[#4B5563] mt-0.5">
            Changes made here update patient wait times and OPD queue positions in real time.
          </p>
        </div>

        <div className="w-full sm:w-80">
          <label htmlFor="dash-hosp-select" className="block text-xs font-medium text-[#374151] mb-1">
            Select Active Hospital Desk
          </label>
          <select
            id="dash-hosp-select"
            value={hospital.id}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full h-10 px-3 bg-white border border-[#D1D5DB] rounded text-sm text-[#111827]"
          >
            {approved.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.area}, {h.city})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Analytics Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-[#E2E6EC] rounded-md p-4">
          <div className="text-xs text-[#6B7280]">
            {activeOpdTab === 'All' ? 'Total Patients Waiting' : `${activeOpdTab} Waiting`}
          </div>
          <div className="text-2xl font-bold text-[#111827] mt-1 tabular-nums" data-testid="dash-waiting-count">
            {activeOpdTab === 'All' ? hospital.patientsWaiting : activeWaitCountForView}
          </div>
          <div className="text-xs text-[#4B5563] mt-0.5 tabular-nums">
            Current token #{hospital.currentTokenNumber}
          </div>
        </div>

        <div className="bg-white border border-[#E2E6EC] rounded-md p-4">
          <div className="text-xs text-[#6B7280]">Live Estimated Wait</div>
          <div className="text-2xl font-bold text-[#1F5FA8] mt-1 tabular-nums">
            {estimatedWaitMinutes} min
          </div>
          <div className="text-xs text-[#4B5563] mt-0.5 tabular-nums">
            {hospital.activeCounters} active desk(s) · {hospital.avgConsultMinutes}m/patient
          </div>
        </div>

        <div className="bg-white border border-[#E2E6EC] rounded-md p-4">
          <div className="text-xs text-[#6B7280]">Patients Served Today</div>
          <div className="text-2xl font-bold text-[#111827] mt-1 tabular-nums">
            {hospital.analytics?.patientsToday ?? 0}
          </div>
          <div className="text-xs text-[#4B5563] mt-0.5 tabular-nums">
            Avg wait: {hospital.analytics?.avgWaitTodayMinutes ?? estimatedWaitMinutes} min
          </div>
        </div>

        <div className="bg-white border border-[#E2E6EC] rounded-md p-4 flex flex-col justify-between gap-2">
          <div>
            <div className="text-xs text-[#6B7280]">Rating &amp; Sponsorship</div>
            <div className="text-2xl font-bold text-[#111827] mt-1 tabular-nums">
              {hospital.googleRating.toFixed(1)} ★
            </div>
            {activeSponsorEntries.length > 0 ? (
              <div className="space-y-0.5 mt-0.5">
                {activeSponsorEntries.map((entry) => (
                  <div key={entry.specialty} className="text-xs text-[#15803D] font-medium">
                    Rank #{entry.rank} ({entry.specialty}) ·{' '}
                    {entry.endMs ? formatSponsoredUntil(entry.endMs, nowMs) : 'Sponsored'}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-[#4B5563] mt-0.5">Free Organic Listing</div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setSponsorModalState({ open: true })}
            data-testid="open-sponsored-flow-btn"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87]"
          >
            <Award className="w-3.5 h-3.5" aria-hidden="true" />
            {activeSponsorEntries.length > 0 ? 'Manage Sponsored Slots' : 'Sponsor OPD Slot'}
          </button>
        </div>
      </div>

      {/* Per-OPD Filter Tabs & Live Queue Action Controls */}
      <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#111827]">
            Live Queue Controls ({activeOpdTab === 'All' ? 'All OPDs' : activeOpdTab})
          </h2>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded border ${
              isCurrentScopePaused
                ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                : 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
            }`}
          >
            {isCurrentScopePaused
              ? `${activeOpdTab === 'All' ? 'Hospital' : activeOpdTab} Paused`
              : `${activeOpdTab === 'All' ? 'OPD' : activeOpdTab} Active`}
          </span>
        </div>

        {/* OPD Tabs */}
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter Hospital Desk by OPD">
          <button
            type="button"
            role="tab"
            aria-selected={activeOpdTab === 'All'}
            onClick={() => setActiveOpdTab('All')}
            data-testid="desk-opd-tab-all"
            className={`px-3 py-1.5 rounded border text-xs font-semibold flex items-center gap-1.5 min-h-[34px] ${
              activeOpdTab === 'All'
                ? 'bg-[#111827] text-white border-[#111827]'
                : 'bg-[#F9FAFB] text-[#374151] border-[#D1D5DB] hover:bg-[#F3F4F6]'
            }`}
          >
            <span>All OPDs</span>
            <span className="tabular-nums opacity-85">
              ({hospBookings.filter((b) => b.status === 'waiting' || b.status === 'called').length})
            </span>
          </button>

          {hospital.specialties.map((sp) => {
            const count = hospBookings.filter(
              (b) =>
                (b.opd_id || b.specialty) === sp &&
                (b.status === 'waiting' || b.status === 'called')
            ).length;
            const paused = Boolean(hospital.pausedOpds?.[sp]);
            const isSelected = activeOpdTab === sp;
            return (
              <button
                key={sp}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setActiveOpdTab(sp)}
                data-testid={`desk-opd-tab-${sp}`}
                className={`px-3 py-1.5 rounded border text-xs font-semibold flex items-center gap-1.5 min-h-[34px] ${
                  isSelected
                    ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                    : 'bg-[#F9FAFB] text-[#374151] border-[#D1D5DB] hover:bg-[#EFF6FF]'
                }`}
              >
                <span>{sp}</span>
                <span className="tabular-nums">({count})</span>
                {paused && (
                  <span className="px-1 py-0.5 text-[10px] rounded bg-[#FEE2E2] text-[#B91C1C]">
                    Paused
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {queueActionError && (
          <div className="p-2.5 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs rounded">
            {queueActionError}
          </div>
        )}

        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={handleOpenWalkIn}
            data-testid="desk-add-walkin-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] min-h-[44px]"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            Add walk-in
          </button>

          <button
            type="button"
            onClick={() => void runScopedQueueAction({ action: 'call_next' })}
            data-testid="desk-call-next-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF] min-h-[44px]"
          >
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
            Call next
          </button>

          <button
            type="button"
            onClick={() => void runScopedQueueAction({ action: 'mark_done' })}
            data-testid="desk-mark-done-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border border-[#BBF7D0] text-[#15803D] bg-[#ECFDF5] rounded hover:bg-[#D1FAE5] min-h-[44px]"
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            Mark done
          </button>

          <button
            type="button"
            onClick={() => void runScopedQueueAction({ action: 'skip' })}
            data-testid="desk-skip-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border border-[#D1D5DB] text-[#374151] bg-white rounded hover:bg-[#F5F6F8] min-h-[44px]"
          >
            <SkipForward className="w-4 h-4" aria-hidden="true" />
            Skip
          </button>

          <button
            type="button"
            onClick={() => void runScopedQueueAction({ action: 'toggle_pause' })}
            data-testid="desk-toggle-pause-btn"
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border rounded min-h-[44px] ${
              isCurrentScopePaused
                ? 'border-[#BBF7D0] text-[#15803D] bg-[#ECFDF5]'
                : 'border-[#FECACA] text-[#B91C1C] bg-[#FEF2F2]'
            }`}
          >
            {isCurrentScopePaused ? (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
                Resume {activeOpdTab === 'All' ? 'OPD' : activeOpdTab}
              </>
            ) : (
              <>
                <Pause className="w-4 h-4" aria-hidden="true" />
                Pause {activeOpdTab === 'All' ? 'OPD' : activeOpdTab}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Doctors Availability + Edit Timings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-[#111827] mb-3">
            Doctor Availability Today
          </h2>
          {hospital.doctors.length === 0 ? (
            <p className="text-xs text-[#6B7280]">No individual doctors listed.</p>
          ) : (
            <div className="space-y-2">
              {hospital.doctors.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-2 p-2.5 border border-[#E2E6EC] rounded"
                >
                  <div>
                    <p className="text-sm font-medium text-[#111827]">{doc.name}</p>
                    <p className="text-xs text-[#6B7280]">
                      {doc.qualification}
                      {doc.specialty ? ` · ${doc.specialty}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void runScopedQueueAction({ action: 'toggle_doctor', doctorId: doc.id })
                    }
                    className={`px-3 py-1.5 text-xs font-medium rounded border ${
                      doc.availableToday
                        ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                        : 'bg-[#F3F4F6] border-[#D1D5DB] text-[#4B5563]'
                    }`}
                  >
                    {doc.availableToday ? 'Available' : 'Off Duty'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSaveSettings}
          className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold text-[#111827]">OPD Timings & Consult Duration</h2>
          <div>
            <label className="block text-xs text-[#4B5563] mb-1">
              OPD Timings (Current: {hospital.opdTimings})
            </label>
            <input
              type="text"
              value={editTimings}
              onChange={(e) => setEditTimings(e.target.value)}
              placeholder={hospital.opdTimings}
              className="w-full h-9 px-3 border border-[#D1D5DB] rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[#4B5563] mb-1">
              Avg Consultation Time in min (Current: {hospital.avgConsultMinutes} min)
            </label>
            <input
              type="number"
              min={3}
              max={60}
              value={editConsultMin}
              onChange={(e) => setEditConsultMin(e.target.value)}
              placeholder={String(hospital.avgConsultMinutes)}
              className="w-full h-9 px-3 border border-[#D1D5DB] rounded text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={savingSettings}
            className="px-4 py-2 bg-[#1F5FA8] text-white text-xs font-medium rounded hover:bg-[#184C87]"
          >
            {savingSettings ? 'Saving...' : 'Update OPD Settings'}
          </button>
        </form>
      </div>

      {/* Today's Appointments Table */}
      <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 overflow-x-auto">
        <h2 className="text-sm font-semibold text-[#111827] mb-3">
          Today&apos;s Queue &amp; Appointments ({visibleOpdBookings.length})
        </h2>
        {visibleOpdBookings.length === 0 ? (
          <p className="text-xs text-[#6B7280]">No patients in this queue yet today.</p>
        ) : (
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[#E2E6EC] text-[#6B7280] text-xs">
                <th className="py-2 pr-3 font-medium">Token</th>
                <th className="py-2 pr-3 font-medium">Patient / PID</th>
                <th className="py-2 pr-3 font-medium">OPD / Doctor</th>
                <th className="py-2 pr-3 font-medium">Pos</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Desk Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleOpdBookings.map((b) => (
                <tr key={b.id} className="border-b border-[#F3F4F6]">
                  <td className="py-2.5 pr-3 font-semibold text-[#1F5FA8] tabular-nums">
                    {b.tokenNumber}
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="font-medium text-[#111827]">{b.patientName}</div>
                    <div className="text-xs text-[#6B7280] tabular-nums">
                      {b.PID || b.patientPid || 'Walk-in (no PID)'} · {b.patientMobile}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-[#374151]">
                    <div className="font-medium text-xs text-[#1F5FA8]">{b.opd_id || b.specialty}</div>
                    <div className="text-xs">{b.doctorName}</div>
                    <div className="text-[11px] text-[#6B7280]">{b.timeSlot}</div>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">#{b.queuePosition}</td>
                  <td className="py-2.5 pr-3 capitalize">{b.status}</td>
                  <td className="py-2.5">
                    {(b.status === 'waiting' || b.status === 'called') && (
                      <div className="flex flex-wrap gap-1.5">
                        {b.status === 'waiting' && (
                          <button
                            type="button"
                            onClick={() =>
                              void runScopedQueueAction({
                                action: 'call_next',
                                bookingId: b.id,
                                opd_id: b.opd_id || b.specialty,
                              })
                            }
                            className="px-2 py-1 text-[11px] font-medium border border-[#1F5FA8] text-[#1F5FA8] rounded hover:bg-[#EFF6FF]"
                          >
                            Call
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void runScopedQueueAction({
                              action: 'mark_done',
                              bookingId: b.id,
                              opd_id: b.opd_id || b.specialty,
                            })
                          }
                          className="px-2 py-1 text-[11px] font-medium border border-[#BBF7D0] text-[#15803D] bg-[#ECFDF5] rounded hover:bg-[#D1FAE5]"
                        >
                          Done
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void runScopedQueueAction({
                              action: 'skip',
                              bookingId: b.id,
                              opd_id: b.opd_id || b.specialty,
                            })
                          }
                          className="px-2 py-1 text-[11px] font-medium border border-[#D1D5DB] text-[#4B5563] rounded hover:bg-[#F3F4F6]"
                        >
                          Skip
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Hospital Staff Accounts (Doctors & Medical / Pharmacy) */}
      <section className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-[#1F5FA8]" aria-hidden="true" />
              Doctor &amp; Medical Login Accounts ({staffList.length})
            </h2>
            <p className="text-xs text-[#4B5563] mt-0.5">
              Doctors and Medical staff cannot self-register. Create accounts linked specifically to {hospital.name}.
            </p>
          </div>
        </div>

        {staffList.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {staffList.map((acc) => (
              <div
                key={acc.id}
                className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded flex items-start justify-between gap-2 text-xs"
              >
                <div>
                  <div className="font-semibold text-[#111827]">{acc.name}</div>
                  <div className="text-[#4B5563]">{acc.email}</div>
                  {acc.role === 'doctor' && (
                    <div className="text-[#6B7280] mt-0.5">
                      {acc.specialty} · Reg: {acc.registrationNumber}
                    </div>
                  )}
                </div>
                <span
                  className={`px-2 py-0.5 font-semibold rounded border capitalize ${
                    acc.role === 'doctor'
                      ? 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1F5FA8]'
                      : 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                  }`}
                >
                  {acc.role}
                </span>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleCreateStaff} className="p-3.5 bg-[#F5F6F8] border border-[#E2E6EC] rounded space-y-3">
          <div className="text-xs font-semibold text-[#111827]">
            Add Hospital Doctor or Medical Staff Account
          </div>
          {staffError && (
            <div className="p-2 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs rounded">
              {staffError}
            </div>
          )}
          {staffSuccess && (
            <div className="p-2 bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D] text-xs rounded">
              {staffSuccess}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-3">
              <label className="block text-[11px] text-[#4B5563] mb-1">Role</label>
              <select
                value={staffRole}
                onChange={(e) => setStaffRole(e.target.value as StaffRole)}
                className="w-full h-9 px-2 bg-white border border-[#D1D5DB] rounded text-xs"
              >
                <option value="doctor">Doctor</option>
                <option value="medical">Medical (Pharmacy)</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="block text-[11px] text-[#4B5563] mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder={staffRole === 'doctor' ? 'Dr. Sneha Kulkarni' : 'Rahul Verma'}
                className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-[11px] text-[#4B5563] mb-1">Login Email *</label>
              <input
                type="email"
                required
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder="staff@clinic.in"
                className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-[11px] text-[#4B5563] mb-1">Passcode (min 6) *</label>
              <input
                type="password"
                required
                minLength={6}
                value={staffPasscode}
                onChange={(e) => setStaffPasscode(e.target.value)}
                placeholder="Set passcode"
                className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs"
              />
            </div>
          </div>

          {staffRole === 'doctor' && (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <div className="sm:col-span-4">
                <label className="block text-[11px] text-[#4B5563] mb-1">
                  Registration Number *
                </label>
                <input
                  type="text"
                  required
                  value={staffRegNo}
                  onChange={(e) => setStaffRegNo(e.target.value)}
                  placeholder="e.g. MMC-2019-11220"
                  className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block text-[11px] text-[#4B5563] mb-1">OPD / Specialty *</label>
                <select
                  value={staffSpecialty}
                  onChange={(e) => setStaffSpecialty(e.target.value as Specialty)}
                  className="w-full h-9 px-2 bg-white border border-[#D1D5DB] rounded text-xs"
                >
                  {hospital.specialties.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-4">
                <label className="block text-[11px] text-[#4B5563] mb-1">Qualification</label>
                <input
                  type="text"
                  value={staffQualification}
                  onChange={(e) => setStaffQualification(e.target.value)}
                  placeholder="MS Ophthalmology / MBBS"
                  className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={creatingStaff}
            className="px-4 py-2 text-xs font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] disabled:opacity-60"
          >
            {creatingStaff
              ? 'Creating Account...'
              : `Create ${staffRole === 'doctor' ? 'Doctor' : 'Medical'} Account`}
          </button>
        </form>
      </section>

      {/* Walk-In Registration Modal (with OPD, Doctor, and optional PID) */}
      {walkInOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="walkin-modal-title"
        >
          <div className="bg-white border border-[#E2E6EC] rounded-md w-full max-w-lg overflow-hidden shadow-lg">
            <div className="px-5 py-3.5 border-b border-[#E2E6EC] flex items-center justify-between">
              <div>
                <h2 id="walkin-modal-title" className="text-base font-bold text-[#111827]">
                  Add Walk-In Patient to Queue
                </h2>
                <p className="text-xs text-[#4B5563]">{hospital.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setWalkInOpen(false)}
                aria-label="Close walk-in modal"
                className="p-1 text-[#4B5563] hover:text-[#111827] rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitWalkIn} className="p-5 space-y-3.5 text-sm">
              {walkInError && (
                <div className="p-2.5 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs rounded">
                  {walkInError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="walkin-opd" className="block text-xs font-medium text-[#374151] mb-1">
                    Select OPD Department *
                  </label>
                  <select
                    id="walkin-opd"
                    required
                    value={walkInOpd}
                    onChange={(e) => {
                      setWalkInOpd(e.target.value as Specialty);
                      setWalkInDoctorId('');
                    }}
                    className="w-full h-10 px-2.5 bg-white border border-[#D1D5DB] rounded text-sm"
                  >
                    {hospital.specialties.map((sp) => (
                      <option key={sp} value={sp}>
                        {sp}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="walkin-doctor" className="block text-xs font-medium text-[#374151] mb-1">
                    Doctor (Optional)
                  </label>
                  <select
                    id="walkin-doctor"
                    value={walkInDoctorId}
                    onChange={(e) => setWalkInDoctorId(e.target.value)}
                    className="w-full h-10 px-2.5 bg-white border border-[#D1D5DB] rounded text-sm"
                  >
                    <option value="">{walkInOpd} Duty Doctor (Any)</option>
                    {walkInDoctorsForOpd.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="walkin-name" className="block text-xs font-medium text-[#374151] mb-1">
                    Patient Full Name *
                  </label>
                  <input
                    id="walkin-name"
                    type="text"
                    required
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    placeholder="e.g. Rajeshwari Joshi"
                    className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="walkin-phone" className="block text-xs font-medium text-[#374151] mb-1">
                    Mobile Number *
                  </label>
                  <input
                    id="walkin-phone"
                    type="tel"
                    required
                    value={walkInPhone}
                    onChange={(e) => setWalkInPhone(e.target.value)}
                    placeholder="10-digit mobile"
                    className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="walkin-age" className="block text-xs font-medium text-[#374151] mb-1">
                    Age *
                  </label>
                  <input
                    id="walkin-age"
                    type="number"
                    required
                    min={0}
                    max={120}
                    value={walkInAge}
                    onChange={(e) => setWalkInAge(e.target.value)}
                    className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="walkin-gender" className="block text-xs font-medium text-[#374151] mb-1">
                    Gender *
                  </label>
                  <select
                    id="walkin-gender"
                    value={walkInGender}
                    onChange={(e) => setWalkInGender(e.target.value as 'Male' | 'Female' | 'Other')}
                    className="w-full h-10 px-2.5 bg-white border border-[#D1D5DB] rounded text-sm"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor="walkin-pid" className="block text-xs font-medium text-[#374151] mb-1">
                    Patient PID (Optional)
                  </label>
                  <input
                    id="walkin-pid"
                    type="text"
                    value={walkInPid}
                    onChange={(e) => setWalkInPid(e.target.value)}
                    placeholder="PID-XXXX-XXXX-XX"
                    className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm uppercase"
                  />
                </div>
              </div>

              <p className="text-[11px] text-[#6B7280]">
                Leave PID blank for a walk-in patient without a Health ID (&quot;Walk-in (no PID)&quot;).
              </p>

              <div>
                <label htmlFor="walkin-reason" className="block text-xs font-medium text-[#374151] mb-1">
                  Visit Reason (Optional)
                </label>
                <input
                  id="walkin-reason"
                  type="text"
                  value={walkInReason}
                  onChange={(e) => setWalkInReason(e.target.value)}
                  placeholder="e.g. Blurred vision checkup"
                  className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E2E6EC]">
                <button
                  type="button"
                  onClick={() => setWalkInOpen(false)}
                  className="px-4 py-2 text-xs font-medium border border-[#D1D5DB] rounded text-[#374151] hover:bg-[#F5F6F8]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingWalkIn}
                  data-testid="walkin-submit-btn"
                  className="px-4 py-2 text-xs font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] disabled:opacity-60"
                >
                  {submittingWalkIn ? 'Adding to Queue...' : 'Issue Token & Add to Queue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {sponsorModalState.open && (
        <SponsoredCheckoutModal
          hospital={hospital}
          initialSpecialty={sponsorModalState.specialty}
          initialRank={sponsorModalState.rank}
          config={sponsoredConfig}
          nowMs={nowMs}
          onClose={() => setSponsorModalState({ open: false })}
          onActivated={() => {
            onRefresh();
          }}
          onWaitlistJoined={() => {
            onRefresh();
          }}
        />
      )}
    </div>
  );
}
