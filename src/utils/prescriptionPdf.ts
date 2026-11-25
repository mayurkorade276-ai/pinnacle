import { jsPDF } from 'jspdf';
import type { HealthVisitRecord } from '../types/pinnacle';

/**
 * Generates and downloads a pure black-and-white A4 printable prescription PDF.
 * No colored backgrounds are used anywhere to guarantee crisp clinic/thermal/laser printing.
 */
export function downloadPrescriptionPdf(visit: HealthVisitRecord): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = 16;

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  // --- Header: App logo/name, Hospital name & address, Date & time ---
  doc.setLineWidth(0.6);
  doc.rect(margin, y, 9, 9);
  doc.setLineWidth(0.7);
  doc.line(margin + 4.5, y + 2, margin + 4.5, y + 7);
  doc.line(margin + 2, y + 4.5, margin + 7, y + 4.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('PINNACLE', margin + 12, y + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('OPD Digital Prescription', margin + 12, y + 8.5);

  // Hospital block (centered/right)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const hospTitleLines = doc.splitTextToSize(visit.hospitalName || 'Pinnacle Partner Clinic', 100);
  doc.text(hospTitleLines, pageWidth - margin, y + 4, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const addrLines = doc.splitTextToSize(
    `${visit.hospitalAddress}${visit.city ? `, ${visit.city}` : ''}`,
    100
  );
  doc.text(addrLines, pageWidth - margin, y + 4 + hospTitleLines.length * 4.2, { align: 'right' });

  const dateLineY = y + Math.max(12, (hospTitleLines.length + addrLines.length) * 4.2 + 3);
  doc.text(
    `Date: ${visit.visitDate}   Time: ${visit.visitTime}${visit.tokenNumber ? `   Token: #${visit.tokenNumber}` : ''}`,
    pageWidth - margin,
    dateLineY,
    { align: 'right' }
  );

  y = Math.max(y + 14, dateLineY + 4);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  // --- Patient & Doctor Info Grid (2 columns, B&W outline box) ---
  const boxHeight = 25;
  doc.setLineWidth(0.3);
  doc.rect(margin, y, contentWidth, boxHeight);
  doc.line(margin + contentWidth / 2, y, margin + contentWidth / 2, y + boxHeight);

  // Patient block (left)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('PATIENT DETAILS', margin + 3, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Name: ${visit.patientName}`, margin + 3, y + 10.5);
  doc.text(
    `Health ID (PID): ${visit.patientPid ? visit.patientPid : 'Walk-in (No PID)'}`,
    margin + 3,
    y + 15.5
  );
  doc.text(`Age / Gender: ${visit.patientAge} yrs / ${visit.patientGender}`, margin + 3, y + 20.5);

  // Doctor block (right)
  const rightX = margin + contentWidth / 2 + 3;
  doc.setFont('helvetica', 'bold');
  doc.text('PRESCRIBING DOCTOR', rightX, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.text(visit.doctorName, rightX, y + 10.5);
  const qualText = doc.splitTextToSize(
    `${visit.doctorQualification || 'MBBS'} (${visit.doctorSpecialty})`,
    contentWidth / 2 - 6
  );
  doc.text(qualText[0] || '', rightX, y + 15.5);
  doc.text(`Reg. No.: ${visit.doctorRegNumber || 'On file'}`, rightX, y + 20.5);

  y += boxHeight + 6;

  // --- Symptoms, Diagnosis & Notes ---
  const writeSection = (label: string, body: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(label, margin, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(body || '—', contentWidth);
    doc.text(lines, margin, y);
    y += lines.length * 4.5 + 3;
  };

  if (visit.symptoms?.trim()) {
    writeSection('Clinical Symptoms:', visit.symptoms.trim());
  }
  writeSection('Diagnosis:', visit.diagnosis.trim() || 'OPD Consultation');
  if (visit.notes?.trim()) {
    writeSection('Clinical Advice / Notes:', visit.notes.trim());
  }

  y += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('Rx — Prescribed Medicines', margin, y);
  y += 3.5;

  // --- Medicine Table ---
  // Columns sum = 180 mm
  const cols = [
    { header: 'No.', width: 9 },
    { header: 'Medicine', width: 45 },
    { header: 'Strength', width: 24 },
    { header: 'When', width: 41 },
    { header: 'How Much', width: 21 },
    { header: 'Duration', width: 17 },
    { header: 'Total Qty', width: 23 },
  ];

  const drawTableHeader = (topY: number) => {
    doc.setLineWidth(0.35);
    doc.rect(margin, topY, contentWidth, 8);
    let colX = margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    for (let i = 0; i < cols.length; i += 1) {
      doc.text(cols[i].header, colX + 1.5, topY + 5.2);
      colX += cols[i].width;
      if (i < cols.length - 1) {
        doc.line(colX, topY, colX, topY + 8);
      }
    }
    return topY + 8;
  };

  y = drawTableHeader(y);

  const medicines = visit.medicines ?? [];
  if (medicines.length === 0) {
    doc.setLineWidth(0.25);
    doc.rect(margin, y, contentWidth, 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('No medicines prescribed.', margin + 3, y + 5.8);
    y += 9;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    medicines.forEach((item, index) => {
      const whenLabel = `${(item.when || []).join(', ') || 'Once daily'} (${item.foodTiming || 'After food'})`;
      const cellValues = [
        String(index + 1),
        item.medicineName || '—',
        item.strength || '—',
        whenLabel,
        item.howMuch || '—',
        `${item.durationDays || 1} d`,
        item.totalQuantity || '—',
      ];

      const wrappedCells = cellValues.map((val, i) =>
        doc.splitTextToSize(val, cols[i].width - 3)
      );
      const maxLines = Math.max(...wrappedCells.map((arr) => arr.length), 1);
      const rowHeight = Math.max(8, maxLines * 4 + 3);

      if (y + rowHeight > pageHeight - 40) {
        doc.addPage();
        y = 18;
        y = drawTableHeader(y);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
      }

      doc.setLineWidth(0.25);
      doc.rect(margin, y, contentWidth, rowHeight);

      let colX = margin;
      for (let i = 0; i < cols.length; i += 1) {
        doc.text(wrappedCells[i], colX + 1.5, y + 4.5);
        colX += cols[i].width;
        if (i < cols.length - 1) {
          doc.line(colX, y, colX, y + rowHeight);
        }
      }
      y += rowHeight;
    });
  }

  y += 8;
  if (y > pageHeight - 40) {
    doc.addPage();
    y = 24;
  }

  // Follow-up & Signature row
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(
    `Follow-up Date: ${visit.followUpDate ? visit.followUpDate : 'As advised / SOS'}`,
    margin,
    y
  );

  // Signature block on right
  const sigStartX = pageWidth - margin - 62;
  doc.setLineWidth(0.35);
  doc.line(sigStartX, y + 12, pageWidth - margin, y + 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`${visit.doctorName} (${visit.doctorRegNumber || 'Reg. on file'})`, pageWidth - margin, y + 16.5, {
    align: 'right',
  });
  doc.text("Doctor's Signature", pageWidth - margin, y + 20.5, { align: 'right' });

  // Mandatory footer near bottom of A4 page
  doc.setLineWidth(0.3);
  doc.line(margin, pageHeight - 18, pageWidth - margin, pageHeight - 18);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text("Valid only with the doctor's signature.", margin, pageHeight - 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Record ID: ${visit.id}`, pageWidth - margin, pageHeight - 12, { align: 'right' });

  const safeName = (visit.patientName || 'patient').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const safeDate = (visit.visitDate || 'rx').replace(/[^0-9-]+/g, '');
  doc.save(`Pinnacle_Rx_${safeName}_${safeDate}.pdf`);
}
