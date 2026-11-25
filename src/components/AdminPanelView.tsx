import { useEffect, useMemo, useState } from 'react';
import { Award, Check, Trash2, X } from 'lucide-react';
import { SPECIALTIES } from '../data/seedHospitals';
import type {
  BookingRecord,
  EmailNotificationPreview,
  HospitalRecord,
  ResetDataResult,
  Specialty,
} from '../types/pinnacle';

interface AdminPanelViewProps {
  hospitals: HospitalRecord[];
  bookings: BookingRecord[];
  emailPreviews: EmailNotificationPreview[];
  onAdminUpdateHospital: (
    hospitalId: string,
    payload: {
      status?: 'pending' | 'approved' | 'rejected';
      is_sponsored?: boolean;
      sponsor_rank?: 1 | 2;
      sponsor_start_date?: string;
      sponsor_end_date?: string;
    }
  ) => Promise<void>;
  onAssignSponsoredSlot: (payload: {
    city: string;
    specialty: Specialty;
    rank: 1 | 2;
    hospitalId: string | null;
    startDate?: string;
    endDate?: string;
  }) => Promise<void>;
  onResetAllData: () => Promise<ResetDataResult>;
}

function getSlotHolder(
  approvedHospitals: HospitalRecord[],
  specialty: Specialty,
  rank: 1 | 2,
  city?: string
): { hospital: HospitalRecord; startDate: string; endDate: string } | null {
  const normalizedCity = city?.trim().toLowerCase();
  for (const h of approvedHospitals) {
    if (normalizedCity && h.city.trim().toLowerCase() !== normalizedCity) continue;
    const slot = h.sponsor_slots?.[specialty];
    if (slot && slot.rank === rank) {
      return {
        hospital: h,
        startDate: slot.startDate || h.sponsor_start_date || '2026-01-01',
        endDate: slot.endDate || h.sponsor_end_date || '2027-12-31',
      };
    }
  }
  return null;
}

export function AdminPanelView({
  hospitals,
  bookings,
  emailPreviews,
  onAdminUpdateHospital,
  onAssignSponsoredSlot,
  onResetAllData,
}: AdminPanelViewProps) {
  const pendingHospitals = hospitals.filter((h) => h.status === 'pending');
  const approvedHospitals = hospitals.filter((h) => h.status === 'approved');

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetBanner, setResetBanner] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const availableCities = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const h of hospitals) {
      const c = h.city.trim();
      if (c && !seen.has(c.toLowerCase())) {
        seen.add(c.toLowerCase());
        list.push(c);
      }
    }
    return list.length > 0 ? list : ['Nagpur'];
  }, [hospitals]);

  const [selectedCity, setSelectedCity] = useState<string>('Nagpur');
  const [selectedSpecialty, setSelectedSpecialty] = useState<Specialty>('Eye OPD');
  const [slot1HospitalId, setSlot1HospitalId] = useState<string>('');
  const [slot1Start, setSlot1Start] = useState<string>(new Date().toISOString().slice(0, 10));
  const [slot1End, setSlot1End] = useState<string>('2027-12-31');

  const [slot2HospitalId, setSlot2HospitalId] = useState<string>('');
  const [slot2Start, setSlot2Start] = useState<string>(new Date().toISOString().slice(0, 10));
  const [slot2End, setSlot2End] = useState<string>('2027-12-31');

  const [savingSlot, setSavingSlot] = useState<1 | 2 | null>(null);
  const [slotFeedback, setSlotFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Keep selectedCity valid if database changes
  useEffect(() => {
    if (!availableCities.some((c) => c.toLowerCase() === selectedCity.toLowerCase())) {
      setSelectedCity(availableCities[0] || 'Nagpur');
    }
  }, [availableCities, selectedCity]);

  // Sync draft state whenever selectedCity, selectedSpecialty, or hospitals change
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const holder1 = getSlotHolder(approvedHospitals, selectedSpecialty, 1, selectedCity);
    const holder2 = getSlotHolder(approvedHospitals, selectedSpecialty, 2, selectedCity);
    setSlot1HospitalId(holder1?.hospital.id ?? '');
    setSlot1Start(holder1?.startDate.slice(0, 10) ?? today);
    setSlot1End(holder1?.endDate.slice(0, 10) ?? '2027-12-31');

    setSlot2HospitalId(holder2?.hospital.id ?? '');
    setSlot2Start(holder2?.startDate.slice(0, 10) ?? today);
    setSlot2End(holder2?.endDate.slice(0, 10) ?? '2027-12-31');
  }, [selectedCity, selectedSpecialty, hospitals]);

  const totalSponsoredSlotsFilledInCity = useMemo(() => {
    let count = 0;
    for (const sp of SPECIALTIES) {
      if (getSlotHolder(approvedHospitals, sp, 1, selectedCity)) count += 1;
      if (getSlotHolder(approvedHospitals, sp, 2, selectedCity)) count += 1;
    }
    return count;
  }, [approvedHospitals, selectedCity]);

  const eligibleForSpecialty = useMemo(
    () =>
      approvedHospitals.filter(
        (h) =>
          h.city.trim().toLowerCase() === selectedCity.trim().toLowerCase() &&
          h.specialties.includes(selectedSpecialty)
      ),
    [approvedHospitals, selectedCity, selectedSpecialty]
  );

  const handleSaveSlot = async (rank: 1 | 2, clearOnly = false) => {
    setSlotFeedback(null);
    setSavingSlot(rank);
    try {
      const chosenId = clearOnly
        ? null
        : rank === 1
          ? slot1HospitalId || null
          : slot2HospitalId || null;
      const startDate = rank === 1 ? slot1Start : slot2Start;
      const endDate = rank === 1 ? slot1End : slot2End;

      await onAssignSponsoredSlot({
        city: selectedCity,
        specialty: selectedSpecialty,
        rank,
        hospitalId: chosenId,
        startDate,
        endDate,
      });

      setSlotFeedback({
        type: 'ok',
        text: chosenId
          ? `Updated ${selectedCity} · ${selectedSpecialty} Sponsored Slot #${rank}.`
          : `Cleared ${selectedCity} · ${selectedSpecialty} Sponsored Slot #${rank}.`,
      });
    } catch (err) {
      setSlotFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save sponsored slot.',
      });
    } finally {
      setSavingSlot(null);
    }
  };

  const handleConfirmResetData = async () => {
    setResetError(null);
    setResetBanner(null);
    setResetting(true);
    try {
      const result = await onResetAllData();
      setResetConfirmOpen(false);
      setResetBanner(
        `Reset complete: cleared ${result.deleted.patients} patients, ${result.deleted.bookings} bookings/queue entries, ${result.deleted.prescriptions} prescriptions, ${result.deleted.dispensingRecords} dispensing records, and ${result.deleted.auditLogs} audit logs. Hospitals and staff accounts kept.`
      );
    } catch (err) {
      console.error('Reset all data failed:', err);
      setResetError(err instanceof Error ? err.message : 'Unable to reset data.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#111827]">Pinnacle Admin Panel</h1>
            <p className="text-sm text-[#4B5563] mt-0.5">
              Approve hospital registrations, assign up to 2 Sponsored slots per city &amp; OPD specialty, and monitor platform bookings.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setResetError(null);
              setResetConfirmOpen(true);
            }}
            data-testid="admin-reset-data-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-[#FECACA] text-[#B91C1C] bg-[#FEF2F2] rounded hover:bg-[#FEE2E2] min-h-[38px]"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            Reset all data
          </button>
        </div>

        {resetBanner && (
          <div className="mt-3 p-3 bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D] text-xs rounded">
            {resetBanner}
          </div>
        )}
        {resetError && (
          <div className="mt-3 p-3 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs rounded">
            {resetError}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded">
            <div className="text-xs text-[#6B7280]">Pending Approvals</div>
            <div className="text-xl font-bold text-[#B45309] mt-0.5 tabular-nums">
              {pendingHospitals.length}
            </div>
          </div>
          <div className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded">
            <div className="text-xs text-[#6B7280]">Approved OPDs</div>
            <div className="text-xl font-bold text-[#111827] mt-0.5 tabular-nums">
              {approvedHospitals.length}
            </div>
          </div>
          <div className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded">
            <div className="text-xs text-[#6B7280]">{selectedCity} Sponsored Slots</div>
            <div className="text-xl font-bold text-[#1F5FA8] mt-0.5 tabular-nums">
              {totalSponsoredSlotsFilledInCity} / {SPECIALTIES.length * 2}
            </div>
          </div>
          <div className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded">
            <div className="text-xs text-[#6B7280]">Total Bookings</div>
            <div className="text-xl font-bold text-[#111827] mt-0.5 tabular-nums">
              {bookings.length}
            </div>
          </div>
        </div>
      </div>

      {/* Pending Hospital Approvals */}
      <section className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[#111827] mb-3">
          Pending Hospital Registrations ({pendingHospitals.length})
        </h2>
        {pendingHospitals.length === 0 ? (
          <p className="text-xs text-[#6B7280]">No pending hospital applications right now.</p>
        ) : (
          <div className="space-y-3">
            {pendingHospitals.map((h) => (
              <div
                key={h.id}
                className="p-3.5 border border-[#E2E6EC] rounded flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                data-testid={`pending-hospital-${h.id}`}
              >
                <div>
                  <p className="text-sm font-semibold text-[#111827]">{h.name}</p>
                  <p className="text-xs text-[#4B5563]">
                    {h.type} · Reg: {h.registrationNumber} · {h.address}
                  </p>
                  <p className="text-xs text-[#6B7280] mt-0.5">
                    Specialties: {h.specialties.join(', ')} · Fee: ₹{h.consultationFee}
                    {h.contactPerson
                      ? ` · Contact: ${h.contactPerson.name} (${h.contactPerson.mobile})`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onAdminUpdateHospital(h.id, { status: 'approved' })}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium bg-[#15803D] text-white rounded hover:bg-[#166534] min-h-[38px]"
                  >
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdminUpdateHospital(h.id, { status: 'rejected' })}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium border border-[#FECACA] text-[#B91C1C] bg-white rounded hover:bg-[#FEF2F2] min-h-[38px]"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Per-OPD Sponsored Slots Manager (2 Sponsored Slots for EVERY OPD) */}
      <section
        className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-4"
        aria-label="Per-OPD Sponsored Slots Manager"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-1.5">
              <Award className="w-4 h-4 text-[#1F5FA8]" aria-hidden="true" />
              Sponsored Slots by Location &amp; OPD Specialty (2 Slots per OPD)
            </h2>
            <p className="text-xs text-[#4B5563] mt-0.5">
              Each city and OPD specialty has its own independent Slot #1 and Slot #2. Assigning a hospital applies only when patients search that city &amp; OPD.
            </p>
          </div>
        </div>

        {/* Location / City Selector derived dynamically from database hospitals */}
        <div>
          <span className="block text-xs font-medium text-[#374151] mb-1.5">
            Location / City
          </span>
          <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label="Select City for Sponsored Slots"
          >
            {availableCities.map((cityName) => {
              let citySlotsCount = 0;
              for (const sp of SPECIALTIES) {
                if (getSlotHolder(approvedHospitals, sp, 1, cityName)) citySlotsCount += 1;
                if (getSlotHolder(approvedHospitals, sp, 2, cityName)) citySlotsCount += 1;
              }
              const isCitySelected =
                selectedCity.trim().toLowerCase() === cityName.trim().toLowerCase();
              return (
                <button
                  key={cityName}
                  type="button"
                  role="tab"
                  aria-selected={isCitySelected}
                  data-testid={`admin-city-tab-${cityName.toLowerCase()}`}
                  onClick={() => {
                    setSelectedCity(cityName);
                    setSlotFeedback(null);
                  }}
                  className={`px-3 py-1.5 rounded border text-xs font-semibold transition-colors flex items-center gap-2 min-h-[36px] ${
                    isCitySelected
                      ? 'bg-[#111827] text-white border-[#111827]'
                      : 'bg-white text-[#374151] border-[#D1D5DB] hover:bg-[#F9FAFB]'
                  }`}
                >
                  <span>{cityName}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums ${
                      isCitySelected
                        ? 'bg-[#374151] text-white'
                        : 'bg-[#F3F4F6] text-[#4B5563]'
                    }`}
                  >
                    {citySlotsCount}/{SPECIALTIES.length * 2}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Specialty Picker Pills / Tabs */}
        <div>
          <span className="block text-xs font-medium text-[#374151] mb-1.5">
            OPD Specialty in {selectedCity}
          </span>
          <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label="Select OPD Specialty for Sponsored Slots"
          >
            {SPECIALTIES.map((sp) => {
              const h1 = getSlotHolder(approvedHospitals, sp, 1, selectedCity);
              const h2 = getSlotHolder(approvedHospitals, sp, 2, selectedCity);
              const count = (h1 ? 1 : 0) + (h2 ? 1 : 0);
              const isSelected = selectedSpecialty === sp;
              return (
                <button
                  key={sp}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setSelectedSpecialty(sp);
                    setSlotFeedback(null);
                  }}
                  className={`px-3 py-2 rounded border text-xs font-medium transition-colors flex items-center gap-2 min-h-[38px] ${
                    isSelected
                      ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                      : 'bg-[#F9FAFB] text-[#374151] border-[#D1D5DB] hover:bg-[#EFF6FF]'
                  }`}
                >
                  <span>{sp}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums ${
                      isSelected
                        ? 'bg-[#184C87] text-white'
                        : count > 0
                          ? 'bg-[#EFF6FF] text-[#1F5FA8]'
                          : 'bg-[#E5E7EB] text-[#4B5563]'
                    }`}
                  >
                    {count}/2
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {slotFeedback && (
          <div
            role="status"
            className={`px-3 py-2 rounded border text-xs font-medium ${
              slotFeedback.type === 'ok'
                ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
            }`}
          >
            {slotFeedback.text}
          </div>
        )}

        {/* Active OPD Slot #1 and Slot #2 Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Slot #1 */}
          <div className="border border-[#E2E6EC] rounded-md p-4 bg-[#F9FAFB] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#1F5FA8]">
                {selectedCity} · {selectedSpecialty} · Sponsored Slot #1
              </span>
              {getSlotHolder(approvedHospitals, selectedSpecialty, 1, selectedCity) ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D]">
                  Active
                </span>
              ) : (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-white border border-[#D1D5DB] text-[#6B7280]">
                  Available
                </span>
              )}
            </div>

            <div>
              <label
                htmlFor="sponsor-slot-1-hospital"
                className="block text-xs font-medium text-[#374151] mb-1"
              >
                Hospital for Slot #1 ({eligibleForSpecialty.length} offering {selectedSpecialty})
              </label>
              <select
                id="sponsor-slot-1-hospital"
                value={slot1HospitalId}
                onChange={(e) => setSlot1HospitalId(e.target.value)}
                className="w-full h-10 px-2.5 border border-[#D1D5DB] rounded text-xs sm:text-sm bg-white text-[#111827]"
              >
                <option value="">— Empty Slot —</option>
                {eligibleForSpecialty.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.area})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor="sponsor-slot-1-start"
                  className="block text-xs text-[#4B5563] mb-1"
                >
                  Start Date
                </label>
                <input
                  id="sponsor-slot-1-start"
                  type="date"
                  value={slot1Start}
                  onChange={(e) => setSlot1Start(e.target.value)}
                  className="w-full h-9 px-2 border border-[#D1D5DB] rounded text-xs bg-white"
                />
              </div>
              <div>
                <label
                  htmlFor="sponsor-slot-1-end"
                  className="block text-xs text-[#4B5563] mb-1"
                >
                  End Date
                </label>
                <input
                  id="sponsor-slot-1-end"
                  type="date"
                  value={slot1End}
                  onChange={(e) => setSlot1End(e.target.value)}
                  className="w-full h-9 px-2 border border-[#D1D5DB] rounded text-xs bg-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={savingSlot !== null}
                onClick={() => void handleSaveSlot(1, false)}
                className="px-3.5 py-2 text-xs font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] disabled:opacity-60 min-h-[38px]"
              >
                {savingSlot === 1 ? 'Saving...' : 'Save Slot #1'}
              </button>
              {getSlotHolder(approvedHospitals, selectedSpecialty, 1, selectedCity) && (
                <button
                  type="button"
                  disabled={savingSlot !== null}
                  onClick={() => void handleSaveSlot(1, true)}
                  className="px-3 py-2 text-xs font-medium border border-[#FECACA] text-[#B91C1C] bg-white rounded hover:bg-[#FEF2F2] min-h-[38px]"
                >
                  Clear Slot #1
                </button>
              )}
            </div>
          </div>

          {/* Slot #2 */}
          <div className="border border-[#E2E6EC] rounded-md p-4 bg-[#F9FAFB] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#1F5FA8]">
                {selectedCity} · {selectedSpecialty} · Sponsored Slot #2
              </span>
              {getSlotHolder(approvedHospitals, selectedSpecialty, 2, selectedCity) ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D]">
                  Active
                </span>
              ) : (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-white border border-[#D1D5DB] text-[#6B7280]">
                  Available
                </span>
              )}
            </div>

            <div>
              <label
                htmlFor="sponsor-slot-2-hospital"
                className="block text-xs font-medium text-[#374151] mb-1"
              >
                Hospital for Slot #2 ({eligibleForSpecialty.length} offering {selectedSpecialty})
              </label>
              <select
                id="sponsor-slot-2-hospital"
                value={slot2HospitalId}
                onChange={(e) => setSlot2HospitalId(e.target.value)}
                className="w-full h-10 px-2.5 border border-[#D1D5DB] rounded text-xs sm:text-sm bg-white text-[#111827]"
              >
                <option value="">— Empty Slot —</option>
                {eligibleForSpecialty.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.area})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor="sponsor-slot-2-start"
                  className="block text-xs text-[#4B5563] mb-1"
                >
                  Start Date
                </label>
                <input
                  id="sponsor-slot-2-start"
                  type="date"
                  value={slot2Start}
                  onChange={(e) => setSlot2Start(e.target.value)}
                  className="w-full h-9 px-2 border border-[#D1D5DB] rounded text-xs bg-white"
                />
              </div>
              <div>
                <label
                  htmlFor="sponsor-slot-2-end"
                  className="block text-xs text-[#4B5563] mb-1"
                >
                  End Date
                </label>
                <input
                  id="sponsor-slot-2-end"
                  type="date"
                  value={slot2End}
                  onChange={(e) => setSlot2End(e.target.value)}
                  className="w-full h-9 px-2 border border-[#D1D5DB] rounded text-xs bg-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={savingSlot !== null}
                onClick={() => void handleSaveSlot(2, false)}
                className="px-3.5 py-2 text-xs font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] disabled:opacity-60 min-h-[38px]"
              >
                {savingSlot === 2 ? 'Saving...' : 'Save Slot #2'}
              </button>
              {getSlotHolder(approvedHospitals, selectedSpecialty, 2, selectedCity) && (
                <button
                  type="button"
                  disabled={savingSlot !== null}
                  onClick={() => void handleSaveSlot(2, true)}
                  className="px-3 py-2 text-xs font-medium border border-[#FECACA] text-[#B91C1C] bg-white rounded hover:bg-[#FEF2F2] min-h-[38px]"
                >
                  Clear Slot #2
                </button>
              )}
            </div>
          </div>
        </div>

        {/* All-OPD Sponsorship Summary Matrix */}
        <div className="pt-2 border-t border-[#E2E6EC] overflow-x-auto">
          <h3 className="text-xs font-semibold text-[#374151] mb-2">
            All OPD Specialties in {selectedCity} — Current Sponsored Lineup
          </h3>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E6EC] text-[#6B7280]">
                <th className="py-2 pr-3 font-medium">OPD Specialty</th>
                <th className="py-2 pr-3 font-medium">Sponsored Slot #1</th>
                <th className="py-2 pr-3 font-medium">Sponsored Slot #2</th>
                <th className="py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {SPECIALTIES.map((sp) => {
                const s1 = getSlotHolder(approvedHospitals, sp, 1, selectedCity);
                const s2 = getSlotHolder(approvedHospitals, sp, 2, selectedCity);
                const isCurrent = selectedSpecialty === sp;
                return (
                  <tr
                    key={sp}
                    className={`border-b border-[#F3F4F6] ${isCurrent ? 'bg-[#EFF6FF]/60' : ''}`}
                  >
                    <td className="py-2 pr-3 font-medium text-[#111827]">{sp}</td>
                    <td className="py-2 pr-3 text-[#374151]">
                      {s1 ? (
                        <span className="font-medium text-[#1F5FA8]">{s1.hospital.name}</span>
                      ) : (
                        <span className="text-[#9CA3AF]">Empty</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[#374151]">
                      {s2 ? (
                        <span className="font-medium text-[#1F5FA8]">{s2.hospital.name}</span>
                      ) : (
                        <span className="text-[#9CA3AF]">Empty</span>
                      )}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSpecialty(sp);
                          setSlotFeedback(null);
                        }}
                        className="text-[#1F5FA8] font-medium hover:underline"
                      >
                        {isCurrent ? 'Editing' : 'Manage'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Hospital Approval Directory */}
      <section className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 overflow-x-auto">
        <h2 className="text-sm font-semibold text-[#111827] mb-3">
          Hospital Directory &amp; Approval Status ({hospitals.length})
        </h2>
        <table className="w-full text-left border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-[#E2E6EC] text-xs text-[#6B7280]">
              <th className="py-2 pr-3 font-medium">Hospital</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Active OPD Sponsored Slots</th>
              <th className="py-2 font-medium">Specialties Offered</th>
            </tr>
          </thead>
          <tbody>
            {hospitals.map((h) => {
              const slotEntries = Object.entries(h.sponsor_slots ?? {}).filter(
                ([, cfg]) => Boolean(cfg)
              ) as Array<[Specialty, { rank: 1 | 2; startDate?: string; endDate?: string }]>;
              return (
                <tr key={h.id} className="border-b border-[#F3F4F6]">
                  <td className="py-2.5 pr-3">
                    <div className="font-medium text-[#111827]">{h.name}</div>
                    <div className="text-xs text-[#6B7280]">
                      {h.area}, {h.city}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <select
                      aria-label={`Approval status for ${h.name}`}
                      value={h.status}
                      onChange={(e) =>
                        onAdminUpdateHospital(h.id, {
                          status: e.target.value as 'pending' | 'approved' | 'rejected',
                        })
                      }
                      className="h-8 px-2 border border-[#D1D5DB] rounded text-xs bg-white"
                    >
                      <option value="approved">Approved</option>
                      <option value="pending">Pending</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </td>
                  <td className="py-2.5 pr-3">
                    {slotEntries.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {slotEntries.map(([sp, cfg]) => (
                          <span
                            key={sp}
                            className="inline-flex items-center px-2 py-0.5 rounded bg-[#EFF6FF] border border-[#BFDBFE] text-[#1F5FA8] text-xs font-medium"
                          >
                            {sp} · #{cfg.rank}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-[#6B7280]">Free Organic Listing</span>
                    )}
                  </td>
                  <td className="py-2.5 text-xs text-[#4B5563]">
                    {h.specialties.join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Bookings & Dispatched Notifications */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-[#111827] mb-3">
            Recent Patient Bookings ({bookings.length})
          </h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {bookings.map((b) => (
              <div key={b.id} className="p-2.5 border border-[#E2E6EC] rounded text-xs flex justify-between">
                <div>
                  <span className="font-semibold text-[#1F5FA8]">{b.tokenNumber}</span> ·{' '}
                  <span className="font-medium text-[#111827]">{b.patientName}</span>
                  <div className="text-[#6B7280]">{b.hospitalName}</div>
                </div>
                <div className="text-right">
                  <span className="capitalize font-medium text-[#374151]">{b.status}</span>
                  <div className="text-[#6B7280]">{b.date}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-[#111827] mb-3">
            Notification Outbox ({emailPreviews.length})
          </h2>
          {emailPreviews.length === 0 ? (
            <p className="text-xs text-[#6B7280]">
              Booking and hospital registration confirmation emails appear here.
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {emailPreviews.map((mail) => (
                <div key={mail.id} className="p-2.5 border border-[#E2E6EC] rounded text-xs">
                  <div className="font-semibold text-[#111827]">{mail.subject}</div>
                  <div className="text-[#6B7280]">To: {mail.to}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Confirmation Dialog for Reset All Data */}
      {resetConfirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-confirm-title"
        >
          <div className="bg-white border border-[#E2E6EC] rounded-md max-w-md w-full p-5 space-y-3 shadow-lg">
            <h2 id="reset-confirm-title" className="text-base font-bold text-[#111827]">
              Reset All Patient &amp; Queue Data?
            </h2>
            <p className="text-xs sm:text-sm text-[#4B5563]">
              This permanently deletes all patients, bookings, queue entries, prescriptions, dispensing records, and audit logs. Hospitals and staff accounts (Doctor / Medical) will stay intact.
            </p>
            {resetError && (
              <div className="p-2 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs rounded">
                {resetError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-[#E2E6EC]">
              <button
                type="button"
                disabled={resetting}
                onClick={() => setResetConfirmOpen(false)}
                className="px-4 py-2 text-xs font-medium border border-[#D1D5DB] rounded text-[#374151] hover:bg-[#F5F6F8]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={() => void handleConfirmResetData()}
                data-testid="confirm-reset-data-btn"
                className="px-4 py-2 text-xs font-semibold bg-[#B91C1C] text-white rounded hover:bg-[#991B1B] disabled:opacity-60"
              >
                {resetting ? 'Resetting...' : 'Yes, Reset All Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
