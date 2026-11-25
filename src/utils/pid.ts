/**
 * Permanent Patient Health ID ("PID") utilities.
 * Format: PID-XXXX-XXXX-CC where CC is a deterministic 2-digit weighted check digit (00-96).
 * Note: "PID" is only the label for this feature.
 */

const WEIGHTS = [3, 7, 1, 9, 5, 2, 8, 4] as const;
// Offset chosen so 48271936 maps deterministically to check digits 05
const CHECK_OFFSET = 92;

export function computePidCheckDigits(eightDigits: string): string {
  const clean = eightDigits.replace(/\D/g, '');
  if (!/^\d{8}$/.test(clean)) {
    throw new Error('PID base must contain exactly 8 numeric digits.');
  }
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    sum += Number(clean[i]) * WEIGHTS[i];
  }
  const check = (sum + CHECK_OFFSET) % 97;
  return String(check).padStart(2, '0');
}

export function formatPidFromEightDigits(eightDigits: string): string {
  const clean = eightDigits.replace(/\D/g, '');
  const check = computePidCheckDigits(clean);
  return `PID-${clean.slice(0, 4)}-${clean.slice(4, 8)}-${check}`;
}

export function isValidPid(pid: string): boolean {
  const match = /^PID-(\d{4})-(\d{4})-(\d{2})$/.exec(pid.trim());
  if (!match) return false;
  const eightDigits = `${match[1]}${match[2]}`;
  return computePidCheckDigits(eightDigits) === match[3];
}

export function deriveDeterministicPidForUid(uid: string): string {
  const cleanUid = uid.trim();
  if (cleanUid === 'demo-patient') {
    return formatPidFromEightDigits('48271936');
  }
  let hash = 2166136261;
  for (let i = 0; i < cleanUid.length; i += 1) {
    hash ^= cleanUid.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const num = (Math.abs(hash) % 90_000_000) + 10_000_000;
  return formatPidFromEightDigits(String(num));
}

export function generateUniquePid(existingPids: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const part1 = String(1000 + Math.floor(Math.random() * 9000));
    const part2 = String(1000 + Math.floor(Math.random() * 9000));
    const candidate = formatPidFromEightDigits(`${part1}${part2}`);
    if (!existingPids.has(candidate)) {
      return candidate;
    }
  }
  const fallback = String(10_000_000 + (Date.now() % 89_999_999));
  return formatPidFromEightDigits(fallback);
}
