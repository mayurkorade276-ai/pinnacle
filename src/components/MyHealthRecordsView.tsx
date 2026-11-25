import { useState } from 'react';
import {
  CheckCircle2,
  Eye,
  FileDown,
  FileText,
  MapPin,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import type { HealthVisitRecord, RecordAuditLogEntry } from '../types/pinnacle';
import { downloadPrescriptionPdf } from '../utils/prescriptionPdf';

interface MyHealthRecordsViewProps {
  pid: string;
  historyConsent: boolean;
  visits: HealthVisitRecord[];
  auditLogs: RecordAuditLogEntry[];
  onGoToProfile: () => void;
}

export function MyHealthRecordsView({
  pid,
  historyConsent,
  visits,
  auditLogs,
  onGoToProfile,
}: MyHealthRecordsViewProps) {
  const [cityFilter, setCityFilter] = useState<string>('All');

  const cities = Array.from(new Set(visits.map((v) => v.city).filter(Boolean)));
  const filteredVisits =
    cityFilter === 'All' ? visits : visits.filter((v) => v.city === cityFilter);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header & Permanent Health ID summary */}
      <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#111827] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#1F5FA8]" aria-hidden="true" />
            My Health Records
          </h1>
          <p className="text-sm text-[#4B5563] mt-0.5">
            Chronological timeline of all OPD visits, diagnoses, and prescriptions across hospitals and cities.
          </p>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-1.5">
          <div className="px-3 py-1.5 bg-[#EFF6FF] border border-[#BFDBFE] rounded text-xs font-bold text-[#1F5FA8] tabular-nums">
            Health ID: {pid}
          </div>
          <button
            type="button"
            onClick={onGoToProfile}
            className={`inline-flex items-center gap-1 text-xs font-medium hover:underline ${
              historyConsent ? 'text-[#15803D]' : 'text-[#B45309]'
            }`}
          >
            {historyConsent ? (
              <>
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Doctor history sharing is ON (Manage in Profile)
              </>
            ) : (
              <>
                <ShieldOff className="w-3.5 h-3.5" aria-hidden="true" />
                Doctor history sharing is OFF (Manage in Profile)
              </>
            )}
          </button>
        </div>
      </div>

      {/* City filter bar when patient has multi-city visits */}
      {cities.length > 1 && (
        <div className="bg-white border border-[#E2E6EC] rounded-md px-4 py-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[#4B5563] mr-1">Filter by city:</span>
          <button
            type="button"
            onClick={() => setCityFilter('All')}
            className={`px-3 py-1.5 text-xs font-medium rounded border ${
              cityFilter === 'All'
                ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                : 'bg-white text-[#374151] border-[#D1D5DB] hover:bg-[#F5F6F8]'
            }`}
          >
            All Cities ({visits.length})
          </button>
          {cities.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCityFilter(c)}
              className={`px-3 py-1.5 text-xs font-medium rounded border ${
                cityFilter === c
                  ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                  : 'bg-white text-[#374151] border-[#D1D5DB] hover:bg-[#F5F6F8]'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Visits Timeline */}
      {filteredVisits.length === 0 ? (
        <div className="bg-white border border-[#E2E6EC] rounded-md p-6 text-center text-sm text-[#4B5563]">
          No OPD visit records or prescriptions found yet.
        </div>
      ) : (
        <div className="space-y-4" data-testid="health-records-timeline">
          {filteredVisits.map((visit) => (
            <article
              key={visit.id}
              data-testid={`health-visit-${visit.id}`}
              className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E6EC] pb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#4B5563]">
                    <span className="font-semibold text-[#111827] tabular-nums">
                      {visit.visitDate} · {visit.visitTime}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#F5F6F8] border border-[#E2E6EC] rounded text-[#374151]">
                      <MapPin className="w-3 h-3 text-[#1F5FA8]" aria-hidden="true" />
                      {visit.city}
                    </span>
                    {visit.dispensingSummary && (
                      <span
                        data-testid={`visit-dispense-status-${visit.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D] font-medium rounded"
                      >
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        {visit.dispensingSummary}
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-bold text-[#111827] mt-1">{visit.hospitalName}</h2>
                  <p className="text-xs text-[#4B5563]">
                    {visit.doctorName} ({visit.doctorSpecialty}) · {visit.hospitalAddress}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => downloadPrescriptionPdf(visit)}
                  data-testid={`download-pdf-${visit.id}`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF] min-h-[38px]"
                >
                  <FileDown className="w-4 h-4" aria-hidden="true" />
                  Download prescription PDF
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded">
                  <div className="text-xs font-semibold text-[#4B5563] uppercase tracking-wide">
                    Diagnosis
                  </div>
                  <div className="font-semibold text-[#111827] mt-0.5">{visit.diagnosis}</div>
                  {visit.notes && (
                    <p className="text-xs text-[#4B5563] mt-1">{visit.notes}</p>
                  )}
                </div>

                <div className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded">
                  <div className="text-xs font-semibold text-[#4B5563] uppercase tracking-wide">
                    Prescribed Medicines ({visit.medicines.length})
                  </div>
                  {visit.medicines.length === 0 ? (
                    <p className="text-xs text-[#6B7280] mt-1">No medicines prescribed.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-xs text-[#111827]">
                      {visit.medicines.map((med) => (
                        <li key={med.id} className="flex flex-wrap justify-between gap-1">
                          <span className="font-medium">
                            {med.medicineName} ({med.strength})
                          </span>
                          <span className="text-[#4B5563]">
                            {med.howMuch} · {med.when.join('/')} · {med.durationDays}d
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Who Viewed My Records Audit Log */}
      <section
        className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-3"
        data-testid="audit-log-section"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-2">
            <Eye className="w-4 h-4 text-[#1F5FA8]" aria-hidden="true" />
            Who viewed my records ({auditLogs.length})
          </h2>
          <span className="text-xs text-[#6B7280]">Every doctor history view is logged</span>
        </div>

        {auditLogs.length === 0 ? (
          <p className="text-xs text-[#6B7280]">
            No doctors have viewed your medical history yet.
          </p>
        ) : (
          <div className="divide-y divide-[#E2E6EC]">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
              >
                <div>
                  <span className="font-semibold text-[#111827]">{log.viewerName}</span>
                  {log.viewerSpecialty && (
                    <span className="text-[#4B5563]"> ({log.viewerSpecialty})</span>
                  )}{' '}
                  · <span className="text-[#374151]">{log.hospitalName}</span>
                  <div className="text-[#6B7280]">{log.action}</div>
                </div>
                <div className="text-[#6B7280] tabular-nums shrink-0">
                  {new Date(log.viewedAt).toLocaleString('en-IN')}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
