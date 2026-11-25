import type { Specialty } from '../types/pinnacle';

export function makeSlotKey(city: string, specialty: Specialty | string, rank: 1 | 2): string {
  const cleanCity = city
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const cleanSpec = specialty
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${cleanCity || 'city'}__${cleanSpec || 'opd'}__rank_${rank}`;
}

export function normalizeCardDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function validateLuhnCard(rawCard: string): boolean {
  const digits = normalizeCardDigits(rawCard);
  if (digits.length !== 16) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = parseInt(digits[i], 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function cardEndsIn0000(rawCard: string): boolean {
  const digits = normalizeCardDigits(rawCard);
  return digits.length === 16 && digits.endsWith('0000');
}

export function validateCardExpiry(mmYy: string, now: Date = new Date()): boolean {
  const match = mmYy.trim().match(/^(\d{2})\/(\d{2})$/);
  if (!match) return false;
  const month = parseInt(match[1], 10);
  const year2 = parseInt(match[2], 10);
  if (month < 1 || month > 12) return false;

  const fullYear = 2000 + year2;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (fullYear > currentYear) return true;
  if (fullYear === currentYear && month >= currentMonth) return true;
  return false;
}

export function validateCvv(cvv: string): boolean {
  return /^\d{3}$/.test(cvv.trim());
}

export function validateUpiId(upi: string): boolean {
  return /^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/.test(upi.trim());
}

export function evaluateMockUpi(upi: string): { ok: boolean; reason?: string } {
  const normalized = upi.trim().toLowerCase();
  if (!validateUpiId(normalized)) {
    return { ok: false, reason: 'Enter a valid UPI ID (e.g. success@demo).' };
  }
  if (normalized === 'success@demo' || normalized === 'success@razorpay') {
    return { ok: true };
  }
  if (normalized === 'failure@demo' || normalized === 'failure@razorpay') {
    return { ok: false, reason: 'UPI payment declined by bank (test failure).' };
  }
  return {
    ok: false,
    reason: 'Use success@demo (or success@razorpay) to succeed, or failure@demo to test failure.',
  };
}

export function evaluateMockCard(params: {
  cardNumber: string;
  expiry: string;
  cvv: string;
  now?: Date;
}): { ok: boolean; reason?: string } {
  const digits = normalizeCardDigits(params.cardNumber);
  if (digits.length !== 16 || !validateLuhnCard(digits)) {
    return { ok: false, reason: 'Enter a valid 16-digit card number.' };
  }
  if (!validateCardExpiry(params.expiry, params.now)) {
    return { ok: false, reason: 'Card expiry must be a valid future MM/YY date.' };
  }
  if (!validateCvv(params.cvv)) {
    return { ok: false, reason: 'Enter a valid 3-digit CVV.' };
  }
  if (cardEndsIn0000(digits)) {
    return { ok: false, reason: 'Payment declined, try again' };
  }
  return { ok: true };
}

export function parseSlotBoundaryMs(
  value: string | undefined,
  boundary: 'start' | 'end'
): number | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const suffix = boundary === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z';
    const parsed = Date.parse(`${trimmed}${suffix}`);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatShortClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatRemainingDuration(endMs: number, nowMs: number = Date.now()): string {
  const diffMs = Math.max(0, endMs - nowMs);
  const totalMin = Math.ceil(diffMs / 60_000);
  if (totalMin < 60) {
    return `${Math.max(1, totalMin)} min left`;
  }
  const hours = Math.floor(totalMin / 60);
  if (hours < 24) {
    const remMin = totalMin % 60;
    return remMin > 0 ? `${hours}h ${remMin}m left` : `${hours}h left`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h left` : `${days}d left`;
}

export function formatOccupiedUntil(endMs: number, nowMs: number = Date.now()): string {
  return `Occupied until ${formatShortClock(endMs)} (${formatRemainingDuration(endMs, nowMs)})`;
}

export function formatSponsoredUntil(endMs: number, nowMs: number = Date.now()): string {
  return `Sponsored until ${formatShortClock(endMs)} (${formatRemainingDuration(endMs, nowMs)})`;
}

export function formatDurationLabel(durationMinutes: number): string {
  if (durationMinutes >= 1440 && durationMinutes % 1440 === 0) {
    const days = durationMinutes / 1440;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (durationMinutes >= 60 && durationMinutes % 60 === 0) {
    const hrs = durationMinutes / 60;
    return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'}`;
  }
  return `${durationMinutes} min`;
}
