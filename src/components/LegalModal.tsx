import { X } from 'lucide-react';

interface LegalModalProps {
  docType: 'privacy' | 'terms';
  onClose: () => void;
}

export function LegalModal({ docType, onClose }: LegalModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
    >
      <div className="bg-white border border-[#E2E6EC] rounded-md w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-[#E2E6EC] pb-3">
          <h2 id="legal-modal-title" className="text-base font-semibold text-[#111827]">
            {docType === 'privacy' ? 'Pinnacle Privacy Policy' : 'Pinnacle Terms of Service'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center border border-[#E2E6EC] rounded text-[#4B5563]"
            aria-label="Close legal document"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {docType === 'privacy' ? (
          <div className="text-xs sm:text-sm text-[#374151] space-y-2.5 leading-relaxed">
            <p>
              <strong>Minimal Data Collection:</strong> Pinnacle collects only the details required to issue your OPD token and coordinate live queue updates (Full Name, Mobile Number, Age, Gender, Email, and optional visit reason).
            </p>
            <p>
              <strong>Location Consent:</strong> Your device location is requested solely with your explicit permission to compute traffic-aware travel time to Nagpur OPDs. You can revoke location access at any time in browser settings.
            </p>
            <p>
              <strong>Security &amp; Isolation:</strong> Patient PII and hospital contact credentials are isolated in access-controlled storage and are shared only with the hospital you choose to book with.
            </p>
            <p>
              <strong>Google Maps Privacy:</strong> Map views, place ratings, and routing features are powered by Google Maps Platform and are subject to the{' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1F5FA8] underline"
              >
                Google Privacy Policy
              </a>
              .
            </p>
          </div>
        ) : (
          <div className="text-xs sm:text-sm text-[#374151] space-y-2.5 leading-relaxed">
            <p>
              <strong>Not for Medical Emergencies:</strong> Pinnacle is an outpatient appointment and queue-tracking directory. In any medical emergency, call <strong>108 / 112</strong> or go to the nearest emergency room immediately.
            </p>
            <p>
              <strong>Estimated Queue &amp; Travel Times:</strong> Wait times depend on active hospital counters and consultation duration. Travel times use traffic estimates and may vary due to road conditions.
            </p>
            <p>
              <strong>Sponsored Listings Disclosure:</strong> Sponsored placements are paid listings clearly marked &ldquo;Sponsored&rdquo;. The &ldquo;Best Option for You&rdquo; banner is strictly determined by organic least total time ranking.
            </p>
            <p>
              <strong>Google Maps Terms:</strong> Use of interactive map features is subject to the{' '}
              <a
                href="https://maps.google.com/help/terms_maps/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1F5FA8] underline"
              >
                Google Maps / Google Earth Additional Terms of Service
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
