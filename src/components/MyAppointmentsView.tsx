import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Calendar,
  History,
  Navigation,
  RotateCcw,
  Search,
  Share2,
  Stethoscope,
} from 'lucide-react';
import type {
  BookingRecord,
  Coordinates,
  HospitalRecord,
  Specialty,
  TransportMode,
  TravelEstimate,
} from '../types/pinnacle';
import { calculateDepartureAdvisory, estimateUrbanTravel } from '../utils/ranking';
import {
  filterHistoryBookings,
  getUniquePreviousDoctors,
  partitionBookings,
  type HistoryStatusFilter,
} from '../utils/history';
import {
  buildGoogleMapsDirectionsUrl,
  buildWhatsAppShareUrl,
  downloadCalendarInvite,
} from '../utils/calendarAndShare';

interface MyAppointmentsViewProps {
  bookings: BookingRecord[];
  hospitals: HospitalRecord[];
  userLocation: Coordinates;
  transportMode: TransportMode;
  travelMatrixByHospitalId: Record<string, TravelEstimate>;
  onCancelBooking: (bookingId: string) => Promise<void>;
  onRescheduleBooking: (bookingId: string, newDate: string, newSlot: string) => Promise<void>;
  onRebookDoctor: (target: {
    hospitalId: string;
    doctorName: string;
    specialty: Specialty;
  }) => void;
  onGoToSearch: () => void;
}

const RESCHEDULE_SLOTS = ['10:30 AM', '12:00 PM', '04:30 PM', '06:00 PM'];

export function MyAppointmentsView({
  bookings,
  hospitals,
  userLocation,
  transportMode,
  travelMatrixByHospitalId,
  onCancelBooking,
  onRescheduleBooking,
  onRebookDoctor,
  onGoToSearch,
}: MyAppointmentsViewProps) {
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(new Date().toISOString().slice(0, 10));
  const [rescheduleSlot, setRescheduleSlot] = useState(RESCHEDULE_SLOTS[0]);
  const [historyFilter, setHistoryFilter] = useState<HistoryStatusFilter>('all');
  const [historyQuery, setHistoryQuery] = useState('');

  const { activeBookings, historyBookings } = useMemo(
    () => partitionBookings(bookings),
    [bookings]
  );

  const filteredHistory = useMemo(
    () => filterHistoryBookings(historyBookings, historyFilter, historyQuery),
    [historyBookings, historyFilter, historyQuery]
  );

  const previousDoctors = useMemo(() => getUniquePreviousDoctors(bookings), [bookings]);

  if (bookings.length === 0) {
    return (
      <div className="bg-white border border-[#E2E6EC] rounded-md p-8 text-center">
        <h2 className="text-lg font-semibold text-[#111827]">No Appointments Yet</h2>
        <p className="text-sm text-[#4B5563] mt-1">
          Book an OPD slot or join a live queue to track your token, departure advisory, and visit history here.
        </p>
        <button
          type="button"
          onClick={onGoToSearch}
          className="mt-4 px-4 py-2.5 text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87]"
        >
          Find Nearby OPDs
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111827]">My Appointments &amp; Live Queue</h1>
          <p className="text-sm text-[#4B5563] mt-0.5">
            Track live OPD tokens, departure alerts, and re-book doctors from your visit history.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToSearch}
          className="px-3.5 py-2 text-xs font-medium border border-[#D1D5DB] rounded text-[#374151] bg-white hover:bg-[#F5F6F8]"
        >
          Book Another OPD
        </button>
      </div>

      {/* Section 1: Active & Live Queue Appointments */}
      <section aria-label="Active Queue Appointments" className="space-y-3">
        <h2 className="text-sm font-semibold text-[#111827]">
          Active &amp; Live Queue ({activeBookings.length})
        </h2>

        {activeBookings.length === 0 ? (
          <div className="bg-white border border-[#E2E6EC] rounded-md p-5 text-sm text-[#4B5563]">
            No active queue tokens right now. You can re-book a previous doctor below or search all OPDs.
          </div>
        ) : (
          <div className="space-y-3">
            {activeBookings.map((bk) => {
              const hospital = hospitals.find((h) => h.id === bk.hospitalId);
              const travel =
                travelMatrixByHospitalId[bk.hospitalId] ??
                estimateUrbanTravel(
                  userLocation,
                  { lat: bk.hospitalLat, lng: bk.hospitalLng },
                  transportMode
                );

              const advisory = calculateDepartureAdvisory({
                queuePosition: bk.queuePosition,
                avgConsultMinutes: hospital?.avgConsultMinutes ?? 10,
                activeCounters: hospital?.activeCounters ?? 1,
                travelMinutes: travel.travelMinutes,
                initialEstimatedWaitMinutes: bk.initialEstimatedWaitMinutes,
              });

              return (
                <div
                  key={bk.id}
                  className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-3"
                  data-testid={`appointment-card-${bk.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 text-xs font-bold bg-[#EFF6FF] text-[#1F5FA8] border border-[#BFDBFE] rounded tabular-nums">
                          Token {bk.tokenNumber}
                        </span>
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                            bk.status === 'called'
                              ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                              : 'bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]'
                          }`}
                        >
                          {bk.status === 'called' ? 'Called to Desk' : 'In Queue'}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-[#111827] mt-1.5">
                        {bk.hospitalName}
                      </h3>
                      <p className="text-xs text-[#4B5563]">
                        {bk.doctorName} · {bk.specialty} · {bk.date} ({bk.timeSlot})
                      </p>
                      <p className="text-xs text-[#6B7280] mt-0.5">
                        Patient: {bk.patientName} · {bk.hospitalAddress}
                      </p>
                    </div>

                    <div className="bg-[#F5F6F8] border border-[#E2E6EC] rounded px-3.5 py-2.5 text-right">
                      <div className="text-xs text-[#6B7280]">Current Position</div>
                      <div className="text-xl font-bold text-[#1F5FA8] tabular-nums">
                        #{bk.queuePosition}
                      </div>
                      <div className="text-xs text-[#374151] tabular-nums">
                        Travel: {travel.travelMinutes} min ({travel.distanceKm} km)
                      </div>
                    </div>
                  </div>

                  {/* Live Departure Advisory */}
                  <div className="p-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded text-sm text-[#111827] flex items-start gap-2">
                    <Bell className="w-4 h-4 text-[#1F5FA8] shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="font-medium tabular-nums">{advisory.statusMessage}</p>
                      {advisory.alertMessage && (
                        <p
                          className={`text-xs font-semibold mt-1 flex items-center gap-1 ${
                            advisory.alertType === 'faster' ? 'text-[#B45309]' : 'text-[#1F5FA8]'
                          }`}
                        >
                          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          {advisory.alertMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href={buildGoogleMapsDirectionsUrl(bk.hospitalLat, bk.hospitalLng, bk.hospitalName)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-[#D1D5DB] text-[#374151] rounded hover:bg-[#F5F6F8]"
                    >
                      <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
                      Directions
                    </a>
                    <button
                      type="button"
                      onClick={() => downloadCalendarInvite(bk)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-[#D1D5DB] text-[#374151] rounded hover:bg-[#F5F6F8]"
                    >
                      <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                      Calendar
                    </button>
                    <a
                      href={buildWhatsAppShareUrl(bk)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-[#D1D5DB] text-[#374151] rounded hover:bg-[#F5F6F8]"
                    >
                      <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                      WhatsApp
                    </a>
                    <button
                      type="button"
                      onClick={() => setRescheduleId(rescheduleId === bk.id ? null : bk.id)}
                      className="px-3 py-2 text-xs font-medium border border-[#D1D5DB] text-[#1F5FA8] rounded hover:bg-[#EFF6FF]"
                    >
                      Reschedule
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancelBooking(bk.id)}
                      className="px-3 py-2 text-xs font-medium border border-[#FECACA] text-[#B91C1C] rounded hover:bg-[#FEF2F2]"
                    >
                      Cancel
                    </button>
                  </div>

                  {rescheduleId === bk.id && (
                    <div className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded flex flex-wrap items-end gap-2">
                      <div>
                        <label className="block text-xs text-[#4B5563] mb-1">New Date</label>
                        <input
                          type="date"
                          value={rescheduleDate}
                          onChange={(e) => setRescheduleDate(e.target.value)}
                          className="h-9 px-2 border border-[#D1D5DB] rounded text-xs bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#4B5563] mb-1">New Slot</label>
                        <select
                          value={rescheduleSlot}
                          onChange={(e) => setRescheduleSlot(e.target.value)}
                          className="h-9 px-2 border border-[#D1D5DB] rounded text-xs bg-white"
                        >
                          {RESCHEDULE_SLOTS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await onRescheduleBooking(bk.id, rescheduleDate, rescheduleSlot);
                          setRescheduleId(null);
                        }}
                        className="h-9 px-3 bg-[#1F5FA8] text-white text-xs font-medium rounded hover:bg-[#184C87]"
                      >
                        Save New Slot
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Quick Re-Book Previous Doctors */}
      {previousDoctors.length > 0 && (
        <section aria-label="Previous Doctors" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-1.5">
              <Stethoscope className="w-4 h-4 text-[#1F5FA8]" aria-hidden="true" />
              Previous Doctors — Quick Re-book ({previousDoctors.length})
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {previousDoctors.map((doc) => (
              <div
                key={`${doc.hospitalId}-${doc.doctorName}`}
                className="bg-white border border-[#E2E6EC] rounded-md p-4 flex flex-col justify-between gap-3"
                data-testid={`prev-doctor-${doc.hospitalId}`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[#111827]">{doc.doctorName}</h3>
                    <span className="text-[11px] font-medium px-2 py-0.5 bg-[#F5F6F8] border border-[#E2E6EC] rounded text-[#4B5563] whitespace-nowrap">
                      {doc.specialty}
                    </span>
                  </div>
                  <p className="text-xs text-[#4B5563] mt-0.5">{doc.hospitalName}</p>
                  <p className="text-[11px] text-[#6B7280] mt-1 tabular-nums">
                    Last visit: {doc.lastVisitDate} · {doc.visitCount} visit
                    {doc.visitCount > 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onRebookDoctor({
                      hospitalId: doc.hospitalId,
                      doctorName: doc.doctorName,
                      specialty: doc.specialty,
                    })
                  }
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#EFF6FF] text-[#1F5FA8] border border-[#BFDBFE] rounded hover:bg-[#DBEAFE] min-h-[38px]"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Re-book {doc.doctorName}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 3: Visit History Log */}
      <section aria-label="Appointment History Log" className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#111827] flex items-center gap-1.5">
              <History className="w-4 h-4 text-[#1F5FA8]" aria-hidden="true" />
              Appointment History Log ({historyBookings.length})
            </h2>
            <p className="text-xs text-[#4B5563] mt-0.5">
              Review past OPD visits, reasons, and re-book the same doctor in one click.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#6B7280] absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="text"
                aria-label="Search appointment history"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Search doctor or hospital"
                className="h-9 pl-8 pr-3 border border-[#D1D5DB] rounded text-xs text-[#111827] bg-white w-48 sm:w-56"
              />
            </div>

            <select
              aria-label="Filter appointment history status"
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as HistoryStatusFilter)}
              className="h-9 px-2.5 border border-[#D1D5DB] rounded text-xs text-[#111827] bg-white"
            >
              <option value="all">All Past Visits</option>
              <option value="completed">Completed Only</option>
              <option value="cancelled_or_skipped">Cancelled / Skipped</option>
            </select>
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <p className="text-xs text-[#6B7280] py-4">
            No past appointments match your current filter.
          </p>
        ) : (
          <div className="space-y-2.5" data-testid="history-log-list">
            {filteredHistory.map((bk) => (
              <div
                key={bk.id}
                className="p-3.5 border border-[#E2E6EC] rounded bg-[#F9FAFB] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                data-testid={`history-entry-${bk.id}`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[#111827] tabular-nums">
                      {bk.date} · {bk.timeSlot}
                    </span>
                    <span className="px-1.5 py-0.5 text-[11px] font-medium bg-white border border-[#D1D5DB] rounded text-[#374151] tabular-nums">
                      Token {bk.tokenNumber}
                    </span>
                    <span
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded border capitalize ${
                        bk.status === 'completed'
                          ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                          : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                      }`}
                    >
                      {bk.status}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-[#111827]">
                    {bk.doctorName}{' '}
                    <span className="font-normal text-[#4B5563]">· {bk.specialty}</span>
                  </div>
                  <div className="text-xs text-[#4B5563]">{bk.hospitalName}</div>
                  {bk.reason && (
                    <div className="text-xs text-[#6B7280]">Visit note: {bk.reason}</div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      onRebookDoctor({
                        hospitalId: bk.hospitalId,
                        doctorName: bk.doctorName,
                        specialty: bk.specialty,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] min-h-[38px]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    Re-book Doctor
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
