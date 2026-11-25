import type {
  BestOptionSummary,
  Coordinates,
  HospitalRecord,
  QueueLevel,
  RankedHospital,
  SortOption,
  Specialty,
  TransportMode,
  TravelEstimate,
} from '../types/pinnacle';

export const NAGPUR_CENTER: Coordinates = {
  lat: 21.1458,
  lng: 79.0882,
};

export function haversineKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Number((R * c).toFixed(2));
}

export function estimateUrbanTravel(
  origin: Coordinates,
  destination: Coordinates,
  mode: TransportMode
): TravelEstimate {
  const straightKm = haversineKm(origin, destination);
  const roadKm = Math.max(0.4, Number((straightKm * 1.28).toFixed(1)));

  // Urban Nagpur daytime traffic speeds by mode
  const speedKmh = mode === 'bike' ? 28 : mode === 'car' ? 22 : 16;
  const boardingBuffer = mode === 'transit' ? 6 : 2;
  const travelMinutes = Math.max(
    3,
    Math.round((roadKm / speedKmh) * 60 + boardingBuffer)
  );

  return {
    distanceKm: roadKm,
    travelMinutes,
    source: 'estimated',
  };
}

export function calculateEstimatedWaitMinutes(hospital: HospitalRecord): {
  estimatedWaitMinutes: number;
  isEstimatedQueue: boolean;
} {
  if (!hospital.isLiveQueue) {
    return {
      estimatedWaitMinutes: Math.max(5, Math.round(hospital.historicalWaitMinutes || 20)),
      isEstimatedQueue: true,
    };
  }
  const activeDoctors = Math.max(1, hospital.activeCounters || 1);
  const raw = (hospital.patientsWaiting * hospital.avgConsultMinutes) / activeDoctors;
  return {
    estimatedWaitMinutes: Math.max(0, Math.round(raw)),
    isEstimatedQueue: false,
  };
}

/**
 * Core Pinnacle Total Time formula:
 * Total time = live travel time + max(0, estimated wait - travel time) + avg consultation time
 */
export function calculateTotalTimeMinutes(
  travelMinutes: number,
  estimatedWaitMinutes: number,
  avgConsultMinutes: number
): { waitAtArrivalMinutes: number; totalTimeMinutes: number } {
  const waitAtArrivalMinutes = Math.max(0, estimatedWaitMinutes - travelMinutes);
  const totalTimeMinutes = travelMinutes + waitAtArrivalMinutes + avgConsultMinutes;
  return {
    waitAtArrivalMinutes,
    totalTimeMinutes: Math.round(totalTimeMinutes),
  };
}

export function getQueueLevel(
  estimatedWaitMinutes: number,
  isPaused: boolean,
  openNow: boolean
): QueueLevel {
  if (isPaused || !openNow) return 'red';
  if (estimatedWaitMinutes <= 15) return 'green';
  if (estimatedWaitMinutes <= 30) return 'amber';
  return 'red';
}

import { parseSlotBoundaryMs } from './sponsorship';

function resolveNowMs(todayIsoOrNowMs?: string | number): number {
  if (typeof todayIsoOrNowMs === 'number') return todayIsoOrNowMs;
  if (!todayIsoOrNowMs) return Date.now();
  if (/^\d{4}-\d{2}-\d{2}$/.test(todayIsoOrNowMs)) {
    return Date.parse(`${todayIsoOrNowMs}T12:00:00.000Z`);
  }
  const parsed = Date.parse(todayIsoOrNowMs);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function isWindowActive(
  startDate: string | undefined,
  endDate: string | undefined,
  nowMs: number
): boolean {
  const startMs = parseSlotBoundaryMs(startDate, 'start');
  const endMs = parseSlotBoundaryMs(endDate, 'end');
  if (startMs !== null && nowMs < startMs) return false;
  if (endMs !== null && nowMs > endMs) return false;
  return true;
}

export function isSponsorshipActive(
  hospital: HospitalRecord,
  todayIsoOrNowMs: string | number = Date.now()
): boolean {
  const nowMs = resolveNowMs(todayIsoOrNowMs);
  if (hospital.sponsor_slots && Object.keys(hospital.sponsor_slots).length > 0) {
    return Object.values(hospital.sponsor_slots).some((slot) => {
      if (!slot) return false;
      return isWindowActive(slot.startDate, slot.endDate, nowMs);
    });
  }
  if (!hospital.is_sponsored) return false;
  return isWindowActive(hospital.sponsor_start_date, hospital.sponsor_end_date, nowMs);
}

export function getActiveSponsorRankForSpecialty(
  hospital: HospitalRecord,
  specialty: Specialty | 'All',
  todayIsoOrNowMs: string | number = Date.now()
): (1 | 2) | null {
  const nowMs = resolveNowMs(todayIsoOrNowMs);
  const slots = hospital.sponsor_slots;
  const hasPerSpecialtySlots = Boolean(slots && Object.keys(slots).length > 0);

  if (specialty !== 'All') {
    if (hasPerSpecialtySlots) {
      const slot = slots?.[specialty];
      if (!slot) return null;
      if (!isWindowActive(slot.startDate, slot.endDate, nowMs)) return null;
      return slot.rank;
    }
    if (!isSponsorshipActive(hospital, nowMs)) return null;
    return hospital.sponsor_rank ?? 1;
  }

  if (hasPerSpecialtySlots && slots) {
    const activeRanks = Object.values(slots)
      .filter((slot): slot is NonNullable<typeof slot> => {
        if (!slot) return false;
        return isWindowActive(slot.startDate, slot.endDate, nowMs);
      })
      .map((slot) => slot.rank)
      .sort((a, b) => a - b);
    return activeRanks[0] ?? null;
  }

  if (!isSponsorshipActive(hospital, nowMs)) return null;
  return hospital.sponsor_rank ?? 1;
}

export interface RankHospitalsOptions {
  hospitals: HospitalRecord[];
  specialty: Specialty | 'All';
  city: string;
  userLocation: Coordinates;
  transportMode: TransportMode;
  sortBy: SortOption;
  openNowOnly?: boolean;
  travelMatrixByHospitalId?: Record<string, TravelEstimate>;
  todayIso?: string;
  nowMs?: number;
}

export interface RankHospitalsResult {
  sponsored: RankedHospital[];
  organic: RankedHospital[];
  bestOption: BestOptionSummary | null;
}

export function rankHospitals(options: RankHospitalsOptions): RankHospitalsResult {
  const {
    hospitals,
    specialty,
    city,
    userLocation,
    transportMode,
    sortBy,
    openNowOnly = false,
    travelMatrixByHospitalId = {},
    todayIso,
    nowMs,
  } = options;

  const evalRef: string | number = typeof nowMs === 'number' ? nowMs : (todayIso ?? Date.now());
  const normalizedCity = city.trim().toLowerCase();

  const matching = hospitals.filter((h) => {
    if (h.status !== 'approved') return false;
    const cityMatches =
      !normalizedCity ||
      h.city.toLowerCase().includes(normalizedCity) ||
      h.area.toLowerCase().includes(normalizedCity) ||
      h.address.toLowerCase().includes(normalizedCity);
    const specialtyMatches =
      specialty === 'All' || h.specialties.includes(specialty);
    const openMatches = !openNowOnly || (h.openNow && !h.isPaused);
    return cityMatches && specialtyMatches && openMatches;
  });

  const enriched: RankedHospital[] = matching.map((hospital) => {
    const travel =
      travelMatrixByHospitalId[hospital.id] ??
      estimateUrbanTravel(userLocation, { lat: hospital.lat, lng: hospital.lng }, transportMode);
    const { estimatedWaitMinutes, isEstimatedQueue } = calculateEstimatedWaitMinutes(hospital);
    const { waitAtArrivalMinutes, totalTimeMinutes } = calculateTotalTimeMinutes(
      travel.travelMinutes,
      estimatedWaitMinutes,
      hospital.avgConsultMinutes
    );

    // Closed or paused facilities cannot be the top recommended instant-visit option
    const queueLevel = getQueueLevel(estimatedWaitMinutes, hospital.isPaused, hospital.openNow);

    return {
      hospital,
      distanceKm: travel.distanceKm,
      travelMinutes: travel.travelMinutes,
      travelSource: travel.source,
      estimatedWaitMinutes,
      waitAtArrivalMinutes,
      totalTimeMinutes,
      queueLevel,
      isEstimatedQueue,
      isSponsoredSlot: false,
    };
  });

  // 1. Pick up to 2 active Sponsored placements for the searched OPD specialty
  const sponsoredCandidates = enriched
    .map((item) => ({
      item,
      slotRank: getActiveSponsorRankForSpecialty(item.hospital, specialty, evalRef),
    }))
    .filter((entry): entry is { item: RankedHospital; slotRank: 1 | 2 } => entry.slotRank !== null)
    .sort((a, b) => a.slotRank - b.slotRank)
    .slice(0, 2)
    .map(({ item, slotRank }, idx) => ({
      ...item,
      isSponsoredSlot: true,
      sponsorRank: (slotRank ?? (idx + 1)) as 1 | 2,
    }));

  // 2. Organic ranking includes all matching hospitals ranked purely by merit (so Best Option is strictly organic)
  const comparator = (a: RankedHospital, b: RankedHospital): number => {
    // Keep open & non-paused OPDs ahead of closed/paused OPDs when sorting by time or queue
    if (sortBy === 'least_total_time' || sortBy === 'shortest_queue') {
      const aAvail = a.hospital.openNow && !a.hospital.isPaused ? 0 : 1;
      const bAvail = b.hospital.openNow && !b.hospital.isPaused ? 0 : 1;
      if (aAvail !== bAvail) return aAvail - bAvail;
    }

    switch (sortBy) {
      case 'nearest':
        return a.distanceKm - b.distanceKm;
      case 'shortest_queue':
        return a.estimatedWaitMinutes - b.estimatedWaitMinutes;
      case 'highest_rated':
        return b.hospital.googleRating - a.hospital.googleRating;
      case 'lowest_fee':
        return a.hospital.consultationFee - b.hospital.consultationFee;
      case 'least_total_time':
      default:
        return a.totalTimeMinutes - b.totalTimeMinutes;
    }
  };

  const organic = [...enriched].sort(comparator);

  // 3. Best Option banner is always computed from the organic least-total-time ranking
  const organicByLeastTime = [...enriched].sort((a, b) => {
    const aAvail = a.hospital.openNow && !a.hospital.isPaused ? 0 : 1;
    const bAvail = b.hospital.openNow && !b.hospital.isPaused ? 0 : 1;
    if (aAvail !== bAvail) return aAvail - bAvail;
    return a.totalTimeMinutes - b.totalTimeMinutes;
  });

  let bestOption: BestOptionSummary | null = null;
  if (organicByLeastTime.length > 0) {
    const top = organicByLeastTime[0];
    const second = organicByLeastTime[1];
    const savedMinutesVsNext = second
      ? Math.max(0, second.totalTimeMinutes - top.totalTimeMinutes)
      : 0;

    const explanation = second && savedMinutesVsNext > 0
      ? `Saves you ${savedMinutesVsNext} min vs. the next option: ${top.travelMinutes} min travel + ${top.waitAtArrivalMinutes} min wait at arrival`
      : `Fastest total time today: ${top.travelMinutes} min travel + ${top.waitAtArrivalMinutes} min wait at arrival`;

    bestOption = {
      hospitalId: top.hospital.id,
      hospitalName: top.hospital.name,
      totalTimeMinutes: top.totalTimeMinutes,
      travelMinutes: top.travelMinutes,
      waitAtArrivalMinutes: top.waitAtArrivalMinutes,
      consultMinutes: top.hospital.avgConsultMinutes,
      savedMinutesVsNext,
      explanation,
    };
  }

  return {
    sponsored: sponsoredCandidates,
    organic,
    bestOption,
  };
}

export interface DepartureAdvisory {
  patientsAhead: number;
  estimatedCallMinutes: number;
  leaveInMinutes: number;
  statusMessage: string;
  alertType: 'none' | 'faster' | 'delay';
  alertMessage: string | null;
}

export function calculateDepartureAdvisory(params: {
  queuePosition: number;
  avgConsultMinutes: number;
  activeCounters: number;
  travelMinutes: number;
  initialEstimatedWaitMinutes: number;
}): DepartureAdvisory {
  const patientsAhead = Math.max(0, params.queuePosition - 1);
  const counters = Math.max(1, params.activeCounters || 1);
  const estimatedCallMinutes = Math.round((patientsAhead * params.avgConsultMinutes) / counters);
  const arrivalBuffer = 5;
  const leaveInMinutes = Math.max(0, estimatedCallMinutes - params.travelMinutes - arrivalBuffer);

  const deltaFromInitial = estimatedCallMinutes - params.initialEstimatedWaitMinutes;
  let alertType: 'none' | 'faster' | 'delay' = 'none';
  let alertMessage: string | null = null;

  if (params.queuePosition <= 2 || (deltaFromInitial <= -8 && leaveInMinutes <= 5)) {
    alertType = 'faster';
    alertMessage = 'Queue moved faster, leave now to avoid missing your token.';
  } else if (deltaFromInitial >= 10) {
    alertType = 'delay';
    alertMessage = `Delay detected, you can leave ${deltaFromInitial} min later.`;
  }

  const statusMessage =
    leaveInMinutes === 0
      ? `You are #${params.queuePosition}, approx. ${estimatedCallMinutes} min. Leave now to arrive on time.`
      : `You are #${params.queuePosition}, approx. ${estimatedCallMinutes} min. Leave in ${leaveInMinutes} min to arrive on time.`;

  return {
    patientsAhead,
    estimatedCallMinutes,
    leaveInMinutes,
    statusMessage,
    alertType,
    alertMessage,
  };
}

export function formatSecondsAgo(lastUpdatedAt: number, nowMs: number = Date.now()): string {
  const sec = Math.max(1, Math.floor((nowMs - lastUpdatedAt) / 1000));
  if (sec < 60) return `Updated ${sec} sec ago`;
  const min = Math.floor(sec / 60);
  return `Updated ${min} min ago`;
}
