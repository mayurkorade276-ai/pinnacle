import { useState } from 'react';
import { Phone, Navigation, Star, Clock, MapPin, Users } from 'lucide-react';
import type { Language, RankedHospital, TransportMode } from '../types/pinnacle';
import { formatSecondsAgo } from '../utils/ranking';
import { buildGoogleMapsDirectionsUrl } from '../utils/calendarAndShare';
import { t } from '../utils/i18n';

interface HospitalCardProps {
  item: RankedHospital;
  transportMode: TransportMode;
  language: Language;
  onBook: (item: RankedHospital) => void;
  nowMs: number;
}

export function HospitalCard({
  item,
  transportMode,
  language,
  onBook,
  nowMs,
}: HospitalCardProps) {
  const { hospital } = item;
  const [imgError, setImgError] = useState(false);
  const [showReviews, setShowReviews] = useState(false);

  const modeLabel =
    transportMode === 'car'
      ? 'Car'
      : transportMode === 'bike'
        ? 'Bike'
        : 'Public transport';

  const queueColorStyles =
    item.queueLevel === 'green'
      ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
      : item.queueLevel === 'amber'
        ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]'
        : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]';

  const queueStatusText = hospital.isPaused
    ? 'OPD Paused'
    : !hospital.openNow
      ? 'Closed now'
      : item.queueLevel === 'green'
        ? 'Short queue'
        : item.queueLevel === 'amber'
          ? 'Moderate queue'
          : 'Busy queue';

  return (
    <article
      className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 transition-colors hover:border-[#CBD5E1]"
      data-testid={`hospital-card-${hospital.id}`}
    >
      <div className="flex flex-col md:flex-row gap-4">
        {/* Hospital Photo */}
        <div className="w-full md:w-44 h-36 md:h-36 shrink-0 rounded bg-[#F5F6F8] border border-[#E2E6EC] overflow-hidden flex items-center justify-center">
          {!imgError && hospital.photoUrl ? (
            <img
              src={hospital.photoUrl}
              alt={`${hospital.name} exterior`}
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-center px-3">
              <p className="text-xs font-semibold text-[#4B5563]">{hospital.type}</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">{hospital.area}</p>
            </div>
          )}
        </div>

        {/* Main Details */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base sm:text-lg font-semibold text-[#111827] leading-snug">
                  {hospital.name}
                </h3>
                {item.isSponsoredSlot && (
                  <span className="text-xs font-medium text-[#4B5563] bg-[#F9FAFB] border border-[#D1D5DB] rounded px-2 py-0.5">
                    {t(language, 'sponsoredBadge')}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-[#4B5563] mt-0.5">
                {hospital.specialties.join(' · ')} · {hospital.type}
              </p>
              <p className="text-xs text-[#6B7280] mt-1 flex items-start gap-1">
                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#6B7280]" aria-hidden="true" />
                <span>{hospital.address}</span>
              </p>
            </div>

            {/* Total Time Summary Box */}
            <div className="text-left md:text-right shrink-0 bg-[#F5F6F8] border border-[#E2E6EC] rounded px-3 py-2">
              <div className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide">
                {t(language, 'totalTime')}
              </div>
              <div className="text-xl font-bold text-[#1F5FA8] tabular-nums">
                {item.totalTimeMinutes} min
              </div>
              <div className="text-[11px] text-[#4B5563] tabular-nums">
                {item.travelMinutes}m travel + {item.waitAtArrivalMinutes}m wait + {hospital.avgConsultMinutes}m consult
              </div>
            </div>
          </div>

          {/* Metrics Grid: Queue + Travel + Fee/Timings + Rating */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3">
            {/* Live Queue Status */}
            <div className={`border rounded px-3 py-2 ${queueColorStyles}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  {queueStatusText}
                </span>
                <span className="text-[11px] font-medium border border-current/25 rounded px-1.5 py-0.5">
                  {item.isEstimatedQueue
                    ? t(language, 'estimatedBadge')
                    : t(language, 'liveQueueBadge')}
                </span>
              </div>
              <div className="text-sm font-semibold mt-1 tabular-nums">
                {hospital.patientsWaiting} {t(language, 'patientsWaiting')} · ~{item.estimatedWaitMinutes} min {t(language, 'estimatedWait')}
              </div>
              <div className="text-[11px] opacity-85 mt-0.5">
                {formatSecondsAgo(hospital.lastUpdatedAt, nowMs)} · {hospital.activeCounters} active desk{hospital.activeCounters > 1 ? 's' : ''}
              </div>
            </div>

            {/* Distance & Live Traffic Travel */}
            <div className="border border-[#E2E6EC] bg-[#FFFFFF] rounded px-3 py-2">
              <div className="text-xs font-medium text-[#6B7280] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                Travel ({modeLabel})
              </div>
              <div className="text-sm font-semibold text-[#111827] mt-1 tabular-nums">
                {item.distanceKm} km · {item.travelMinutes} min
              </div>
              <div className="text-[11px] text-[#6B7280] mt-0.5">
                {item.travelSource === 'routes_api' ? 'Live traffic via Google Routes' : 'Nagpur traffic estimate'}
              </div>
            </div>

            {/* Fee, Timings & Google Rating */}
            <div className="border border-[#E2E6EC] bg-[#FFFFFF] rounded px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#111827] tabular-nums">
                  Fee: ₹{hospital.consultationFee}
                </span>
                <span
                  className={`text-xs font-medium ${
                    hospital.openNow ? 'text-[#15803D]' : 'text-[#B91C1C]'
                  }`}
                >
                  {hospital.openNow ? 'Open now' : 'Closed'}
                </span>
              </div>
              <div className="text-xs text-[#4B5563] mt-1">
                {hospital.opdDays} · {hospital.opdTimings}
              </div>
              <div className="flex items-center gap-1 mt-1 text-xs text-[#111827]">
                <Star className="w-3.5 h-3.5 text-[#D97706] fill-[#D97706]" aria-hidden="true" />
                <span className="font-semibold tabular-nums">{hospital.googleRating.toFixed(1)}</span>
                <span className="text-[#6B7280] tabular-nums">
                  ({hospital.reviewCount} Google reviews)
                </span>
              </div>
            </div>
          </div>

          {/* Doctors preview + Reviews toggle */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#4B5563]">
            <div>
              {hospital.doctors.length > 0 ? (
                <span>
                  Doctors: {hospital.doctors.map((d) => `${d.name} (${d.qualification})`).join(', ')}
                </span>
              ) : (
                <span>OPD Duty Specialists available</span>
              )}
            </div>
            {hospital.recentReviews.length > 0 && (
              <button
                type="button"
                onClick={() => setShowReviews((prev) => !prev)}
                className="text-[#1F5FA8] font-medium hover:underline"
              >
                {showReviews
                  ? 'Hide Google reviews'
                  : `View ${Math.min(3, hospital.recentReviews.length)} recent reviews`}
              </button>
            )}
          </div>

          {/* Top 2-3 Google Reviews with Author Attribution */}
          {showReviews && hospital.recentReviews.length > 0 && (
            <div className="mt-3 border-t border-[#E2E6EC] pt-3 space-y-2">
              {hospital.recentReviews.slice(0, 3).map((rev, idx) => (
                <div key={idx} className="text-xs bg-[#F9FAFB] border border-[#E2E6EC] rounded p-2.5">
                  <div className="flex items-center justify-between text-[#111827] font-medium">
                    <span>
                      {rev.authorUri ? (
                        <a
                          href={rev.authorUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#1F5FA8] hover:underline"
                        >
                          {rev.authorName}
                        </a>
                      ) : (
                        rev.authorName
                      )}{' '}
                      <span className="text-[#6B7280] font-normal">· Google Review</span>
                    </span>
                    <span className="text-[#6B7280] tabular-nums">
                      {rev.rating}/5 · {rev.relativeTime}
                    </span>
                  </div>
                  <p className="text-[#374151] mt-1">{rev.text}</p>
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onBook(item)}
              className="px-4 py-2.5 text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] min-h-[44px] whitespace-nowrap"
            >
              {t(language, 'bookAppointment')}
            </button>
            <a
              href={buildGoogleMapsDirectionsUrl(hospital.lat, hospital.lng, hospital.name)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border border-[#D1D5DB] text-[#374151] bg-white rounded hover:bg-[#F5F6F8] min-h-[44px] whitespace-nowrap"
            >
              <Navigation className="w-4 h-4" aria-hidden="true" />
              {t(language, 'getDirections')}
            </a>
            <a
              href={`tel:${hospital.deskPhone.replace(/\s+/g, '')}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border border-[#D1D5DB] text-[#374151] bg-white rounded hover:bg-[#F5F6F8] min-h-[44px] whitespace-nowrap"
            >
              <Phone className="w-4 h-4" aria-hidden="true" />
              {t(language, 'callHospital')}
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
