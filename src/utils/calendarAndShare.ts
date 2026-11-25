import type { BookingRecord } from '../types/pinnacle';

export function buildGoogleMapsDirectionsUrl(lat: number, lng: number, name: string): string {
  const q = encodeURIComponent(`${name} @ ${lat},${lng}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&query=${q}`;
}

export function buildWhatsAppShareUrl(booking: BookingRecord): string {
  const text = [
    `Pinnacle OPD Appointment Confirmed`,
    `Token: ${booking.tokenNumber} (Queue #${booking.queuePosition})`,
    `Hospital: ${booking.hospitalName}`,
    `Doctor: ${booking.doctorName || 'OPD Duty Doctor'}`,
    `Date & Slot: ${booking.date} · ${booking.timeSlot}`,
    `Address: ${booking.hospitalAddress}`,
    `Not for medical emergencies. Call 108 / 112 in an emergency.`,
  ].join('\n');
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function downloadCalendarInvite(booking: BookingRecord): void {
  const start = new Date(booking.estimatedCallTimeIso);
  const end = new Date(start.getTime() + 20 * 60 * 1000);
  const formatIcsDate = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pinnacle Healthcare//OPD Booking//EN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@pinnacle.health`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:OPD Appointment (${booking.tokenNumber}) - ${booking.hospitalName}`,
    `DESCRIPTION:Doctor: ${booking.doctorName || 'OPD Duty Doctor'}\\nSpecialty: ${booking.specialty}\\nPatient: ${booking.patientName}\\nToken: ${booking.tokenNumber}`,
    `LOCATION:${booking.hospitalAddress}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pinnacle-${booking.tokenNumber}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
