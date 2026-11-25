import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookmarkPlus,
  CheckCircle2,
  FileDown,
  History,
  LogOut,
  Plus,
  Send,
  ShieldAlert,
  Stethoscope,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { SEEDED_MEDICINES } from '../data/seedHealthRecords';
import {
  auth,
  subscribeToHospitalPrescriptions,
  syncPrescriptionToFirestore,
} from '../lib/firebase';
import type {
  ActiveStaffSession,
  BookingRecord,
  HealthVisitRecord,
  HospitalRecord,
  MealRelation,
  MedicineTiming,
  PrescriptionMedicineItem,
  PrescriptionTemplate,
  SharedPrescriptionRecord,
} from '../types/pinnacle';
import { downloadPrescriptionPdf } from '../utils/prescriptionPdf';

interface DoctorWorkspaceViewProps {
  session: ActiveStaffSession;
  refreshSignal: number;
  onLogout: () => void;
}

interface PatientHistoryResponse {
  isWalkIn: boolean;
  pid?: string;
  consentGranted: boolean;
  history: HealthVisitRecord[];
  message?: string;
  patient: {
    name: string;
    age: number;
    gender: 'Male' | 'Female' | 'Other';
  };
}

function createEmptyMedicineRow(): PrescriptionMedicineItem {
  return {
    id: `med-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    medicineName: '',
    strength: '',
    when: ['Morning', 'Night'],
    foodTiming: 'After food',
    howMuch: '1 tablet',
    durationDays: 5,
    totalQuantity: '10 tablets',
  };
}

const TIMING_OPTIONS: MedicineTiming[] = ['Morning', 'Afternoon', 'Night'];

export function DoctorWorkspaceView({
  session,
  refreshSignal,
  onLogout,
}: DoctorWorkspaceViewProps) {
  const [hospital, setHospital] = useState<HospitalRecord | null>(null);
  const [queue, setQueue] = useState<BookingRecord[]>([]);
  const [consultations, setConsultations] = useState<HealthVisitRecord[]>([]);
  const [hospitalPrescriptions, setHospitalPrescriptions] = useState<SharedPrescriptionRecord[]>([]);
  const [templates, setTemplates] = useState<PrescriptionTemplate[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<string>('');
  const [patientHistory, setPatientHistory] = useState<PatientHistoryResponse | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Consultation Form State
  const [symptoms, setSymptoms] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [medicines, setMedicines] = useState<PrescriptionMedicineItem[]>([
    createEmptyMedicineRow(),
  ]);
  const [activeAutocompleteRowId, setActiveAutocompleteRowId] = useState<string | null>(null);
  const [templateNameDraft, setTemplateNameDraft] = useState('');
  const [showTemplateSave, setShowTemplateSave] = useState(false);

  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchWorkspace = useCallback(async () => {
    try {
      const res = await fetch('/api/doctor/workspace', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err.error || 'Unable to load doctor workspace.';
        console.error('Doctor workspace load failed:', res.status, msg);
        setErrorMessage(msg);
        return;
      }
      const data = await res.json();
      setHospital(data.hospital || null);
      const nextQueue: BookingRecord[] = data.queue || [];
      setQueue(nextQueue);
      setConsultations(data.consultations || []);
      setHospitalPrescriptions(Array.isArray(data.prescriptions) ? data.prescriptions : []);
      setTemplates(data.templates || []);

      setSelectedBookingId((prev) => {
        if (prev && nextQueue.some((b) => b.id === prev)) return prev;
        return nextQueue[0]?.id || '';
      });
    } catch (err) {
      console.error('Network error loading doctor workspace:', err);
      setErrorMessage('Network error loading doctor workspace.');
    } finally {
      setLoadingWorkspace(false);
    }
  }, [session.token]);

  useEffect(() => {
    void fetchWorkspace();
  }, [fetchWorkspace, refreshSignal]);

  useEffect(() => {
    if (!auth.currentUser || !session.hospitalId) return;
    const unsub = subscribeToHospitalPrescriptions(
      session.hospitalId,
      (list) => {
        if (list.length > 0) {
          setHospitalPrescriptions(list);
        }
      },
      (err) => {
        console.error('Doctor Firestore prescription listener error:', err);
      }
    );
    return () => unsub();
  }, [session.hospitalId]);

  const currentBooking = useMemo(
    () => queue.find((b) => b.id === selectedBookingId) ?? null,
    [queue, selectedBookingId]
  );

  // Fetch active patient's consented history whenever doctor switches patient on screen
  useEffect(() => {
    let cancelled = false;
    if (!currentBooking) {
      setPatientHistory(null);
      return;
    }

    async function loadPatientHistory(booking: BookingRecord) {
      setLoadingHistory(true);
      setErrorMessage(null);
      try {
        const res = await fetch(
          `/api/doctor/patient-history?bookingId=${encodeURIComponent(booking.id)}`,
          {
            headers: { Authorization: `Bearer ${session.token}` },
          }
        );
        const data = await res.json();
        if (!cancelled) {
          if (res.ok) {
            setPatientHistory(data);
          } else {
            setPatientHistory(null);
            setErrorMessage(data.error || 'Could not verify patient history access.');
          }
        }
      } catch {
        if (!cancelled) setErrorMessage('Unable to fetch patient history.');
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }

    // Restore any existing consultation draft for this booking in current hospital
    const existingDraft = consultations.find((c) => c.bookingId === currentBooking.id);
    if (existingDraft) {
      setSymptoms(existingDraft.symptoms || '');
      setDiagnosis(existingDraft.diagnosis || '');
      setNotes(existingDraft.notes || '');
      setFollowUpDate(existingDraft.followUpDate || '');
      setMedicines(
        existingDraft.medicines.length > 0
          ? existingDraft.medicines.map((m) => ({ ...m, when: [...m.when] }))
          : [createEmptyMedicineRow()]
      );
    } else {
      setSymptoms(currentBooking.reason || '');
      setDiagnosis('');
      setNotes('');
      setFollowUpDate('');
      setMedicines([createEmptyMedicineRow()]);
    }

    setStatusMessage(null);
    void loadPatientHistory(currentBooking);
    return () => {
      cancelled = true;
    };
  }, [currentBooking?.id, session.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentSavedVisit = useMemo(
    () => (currentBooking ? consultations.find((c) => c.bookingId === currentBooking.id) : undefined),
    [consultations, currentBooking]
  );

  const currentSharedRx = useMemo(
    () =>
      currentBooking
        ? hospitalPrescriptions.find(
            (rx) =>
              rx.booking_id === currentBooking.id ||
              (currentSavedVisit && rx.visit_id === currentSavedVisit.id)
          )
        : undefined,
    [hospitalPrescriptions, currentBooking, currentSavedVisit]
  );

  const handleUpdateMedicine = (
    rowId: string,
    patch: Partial<PrescriptionMedicineItem>
  ) => {
    setMedicines((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
    );
  };

  const handleToggleWhen = (rowId: string, timing: MedicineTiming) => {
    setMedicines((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const exists = row.when.includes(timing);
        const nextWhen = exists
          ? row.when.filter((t) => t !== timing)
          : [...row.when, timing];
        return { ...row, when: nextWhen.length > 0 ? nextWhen : [timing] };
      })
    );
  };

  const handleSelectSeededMedicine = (
    rowId: string,
    option: (typeof SEEDED_MEDICINES)[number]
  ) => {
    handleUpdateMedicine(rowId, {
      medicineName: option.name,
      strength: option.defaultStrength,
      howMuch: option.defaultHowMuch,
    });
    setActiveAutocompleteRowId(null);
  };

  const handleApplyTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    if (!diagnosis.trim()) {
      setDiagnosis(tpl.diagnosis);
    }
    setMedicines(
      tpl.medicines.map((m, idx) => ({
        ...m,
        id: `med-${Date.now().toString(36)}-${idx}`,
        when: [...m.when],
      }))
    );
    setStatusMessage(`Loaded template: ${tpl.name}`);
  };

  const handleSaveTemplate = async () => {
    setErrorMessage(null);
    const validMeds = medicines.filter((m) => m.medicineName.trim());
    if (templateNameDraft.trim().length < 2 || validMeds.length === 0) {
      setErrorMessage('Enter a template name and at least one medicine to save a template.');
      return;
    }
    try {
      const res = await fetch('/api/doctor/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          name: templateNameDraft.trim(),
          diagnosis: diagnosis.trim(),
          medicines: validMeds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Could not save template.');
        return;
      }
      setTemplates((prev) => [data.template, ...prev]);
      setTemplateNameDraft('');
      setShowTemplateSave(false);
      setStatusMessage(`Saved prescription template "${data.template.name}".`);
    } catch {
      setErrorMessage('Network error saving template.');
    }
  };

  const saveConsultation = async (sendToMedical: boolean): Promise<HealthVisitRecord | null> => {
    if (!currentBooking) return null;
    setErrorMessage(null);
    setStatusMessage(null);

    if (!diagnosis.trim()) {
      setErrorMessage('Please enter a Diagnosis before saving or sending to Medical.');
      return null;
    }

    const validMeds = medicines.filter((m) => m.medicineName.trim());
    if (sendToMedical && validMeds.length === 0) {
      setErrorMessage('Add at least one medicine before clicking "Save and Send to Medical".');
      return null;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/doctor/consultations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          bookingId: currentBooking.id,
          symptoms,
          diagnosis,
          notes,
          followUpDate: followUpDate || undefined,
          medicines: validMeds,
          sendToMedical,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || 'Could not save prescription.';
        console.error('Save consultation failed:', res.status, msg);
        setErrorMessage(msg);
        return null;
      }
      const savedVisit: HealthVisitRecord = data.visit;
      setConsultations((prev) => {
        const idx = prev.findIndex((v) => v.id === savedVisit.id);
        if (idx === -1) return [savedVisit, ...prev];
        const copy = [...prev];
        copy[idx] = savedVisit;
        return copy;
      });
      if (data.prescription) {
        const savedRx = data.prescription as SharedPrescriptionRecord;
        setHospitalPrescriptions((prev) => {
          const idx = prev.findIndex((p) => p.prescription_id === savedRx.prescription_id);
          if (idx === -1) return [savedRx, ...prev];
          const copy = [...prev];
          copy[idx] = savedRx;
          return copy;
        });
        if (auth.currentUser) {
          void syncPrescriptionToFirestore(savedRx);
        }
      }
      setStatusMessage(
        sendToMedical
          ? `Sent to Medical — prescription delivered to ${session.hospitalName} Medical desk.`
          : 'Consultation saved.'
      );
      return savedVisit;
    } catch (err) {
      console.error('Network error saving consultation:', err);
      setErrorMessage('Network error saving consultation. Please try again.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handlePrintOrDownloadPdf = async () => {
    if (!currentBooking) return;
    const saved = currentSavedVisit || (await saveConsultation(false));
    const now = new Date();
    const visitForPdf: HealthVisitRecord = saved || {
      id: `draft-${currentBooking.id}`,
      bookingId: currentBooking.id,
      tokenNumber: currentBooking.tokenNumber,
      patientUid: currentBooking.patientUid,
      patientPid: currentBooking.patientPid,
      patientName: currentBooking.patientName,
      patientAge: currentBooking.patientAge,
      patientGender: currentBooking.patientGender,
      hospitalId: session.hospitalId,
      hospitalName: hospital?.name || session.hospitalName,
      hospitalAddress: hospital?.address || '',
      city: hospital?.city || 'Nagpur',
      doctorId: session.staffId,
      doctorName: session.name,
      doctorQualification: session.qualification || 'MBBS',
      doctorRegNumber: session.registrationNumber || 'MMC-REG',
      doctorSpecialty: session.specialty || currentBooking.specialty,
      visitDate: now.toISOString().slice(0, 10),
      visitTime: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
      symptoms,
      diagnosis: diagnosis.trim() || 'OPD Consultation',
      notes,
      followUpDate: followUpDate || undefined,
      medicines: medicines.filter((m) => m.medicineName.trim()),
      consultationStatus: 'in_progress',
      medicalStatus: 'New',
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    };
    downloadPrescriptionPdf(visitForPdf);
  };

  const handlePatientLeft = async () => {
    if (!currentBooking) return;
    setErrorMessage(null);
    setSaving(true);
    try {
      const res = await fetch('/api/doctor/patient-left', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ bookingId: currentBooking.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Could not record consultation completion.');
        return;
      }
      if (data.visit) {
        setConsultations((prev) =>
          prev.map((v) => (v.id === data.visit.id ? data.visit : v))
        );
      }
      setStatusMessage(
        `Consultation finished for token #${currentBooking.tokenNumber}. Hospital Desk has been notified (queue unchanged).`
      );
    } catch {
      setErrorMessage('Network error marking patient left.');
    } finally {
      setSaving(false);
    }
  };

  const handleNextPatientOnScreen = () => {
    if (queue.length === 0) return;
    const idx = queue.findIndex((b) => b.id === selectedBookingId);
    const nextIdx = idx === -1 ? 0 : (idx + 1) % queue.length;
    setSelectedBookingId(queue[nextIdx].id);
  };

  return (
    <div className="space-y-4">
      {/* Doctor Header */}
      <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-[#1F5FA8]" aria-hidden="true" />
            <h1 className="text-lg sm:text-xl font-bold text-[#111827]">{session.name}</h1>
            <span className="text-xs font-semibold px-2 py-0.5 bg-[#EFF6FF] border border-[#BFDBFE] text-[#1F5FA8] rounded">
              {session.specialty || 'OPD Doctor'}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#4B5563] mt-0.5">
            {session.hospitalName} · {session.qualification || 'MBBS'} · Reg. No:{' '}
            <span className="font-medium text-[#111827]">{session.registrationNumber}</span>
          </p>
          <p className="text-xs text-[#6B7280] mt-1">
            Queue order and wait times are managed solely by the Hospital Desk. Actions here only update your consultation screen and medical prescriptions.
          </p>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#D1D5DB] text-[#374151] bg-white rounded hover:bg-[#F5F6F8] min-h-[38px]"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
          Doctor Logout
        </button>
      </div>

      {errorMessage && (
        <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs sm:text-sm rounded">
          {errorMessage}
        </div>
      )}
      {statusMessage && (
        <div className="p-3 bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D] text-xs sm:text-sm rounded flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{statusMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Sidebar: Read-only today's queue */}
        <aside className="lg:col-span-4 bg-white border border-[#E2E6EC] rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#111827]">
              Today&apos;s Queue ({queue.length})
            </h2>
            <span className="text-[11px] text-[#6B7280] bg-[#F5F6F8] border border-[#E2E6EC] px-2 py-0.5 rounded">
              Read-only
            </span>
          </div>

          {loadingWorkspace ? (
            <p className="text-xs text-[#6B7280]">Loading hospital queue...</p>
          ) : queue.length === 0 ? (
            <p className="text-xs text-[#6B7280]" data-testid="doctor-empty-queue">
              No patients in queue
            </p>
          ) : (
            <div className="space-y-2" data-testid="doctor-queue-list">
              {queue.map((item) => {
                const isSelected = item.id === currentBooking?.id;
                const savedConsult = consultations.find((c) => c.bookingId === item.id);
                const itemPid = item.PID || item.patientPid;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedBookingId(item.id)}
                    data-testid={`doctor-queue-item-${item.tokenNumber}`}
                    className={`w-full text-left p-3 rounded border transition-colors ${
                      isSelected
                        ? 'bg-[#EFF6FF] border-[#1F5FA8]'
                        : 'bg-white border-[#E2E6EC] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#1F5FA8] tabular-nums">
                        #{item.tokenNumber}
                      </span>
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                          itemPid
                            ? 'bg-white border-[#BFDBFE] text-[#1F5FA8]'
                            : 'bg-[#F3F4F6] border-[#D1D5DB] text-[#4B5563]'
                        }`}
                      >
                        {itemPid ? itemPid : 'Walk-in (no PID)'}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-[#111827] mt-1">
                      {item.patientName}
                    </div>
                    <div className="text-[11px] text-[#6B7280] mt-0.5 flex items-center justify-between">
                      <span>
                        {item.opd_id || item.specialty} · Pos #{item.queuePosition}
                      </span>
                      {savedConsult?.consultationStatus === 'finished' && (
                        <span className="text-[#15803D] font-semibold">Finished</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Main Panel: Current Patient + History + Consultation Form */}
        <section className="lg:col-span-8 space-y-4">
          {!currentBooking ? (
            <div className="bg-white border border-[#E2E6EC] rounded-md p-6 text-sm text-[#4B5563]">
              {queue.length === 0
                ? 'No patients in queue'
                : 'Select a patient from today’s queue to view their details and record a consultation.'}
            </div>
          ) : (
            <>
              {/* Current Patient Summary & Medical History */}
              <div
                className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-3"
                data-testid="doctor-current-patient-panel"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E6EC] pb-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                      Current Patient · Token #{currentBooking.tokenNumber} · {currentBooking.opd_id || currentBooking.specialty}
                    </div>
                    <h2 className="text-lg font-bold text-[#111827] mt-0.5">
                      {currentBooking.patientName}
                    </h2>
                    <p className="text-xs sm:text-sm text-[#4B5563] mt-0.5">
                      {currentBooking.patientAge} yrs · {currentBooking.patientGender} · Visit reason:{' '}
                      {currentBooking.reason}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {patientHistory?.isWalkIn || !(currentBooking.PID || currentBooking.patientPid) ? (
                      <span
                        data-testid="current-patient-pid-badge"
                        className="px-3 py-1.5 text-xs font-semibold bg-[#F3F4F6] border border-[#D1D5DB] text-[#374151] rounded"
                      >
                        Walk-in patient (no PID)
                      </span>
                    ) : (
                      <span
                        data-testid="current-patient-pid-badge"
                        className="px-3 py-1.5 text-xs font-bold bg-[#EFF6FF] border border-[#BFDBFE] text-[#1F5FA8] rounded tabular-nums"
                      >
                        {patientHistory?.pid || currentBooking.PID || currentBooking.patientPid}
                      </span>
                    )}

                    {(currentSharedRx?.dispensing_summary || currentSavedVisit?.dispensingSummary) && (
                      <span className="px-2.5 py-1 text-xs font-semibold bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D] rounded">
                        {currentSharedRx?.dispensing_summary || currentSavedVisit?.dispensingSummary}
                      </span>
                    )}
                    {currentSharedRx && !currentSharedRx.dispensing_summary && (
                      <span className="px-2.5 py-1 text-xs font-semibold bg-[#EFF6FF] border border-[#BFDBFE] text-[#1F5FA8] rounded">
                        Medical: {currentSharedRx.status}
                      </span>
                    )}
                  </div>
                </div>

                {/* History block */}
                {loadingHistory ? (
                  <p className="text-xs text-[#6B7280]">Checking consent &amp; loading medical history...</p>
                ) : patientHistory?.isWalkIn || !currentBooking.patientPid ? (
                  <div className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded text-xs text-[#4B5563]">
                    Walk-in patient (no PID) — no prior medical history available.
                  </div>
                ) : patientHistory && !patientHistory.consentGranted ? (
                  <div className="p-3 bg-[#FFFBEB] border border-[#FDE68A] rounded text-xs text-[#92400E] flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{patientHistory.message || 'Patient has disabled medical history sharing.'}</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold text-[#111827] flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-[#1F5FA8]" aria-hidden="true" />
                      Cross-Hospital Medical History (Newest First · {patientHistory?.history.length ?? 0} visits)
                    </div>
                    {patientHistory && patientHistory.history.length > 0 ? (
                      <div className="max-h-60 overflow-y-auto space-y-2 pr-1" data-testid="doctor-patient-history-list">
                        {patientHistory.history.map((hv) => (
                          <div
                            key={hv.id}
                            className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded text-xs space-y-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold text-[#111827]">
                                {hv.visitDate} · {hv.hospitalName} ({hv.city})
                              </span>
                              <span className="text-[#4B5563]">
                                {hv.doctorName} ({hv.doctorSpecialty})
                              </span>
                            </div>
                            <div className="text-[#111827]">
                              <span className="font-semibold">Diagnosis:</span> {hv.diagnosis}
                            </div>
                            {hv.medicines.length > 0 && (
                              <div className="text-[#374151]">
                                <span className="font-semibold">Medicines:</span>{' '}
                                {hv.medicines
                                  .map((m) => `${m.medicineName} (${m.strength}, ${m.when.join('/')}, ${m.durationDays}d)`)
                                  .join(' · ')}
                              </div>
                            )}
                            {hv.dispensingSummary && (
                              <div className="text-[#15803D] font-medium">
                                Pharmacy: {hv.dispensingSummary}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#6B7280]">No previous visits recorded for this PID yet.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Consultation & Prescription Form */}
              <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#111827]">
                    Consultation &amp; Prescription
                  </h3>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Load prescription template"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) handleApplyTemplate(e.target.value);
                        e.target.value = '';
                      }}
                      className="h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs text-[#111827]"
                    >
                      <option value="">Load Saved Template...</option>
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => setShowTemplateSave((prev) => !prev)}
                      className="inline-flex items-center gap-1 h-9 px-2.5 text-xs font-medium border border-[#D1D5DB] bg-white text-[#374151] rounded hover:bg-[#F5F6F8]"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
                      Save Template
                    </button>
                  </div>
                </div>

                {showTemplateSave && (
                  <div className="p-3 bg-[#F5F6F8] border border-[#E2E6EC] rounded flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={templateNameDraft}
                      onChange={(e) => setTemplateNameDraft(e.target.value)}
                      placeholder="Template name (e.g. Dry Eye Standard)"
                      className="flex-1 min-w-[200px] h-9 px-3 bg-white border border-[#D1D5DB] rounded text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleSaveTemplate}
                      className="h-9 px-3 bg-[#1F5FA8] text-white text-xs font-medium rounded hover:bg-[#184C87]"
                    >
                      Save Set
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="doc-symptoms" className="block text-xs font-medium text-[#374151] mb-1">
                      Symptoms
                    </label>
                    <textarea
                      id="doc-symptoms"
                      rows={2}
                      value={symptoms}
                      onChange={(e) => setSymptoms(e.target.value)}
                      placeholder="Presenting complaints & observations"
                      className="w-full p-2.5 border border-[#D1D5DB] rounded text-sm text-[#111827]"
                    />
                  </div>
                  <div>
                    <label htmlFor="doc-diagnosis" className="block text-xs font-medium text-[#374151] mb-1">
                      Diagnosis *
                    </label>
                    <textarea
                      id="doc-diagnosis"
                      rows={2}
                      value={diagnosis}
                      onChange={(e) => setDiagnosis(e.target.value)}
                      placeholder="Primary diagnosis"
                      className="w-full p-2.5 border border-[#D1D5DB] rounded text-sm text-[#111827]"
                    />
                  </div>
                  <div>
                    <label htmlFor="doc-notes" className="block text-xs font-medium text-[#374151] mb-1">
                      Clinical Notes / Advice
                    </label>
                    <input
                      id="doc-notes"
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Special precautions or instructions"
                      className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
                    />
                  </div>
                  <div>
                    <label htmlFor="doc-followup" className="block text-xs font-medium text-[#374151] mb-1">
                      Follow-up Date (Optional)
                    </label>
                    <input
                      id="doc-followup"
                      type="date"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                      className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
                    />
                  </div>
                </div>

                {/* Medicine Table */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#111827]">
                      Medicines Table ({medicines.length})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setMedicines((prev) => [...prev, createEmptyMedicineRow()])
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF]"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      Add Medicine Row
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {medicines.map((row, idx) => {
                      const queryText = row.medicineName.trim().toLowerCase();
                      const suggestions =
                        activeAutocompleteRowId === row.id && queryText.length >= 1
                          ? SEEDED_MEDICINES.filter((m) =>
                              m.name.toLowerCase().includes(queryText)
                            ).slice(0, 6)
                          : [];

                      return (
                        <div
                          key={row.id}
                          className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded space-y-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[#4B5563]">
                              Medicine #{idx + 1}
                            </span>
                            {medicines.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setMedicines((prev) => prev.filter((r) => r.id !== row.id))
                                }
                                className="inline-flex items-center gap-1 text-xs text-[#B91C1C] hover:underline"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                Remove
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                            {/* Medicine Name with Autocomplete */}
                            <div className="sm:col-span-5 relative">
                              <label className="block text-[11px] text-[#4B5563] mb-1">
                                Medicine Name
                              </label>
                              <input
                                type="text"
                                value={row.medicineName}
                                onFocus={() => setActiveAutocompleteRowId(row.id)}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setActiveAutocompleteRowId((curr) =>
                                      curr === row.id ? null : curr
                                    );
                                  }, 160);
                                }}
                                onChange={(e) => {
                                  setActiveAutocompleteRowId(row.id);
                                  handleUpdateMedicine(row.id, { medicineName: e.target.value });
                                }}
                                placeholder="Type to search seeded medicines..."
                                className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs text-[#111827]"
                              />
                              {suggestions.length > 0 && (
                                <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-[#D1D5DB] rounded shadow-md max-h-44 overflow-y-auto">
                                  {suggestions.map((opt) => (
                                    <button
                                      key={opt.name}
                                      type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleSelectSeededMedicine(row.id, opt);
                                      }}
                                      className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-[#EFF6FF] flex items-center justify-between gap-2 border-b border-[#F3F4F6] last:border-b-0"
                                    >
                                      <span className="font-medium text-[#111827]">{opt.name}</span>
                                      <span className="text-[11px] text-[#6B7280]">
                                        {opt.defaultStrength}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="sm:col-span-3">
                              <label className="block text-[11px] text-[#4B5563] mb-1">
                                Strength
                              </label>
                              <input
                                type="text"
                                value={row.strength}
                                onChange={(e) =>
                                  handleUpdateMedicine(row.id, { strength: e.target.value })
                                }
                                placeholder="e.g. 0.5% / 500mg"
                                className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs"
                              />
                            </div>

                            <div className="sm:col-span-2">
                              <label className="block text-[11px] text-[#4B5563] mb-1">
                                How Much
                              </label>
                              <input
                                type="text"
                                value={row.howMuch}
                                onChange={(e) =>
                                  handleUpdateMedicine(row.id, { howMuch: e.target.value })
                                }
                                placeholder="1 tab / 2 drops"
                                className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs"
                              />
                            </div>

                            <div className="sm:col-span-2">
                              <label className="block text-[11px] text-[#4B5563] mb-1">
                                Duration (days)
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={365}
                                value={row.durationDays}
                                onChange={(e) =>
                                  handleUpdateMedicine(row.id, {
                                    durationDays: Math.max(1, Number(e.target.value) || 1),
                                  })
                                }
                                className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs tabular-nums"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                            <div className="sm:col-span-6">
                              <span className="block text-[11px] text-[#4B5563] mb-1">
                                When (Schedule)
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {TIMING_OPTIONS.map((tOpt) => {
                                  const checked = row.when.includes(tOpt);
                                  return (
                                    <button
                                      key={tOpt}
                                      type="button"
                                      onClick={() => handleToggleWhen(row.id, tOpt)}
                                      className={`px-2.5 py-1 text-[11px] font-medium rounded border ${
                                        checked
                                          ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                                          : 'bg-white text-[#374151] border-[#D1D5DB]'
                                      }`}
                                    >
                                      {tOpt}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="sm:col-span-3">
                              <label className="block text-[11px] text-[#4B5563] mb-1">
                                Food Timing
                              </label>
                              <select
                                value={row.foodTiming}
                                onChange={(e) =>
                                  handleUpdateMedicine(row.id, {
                                    foodTiming: e.target.value as MealRelation,
                                  })
                                }
                                className="w-full h-9 px-2 bg-white border border-[#D1D5DB] rounded text-xs"
                              >
                                <option value="After food">After food</option>
                                <option value="Before food">Before food</option>
                              </select>
                            </div>

                            <div className="sm:col-span-3">
                              <label className="block text-[11px] text-[#4B5563] mb-1">
                                Total Quantity
                              </label>
                              <input
                                type="text"
                                value={row.totalQuantity}
                                onChange={(e) =>
                                  handleUpdateMedicine(row.id, { totalQuantity: e.target.value })
                                }
                                placeholder="e.g. 10 tablets / 1 bottle"
                                className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Doctor Action Buttons */}
                <div className="pt-2 border-t border-[#E2E6EC] flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveConsultation(true)}
                    data-testid="save-send-medical-btn"
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] min-h-[42px] disabled:opacity-60"
                  >
                    <Send className="w-4 h-4" aria-hidden="true" />
                    Save and Send to Medical
                  </button>

                  <button
                    type="button"
                    onClick={() => void handlePrintOrDownloadPdf()}
                    data-testid="doctor-download-pdf-btn"
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-medium border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF] min-h-[42px]"
                  >
                    <FileDown className="w-4 h-4" aria-hidden="true" />
                    Print / Download PDF
                  </button>

                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handlePatientLeft()}
                    data-testid="doctor-patient-left-btn"
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-medium border border-[#BBF7D0] text-[#15803D] bg-[#ECFDF5] rounded hover:bg-[#D1FAE5] min-h-[42px]"
                  >
                    <UserCheck className="w-4 h-4" aria-hidden="true" />
                    Patient Left
                  </button>

                  <button
                    type="button"
                    onClick={handleNextPatientOnScreen}
                    data-testid="doctor-next-patient-btn"
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-medium border border-[#D1D5DB] text-[#374151] bg-white rounded hover:bg-[#F5F6F8] min-h-[42px] ml-auto"
                  >
                    Next Patient
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
