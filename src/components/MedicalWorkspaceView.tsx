import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  FileDown,
  LogOut,
  Pill,
  Search,
} from 'lucide-react';
import {
  auth,
  subscribeToHospitalPrescriptions,
  updatePrescriptionInFirestore,
} from '../lib/firebase';
import type {
  ActiveStaffSession,
  DispenseItemStatus,
  DispensingMedicineUpdate,
  DispensingRecord,
  HealthVisitRecord,
  HospitalRecord,
  SharedPrescriptionRecord,
} from '../types/pinnacle';
import { downloadPrescriptionPdf } from '../utils/prescriptionPdf';

interface MedicalWorkspaceViewProps {
  session: ActiveStaffSession;
  refreshSignal: number;
  onLogout: () => void;
}

function toVisitForPdf(
  rx: SharedPrescriptionRecord,
  hospital: HospitalRecord | null
): HealthVisitRecord {
  const dt = new Date(rx.created_at || Date.now());
  return {
    id: rx.visit_id || rx.prescription_id,
    bookingId: rx.booking_id,
    tokenNumber: rx.token_number,
    patientUid: rx.patient_id || `walkin-${rx.prescription_id}`,
    patientPid: rx.PID || undefined,
    patientName: rx.patient_name,
    patientAge: rx.patient_age || 30,
    patientGender: rx.patient_gender || 'Male',
    hospitalId: rx.hospital_id,
    hospitalName: rx.hospital_name || hospital?.name || 'Hospital',
    hospitalAddress: hospital?.address || '',
    city: hospital?.city || 'Nagpur',
    doctorId: rx.doctor_id,
    doctorName: rx.doctor_name,
    doctorQualification: rx.doctor_qualification || 'MBBS',
    doctorRegNumber: rx.doctor_reg_number || 'MMC-REG',
    doctorSpecialty: rx.opd_id,
    visitDate: dt.toISOString().slice(0, 10),
    visitTime: dt.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
    symptoms: rx.symptoms || '',
    diagnosis: rx.diagnosis,
    notes: rx.notes || '',
    followUpDate: rx.follow_up_date,
    medicines: rx.medicines.map((m) => ({
      id: m.id,
      medicineName: m.name,
      strength: m.strength,
      when: m.when,
      foodTiming: m.food_timing || 'After food',
      howMuch: m.how_much,
      durationDays: m.duration,
      totalQuantity: m.total_qty,
    })),
    consultationStatus: 'finished',
    medicalStatus: rx.status,
    dispensingSummary: rx.dispensing_summary,
    dispensingDetails: rx.dispensing_details,
    createdAt: rx.created_at,
    updatedAt: rx.updated_at,
  };
}

export function MedicalWorkspaceView({
  session,
  refreshSignal,
  onLogout,
}: MedicalWorkspaceViewProps) {
  const [subTab, setSubTab] = useState<'inbox' | 'history'>('inbox');
  const [hospital, setHospital] = useState<HospitalRecord | null>(null);
  const [prescriptions, setPrescriptions] = useState<SharedPrescriptionRecord[]>([]);
  const [dispensingHistory, setDispensingHistory] = useState<DispensingRecord[]>([]);
  const [selectedPrescriptionId, setSelectedPrescriptionId] = useState<string>('');
  const [draftItems, setDraftItems] = useState<DispensingMedicineUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // History filters
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyDate, setHistoryDate] = useState('');

  const fetchMedicalData = useCallback(async () => {
    try {
      const res = await fetch('/api/medical/prescriptions', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err.error || 'Unable to load hospital pharmacy inbox.';
        console.error('Medical prescriptions fetch failed:', res.status, msg);
        setError(msg);
        return;
      }
      const data = await res.json();
      setHospital(data.hospital || null);
      const list: SharedPrescriptionRecord[] = Array.isArray(data.prescriptions)
        ? data.prescriptions
        : [];
      setPrescriptions(list);
      setDispensingHistory(Array.isArray(data.dispensingHistory) ? data.dispensingHistory : []);
      setSelectedPrescriptionId((prev) => {
        if (prev && list.some((p) => p.prescription_id === prev)) return prev;
        return list[0]?.prescription_id || '';
      });
    } catch (err) {
      console.error('Network error loading pharmacy prescriptions:', err);
      setError('Network error loading pharmacy prescriptions.');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    void fetchMedicalData();
  }, [fetchMedicalData, refreshSignal]);

  // Also subscribe to Firestore hospital prescriptions in real time when signed into Firebase
  useEffect(() => {
    if (!auth.currentUser || !session.hospitalId) return;
    const unsub = subscribeToHospitalPrescriptions(
      session.hospitalId,
      (fsList) => {
        if (fsList.length > 0) {
          setPrescriptions((prev) => {
            const byId = new Map<string, SharedPrescriptionRecord>();
            for (const p of prev) byId.set(p.prescription_id, p);
            for (const p of fsList) byId.set(p.prescription_id, p);
            return Array.from(byId.values()).sort((a, b) => b.created_at - a.created_at);
          });
        }
      },
      (err) => {
        console.error('Medical Firestore listener error:', err);
      }
    );
    return () => unsub();
  }, [session.hospitalId]);

  const activePrescription = useMemo(
    () => prescriptions.find((p) => p.prescription_id === selectedPrescriptionId) ?? null,
    [prescriptions, selectedPrescriptionId]
  );

  // Initialize item-level dispensing controls when switching prescriptions
  useEffect(() => {
    if (!activePrescription) {
      setDraftItems([]);
      return;
    }
    const existing = activePrescription.dispensing_details;
    if (existing && existing.length > 0) {
      setDraftItems(existing.map((d) => ({ ...d })));
      return;
    }
    setDraftItems(
      activePrescription.medicines.map((m) => ({
        medicineItemId: m.id,
        medicineName: m.name,
        strength: m.strength,
        prescribedTotal: m.total_qty,
        status: 'Dispensed',
        quantityDispensed: m.total_qty,
        note: '',
      }))
    );
  }, [activePrescription?.prescription_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdateItem = (
    medicineItemId: string,
    patch: Partial<DispensingMedicineUpdate>
  ) => {
    setDraftItems((prev) =>
      prev.map((it) => (it.medicineItemId === medicineItemId ? { ...it, ...patch } : it))
    );
  };

  const handleSaveStatus = async (status: 'In progress' | 'Completed') => {
    if (!activePrescription) return;
    setError(null);
    setBanner(null);
    setSaving(true);
    try {
      const res = await fetch(
        `/api/medical/prescriptions/${encodeURIComponent(activePrescription.prescription_id)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            status,
            items: draftItems,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || 'Could not update prescription.';
        console.error('Medical prescription update failed:', res.status, msg);
        setError(msg);
        return;
      }
      const updatedRx = data.prescription as SharedPrescriptionRecord;
      setPrescriptions((prev) =>
        prev.map((p) => (p.prescription_id === updatedRx.prescription_id ? updatedRx : p))
      );
      if (Array.isArray(data.dispensingHistory)) {
        setDispensingHistory(data.dispensingHistory);
      }
      if (auth.currentUser) {
        void updatePrescriptionInFirestore(
          updatedRx.prescription_id,
          updatedRx.status,
          updatedRx.dispensing_summary,
          updatedRx.dispensing_details
        );
      }
      setBanner(
        status === 'Completed'
          ? `Dispensing completed for ${activePrescription.patient_name}. Status updated for doctor and patient.`
          : `Marked prescription for ${activePrescription.patient_name} as In progress.`
      );
    } catch (err) {
      console.error('Network error saving dispensing status:', err);
      setError('Network error saving dispensing status.');
    } finally {
      setSaving(false);
    }
  };

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    return dispensingHistory.filter((item) => {
      if (historyDate && item.date !== historyDate) return false;
      if (!q) return true;
      return (
        item.patientName.toLowerCase().includes(q) ||
        (item.patientPid || '').toLowerCase().includes(q) ||
        item.medicineName.toLowerCase().includes(q)
      );
    });
  }, [dispensingHistory, historyQuery, historyDate]);

  return (
    <div className="space-y-4">
      {/* Medical Header */}
      <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Pill className="w-5 h-5 text-[#1F5FA8]" aria-hidden="true" />
            <h1 className="text-lg sm:text-xl font-bold text-[#111827]">
              Medical &amp; Pharmacy Desk — {hospital?.name || session.hospitalName}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[#4B5563] mt-0.5">
            Signed in as <span className="font-semibold text-[#111827]">{session.name}</span> · Linked strictly to {session.hospitalName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex border border-[#D1D5DB] rounded overflow-hidden">
            <button
              type="button"
              onClick={() => setSubTab('inbox')}
              data-testid="medical-tab-inbox"
              className={`px-3.5 py-2 text-xs font-semibold ${
                subTab === 'inbox'
                  ? 'bg-[#1F5FA8] text-white'
                  : 'bg-white text-[#374151] hover:bg-[#F5F6F8]'
              }`}
            >
              Incoming Prescriptions ({prescriptions.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('history')}
              data-testid="medical-tab-history"
              className={`px-3.5 py-2 text-xs font-semibold border-l border-[#D1D5DB] ${
                subTab === 'history'
                  ? 'bg-[#1F5FA8] text-white'
                  : 'bg-white text-[#374151] hover:bg-[#F5F6F8]'
              }`}
            >
              Dispensing History ({dispensingHistory.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-[#D1D5DB] text-[#374151] bg-white rounded hover:bg-[#F5F6F8]"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            Medical Logout
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs sm:text-sm rounded">
          {error}
        </div>
      )}
      {banner && (
        <div className="p-3 bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D] text-xs sm:text-sm rounded flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{banner}</span>
        </div>
      )}

      {subTab === 'inbox' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Incoming Prescriptions List */}
          <aside className="lg:col-span-4 bg-white border border-[#E2E6EC] rounded-md p-4 space-y-2.5">
            <h2 className="text-sm font-semibold text-[#111827]">
              Incoming Prescriptions (Live)
            </h2>

            {loading ? (
              <p className="text-xs text-[#6B7280]">Loading prescriptions...</p>
            ) : prescriptions.length === 0 ? (
              <p className="text-xs text-[#6B7280]" data-testid="medical-empty-inbox">
                No prescriptions yet
              </p>
            ) : (
              <div className="space-y-2" data-testid="medical-prescriptions-list">
                {prescriptions.map((rx) => {
                  const active = rx.prescription_id === activePrescription?.prescription_id;
                  const badgeStyle =
                    rx.status === 'Completed'
                      ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                      : rx.status === 'In progress'
                        ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]'
                        : 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1F5FA8]';
                  const rxTime = new Date(rx.created_at).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  });
                  return (
                    <button
                      key={rx.prescription_id}
                      type="button"
                      onClick={() => {
                        setSelectedPrescriptionId(rx.prescription_id);
                        setBanner(null);
                      }}
                      data-testid={`medical-rx-item-${rx.prescription_id}`}
                      className={`w-full text-left p-3 rounded border transition-colors ${
                        active
                          ? 'bg-[#EFF6FF] border-[#1F5FA8]'
                          : 'bg-white border-[#E2E6EC] hover:bg-[#F9FAFB]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-[#111827]">{rx.patient_name}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${badgeStyle}`}>
                          {rx.status}
                        </span>
                      </div>
                      <div className="text-xs text-[#4B5563] mt-0.5 tabular-nums">
                        {rx.PID ? rx.PID : 'Walk-in (no PID)'} · {rx.opd_id}
                      </div>
                      <div className="text-[11px] text-[#6B7280] mt-1 flex justify-between">
                        <span>{rx.doctor_name}</span>
                        <span>{rxTime}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* Prescription Detail & Dispensing Controls */}
          <section className="lg:col-span-8 bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-4">
            {!activePrescription ? (
              <p className="text-sm text-[#4B5563]">
                {prescriptions.length === 0
                  ? 'No prescriptions yet'
                  : 'Select an incoming prescription to dispense medicines.'}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E6EC] pb-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-[#111827]">
                        {activePrescription.patient_name}
                      </h2>
                      <span className="text-xs font-semibold px-2 py-0.5 bg-[#F5F6F8] border border-[#E2E6EC] rounded tabular-nums">
                        {activePrescription.PID || 'Walk-in (no PID)'}
                      </span>
                    </div>
                    <p className="text-xs text-[#4B5563] mt-1">
                      Prescribed by <strong>{activePrescription.doctor_name}</strong> ({activePrescription.doctor_reg_number || 'MMC-REG'}) ·{' '}
                      {new Date(activePrescription.created_at).toLocaleString('en-IN')}
                    </p>
                    <p className="text-xs text-[#374151] mt-1">
                      Diagnosis: <strong>{activePrescription.diagnosis}</strong>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => downloadPrescriptionPdf(toVisitForPdf(activePrescription, hospital))}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF]"
                  >
                    <FileDown className="w-4 h-4" aria-hidden="true" />
                    Download PDF
                  </button>
                </div>

                {/* Medicine Dispensing Table */}
                <div className="space-y-3">
                  {activePrescription.medicines.map((med, idx) => {
                    const draft = draftItems.find((d) => d.medicineItemId === med.id) || {
                      medicineItemId: med.id,
                      medicineName: med.name,
                      strength: med.strength,
                      prescribedTotal: med.total_qty,
                      status: 'Dispensed' as DispenseItemStatus,
                      quantityDispensed: med.total_qty,
                      note: '',
                    };
                    return (
                      <div
                        key={med.id}
                        className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-[#111827]">
                              {idx + 1}. {med.name}{' '}
                              <span className="text-xs font-normal text-[#4B5563]">
                                ({med.strength})
                              </span>
                            </div>
                            <div className="text-xs text-[#4B5563]">
                              Dose: {med.how_much} · {med.when.join(', ')} ({med.food_timing || 'After food'}) ·{' '}
                              {med.duration} days · Prescribed Qty: <strong>{med.total_qty}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                          <div className="sm:col-span-4">
                            <label className="block text-[11px] text-[#4B5563] mb-1">
                              Dispense Action
                            </label>
                            <select
                              value={draft.status}
                              onChange={(e) =>
                                handleUpdateItem(med.id, {
                                  status: e.target.value as DispenseItemStatus,
                                  quantityDispensed:
                                    e.target.value === 'Out of stock'
                                      ? '0'
                                      : draft.quantityDispensed || med.total_qty,
                                })
                              }
                              data-testid={`dispense-status-${idx}`}
                              className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs font-medium"
                            >
                              <option value="Dispensed">Dispensed</option>
                              <option value="Out of stock">Out of stock</option>
                              <option value="Substituted">Substituted</option>
                            </select>
                          </div>

                          <div className="sm:col-span-3">
                            <label className="block text-[11px] text-[#4B5563] mb-1">
                              Quantity Given
                            </label>
                            <input
                              type="text"
                              value={draft.quantityDispensed}
                              disabled={draft.status === 'Out of stock'}
                              onChange={(e) =>
                                handleUpdateItem(med.id, { quantityDispensed: e.target.value })
                              }
                              className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs disabled:bg-[#F3F4F6]"
                            />
                          </div>

                          <div className="sm:col-span-5">
                            <label className="block text-[11px] text-[#4B5563] mb-1">
                              {draft.status === 'Substituted'
                                ? 'Substitute Brand / Note'
                                : 'Pharmacy Note (Optional)'}
                            </label>
                            <input
                              type="text"
                              value={draft.note || ''}
                              onChange={(e) =>
                                handleUpdateItem(med.id, { note: e.target.value })
                              }
                              placeholder={
                                draft.status === 'Substituted'
                                  ? 'Enter substitute generic/brand name'
                                  : 'Batch or instruction note'
                              }
                              className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-[#E2E6EC] flex flex-wrap gap-2.5">
                  {activePrescription.status === 'New' && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleSaveStatus('In progress')}
                      className="px-4 py-2.5 text-xs sm:text-sm font-medium border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF] min-h-[42px]"
                    >
                      Mark In Progress
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSaveStatus('Completed')}
                    data-testid="medical-complete-btn"
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs sm:text-sm font-semibold bg-[#15803D] text-white rounded hover:bg-[#166534] min-h-[42px] disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    Complete
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : (
        /* Dispensing History Sub-page */
        <section
          className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-4"
          data-testid="dispensing-history-view"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-[#1F5FA8]" aria-hidden="true" />
              Dispensing History ({filteredHistory.length})
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-[#6B7280] absolute left-2.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={historyQuery}
                  onChange={(e) => setHistoryQuery(e.target.value)}
                  placeholder="Search patient name, PID, or medicine"
                  data-testid="dispensing-history-search"
                  className="h-9 pl-8 pr-3 border border-[#D1D5DB] rounded text-xs w-64"
                />
              </div>
              <input
                type="date"
                value={historyDate}
                onChange={(e) => setHistoryDate(e.target.value)}
                aria-label="Filter dispensing history by date"
                className="h-9 px-2.5 border border-[#D1D5DB] rounded text-xs"
              />
              {historyDate && (
                <button
                  type="button"
                  onClick={() => setHistoryDate('')}
                  className="h-9 px-2.5 text-xs border border-[#D1D5DB] rounded text-[#374151] hover:bg-[#F5F6F8]"
                >
                  Clear date
                </button>
              )}
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <p className="text-xs text-[#6B7280]">No dispensing records match the current filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-[#E2E6EC] text-[#6B7280] text-xs">
                    <th className="py-2 pr-3 font-medium">Date &amp; Time</th>
                    <th className="py-2 pr-3 font-medium">Patient / PID</th>
                    <th className="py-2 pr-3 font-medium">Medicine</th>
                    <th className="py-2 pr-3 font-medium">Qty Given</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Staff</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((rec) => (
                    <tr key={rec.id} className="border-b border-[#F3F4F6]">
                      <td className="py-2.5 pr-3 text-xs text-[#4B5563] tabular-nums">
                        {rec.date} ·{' '}
                        {new Date(rec.dispensedAt).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-[#111827]">{rec.patientName}</div>
                        <div className="text-xs text-[#4B5563] tabular-nums">
                          {rec.patientPid || 'Walk-in'}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-[#111827]">{rec.medicineName}</div>
                        {rec.strength && (
                          <div className="text-xs text-[#6B7280]">{rec.strength}</div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs font-medium text-[#111827]">
                        {rec.quantityDispensed}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                            rec.status === 'Dispensed'
                              ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                              : rec.status === 'Substituted'
                                ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]'
                                : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                          }`}
                        >
                          {rec.status}
                        </span>
                        {rec.note && (
                          <div className="text-[11px] text-[#6B7280] mt-0.5">{rec.note}</div>
                        )}
                      </td>
                      <td className="py-2.5 text-xs text-[#4B5563]">{rec.staffName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
