/* ==========================================================================
   js/pdf.js — Monthly attendance PDF
   --------------------------------------------------------------------------
   Builds a landscape A4 sheet with jsPDF + jspdf-autotable:

        School name
        Program name
        Monthly Attendance Record — November 2026

        | Student | 3 | 5 | 6 | ... |   ← day-of-month columns
        | Ama     |   | ✓ | ✓ |     |
        | Kofi    | ✓ |   | ✓ |     |

   The two libraries are loaded with plain <script> tags on month.html, which
   is why we read them off `window` here.

   A "✓" tick is DRAWN with vector lines (not typed) because the standard PDF
   fonts cannot display a tick character.
   ========================================================================== */

import { APP_CONFIG } from './config.js';
import { monthName } from './ui.js';

/**
 * @param {Object}  options
 * @param {number}  options.year     e.g. 2026
 * @param {number}  options.month    e.g. 11 (1–12)
 * @param {Array}   options.days     recorded days: [{ date: '2026-11-21', students: [{id,name}] }]
 * @param {Array}   options.students master list: [{ id, name }]
 */
export function generateMonthlyPdf({ year, month, days, students }) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) {
    throw new Error('The PDF library could not be loaded. Check your internet connection and reload the page.');
  }
  if (!days || !days.length) {
    throw new Error('There are no recorded days to print.');
  }

  // Recorded days, oldest first → they become the columns.
  const columns = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const dayNumbers = columns.map((d) => Number(d.date.split('-')[2]));

  // Rows = master list + any student who only exists inside an old record
  // (so removing a student from the master list never loses their history).
  const rowMap = new Map();
  (students || []).forEach((s) => rowMap.set(s.id, s.name));
  columns.forEach((day) => {
    (day.students || []).forEach((s) => {
      if (!rowMap.has(s.id)) rowMap.set(s.id, s.name);
    });
  });
  const rows = [...rowMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  // marks[rowIndex][columnIndex] = did this student attend this day?
  const marks = rows.map(({ id }) =>
    columns.map((day) => (day.students || []).some((s) => s.id === id))
  );

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 28;
  const contentWidth = pageWidth - marginX * 2;

  /* ---------------------------- Title block ---------------------------- */
  let cursorY = 42;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 18);
  doc.text(APP_CONFIG.schoolName, pageWidth / 2, cursorY, { align: 'center' });

  cursorY += 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(APP_CONFIG.programName, pageWidth / 2, cursorY, { align: 'center' });

  cursorY += 22;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`Monthly Attendance Record — ${monthName(month)} ${year}`, pageWidth / 2, cursorY, {
    align: 'center',
  });

  cursorY += 14;
  doc.setDrawColor(15, 118, 110);
  doc.setLineWidth(1.2);
  doc.line(marginX, cursorY, pageWidth - marginX, cursorY);

  /* --------------------------- Column widths --------------------------- */
  const nameColWidth = 150;
  let dayColWidth = 26;
  if (nameColWidth + dayColWidth * columns.length > contentWidth) {
    dayColWidth = Math.max(15, Math.floor((contentWidth - nameColWidth) / columns.length));
  }
  const columnStyles = { 0: { cellWidth: nameColWidth, halign: 'left', fontStyle: 'bold' } };
  for (let i = 1; i <= columns.length; i += 1) {
    columnStyles[i] = { cellWidth: dayColWidth };
  }

  /* ------------------------------ Table -------------------------------- */
  const headRow = ['Student', ...dayNumbers.map(String)];
  const bodyRows = rows.map(({ name }) => [name, ...columns.map(() => '')]);

  doc.autoTable({
    head: [headRow],
    body: bodyRows,
    startY: cursorY + 10,
    theme: 'grid',
    tableWidth: 'wrap',
    margin: { left: marginX, right: marginX, bottom: 40 },
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: 3,
      minCellHeight: 17,
      halign: 'center',
      valign: 'middle',
      lineColor: [214, 214, 208],
      lineWidth: 0.5,
      textColor: [40, 40, 38],
    },
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [247, 247, 244] },
    columnStyles,
    // Draw a tick in the cell when the student attended that day.
    didDrawCell(data) {
      if (data.section !== 'body' || data.column.index === 0) return;
      const rowIndex = data.row.index;
      const colIndex = data.column.index - 1;
      if (!marks[rowIndex] || !marks[rowIndex][colIndex]) return;

      const { x, y, width, height } = data.cell;
      doc.setDrawColor(15, 118, 110);
      doc.setLineWidth(1.6);
      doc.setLineCap('round');
      // Two short strokes that form a check mark.
      doc.lines(
        [[width * 0.16, height * 0.20], [width * 0.32, -height * 0.32]],
        x + width * 0.30,
        y + height * 0.50
      );
    },
  });

  /* --------------------------- Signature block -------------------------- */
  const tableEndY = doc.lastAutoTable ? doc.lastAutoTable.finalY : cursorY + 40;
  let signY = Math.min(tableEndY + 48, pageHeight - 46);
  if (signY < tableEndY + 24) signY = tableEndY + 24;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 58);

  const supervisor = APP_CONFIG.supervisorName || '';
  const lineWidth = 200;
  const labelGap = 4;

  // Supervisor name line
  doc.text('Supervisor:', marginX, signY);
  doc.setDrawColor(120, 120, 115);
  doc.setLineWidth(0.7);
  doc.line(marginX + 62, signY + labelGap, marginX + 62 + lineWidth, signY + labelGap);
  if (supervisor) {
    doc.setFont('helvetica', 'bold');
    doc.text(supervisor, marginX + 68, signY - 2);
    doc.setFont('helvetica', 'normal');
  }

  // Signature line (right side)
  const signLabelX = pageWidth - marginX - lineWidth - 60;
  doc.text('Signature:', signLabelX, signY);
  doc.line(signLabelX + 58, signY + labelGap, signLabelX + 58 + lineWidth, signY + labelGap);

  /* ------------------------------- Save -------------------------------- */
  doc.save(`${APP_CONFIG.pdfFileNamePrefix}-${monthName(month)}-${year}.pdf`);
}
