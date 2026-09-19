const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const shiftService = require('./shift.service');

const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});
function rupiah(value) {
  return rupiahFormatter.format(Number(value));
}

const dateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  dateStyle: 'medium',
  timeStyle: 'short',
});
function dateTime(value) {
  return value ? dateTimeFormatter.format(new Date(value)) : '—';
}

function reconLabel(diff) {
  if (diff === null) return '—';
  if (diff < 0) return `Minus ${rupiah(Math.abs(diff))}`;
  if (diff > 0) return `Lebih ${rupiah(diff)}`;
  return 'Pas';
}

// Both formats are built from the exact same shift-detail shape
// shift.service.js's getShiftDetail() already produces for the admin
// dashboard's own detail dialog — one source of truth for what a shift
// "means", the export just renders it differently.
async function generateExcel(shiftId) {
  const shift = await shiftService.getShiftDetail(shiftId);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Popside';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Laporan Shift');
  sheet.columns = [{ width: 32 }, { width: 24 }];

  const titleRow = sheet.addRow([`Laporan Shift — ${shift.username}`]);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(1, 1, 1, 2);
  sheet.addRow([]);

  const infoRows = [
    ['Staff', shift.username],
    ['Mulai', dateTime(shift.startedAt)],
    ['Selesai', dateTime(shift.endedAt)],
    ['Jumlah Order', shift.orderCount],
  ];
  for (const [label, value] of infoRows) {
    sheet.addRow([label, value]);
  }
  sheet.addRow([]);

  const revenueHeader = sheet.addRow(['Pendapatan per Metode', '']);
  revenueHeader.font = { bold: true };
  sheet.addRow(['QRIS', rupiah(shift.byMetode.qris)]);
  sheet.addRow(['Tunai', rupiah(shift.byMetode.tunai)]);
  sheet.addRow(['Debit', rupiah(shift.byMetode.debit)]);
  sheet.addRow(['Gojek', shift.gojekAmount === null ? '—' : rupiah(shift.gojekAmount)]);
  sheet.addRow(['GrabFood', shift.grabfoodAmount === null ? '—' : rupiah(shift.grabfoodAmount)]);
  const totalRow = sheet.addRow(['Total Pendapatan', rupiah(shift.totalRevenueWithOnline)]);
  totalRow.font = { bold: true };
  sheet.addRow([]);

  if (shift.cashCounted !== null) {
    const cashHeader = sheet.addRow(['Rekonsiliasi Kas Tunai', '']);
    cashHeader.font = { bold: true };
    sheet.addRow(['Kas awal', shift.cashStart === null ? '—' : rupiah(shift.cashStart)]);
    sheet.addRow(['Tunai terjual', rupiah(shift.byMetode.tunai)]);
    sheet.addRow(['Seharusnya di laci', rupiah(shift.expectedCash)]);
    sheet.addRow(['Dihitung kasir', rupiah(shift.cashCounted)]);
    const diffRow = sheet.addRow(['Selisih', reconLabel(shift.cashDifference)]);
    if (shift.isMinus) diffRow.font = { bold: true, color: { argb: 'FFCC0000' } };
    sheet.addRow([]);
  }

  if (shift.cancelledAfterConfirm.length > 0) {
    const cancelHeader = sheet.addRow(['Order Tunai Dikonfirmasi Lalu Dibatalkan', '']);
    cancelHeader.font = { bold: true };
    const cols = sheet.addRow(['Kode Order', 'Total / Refund / Dibatalkan']);
    cols.font = { italic: true };
    for (const o of shift.cancelledAfterConfirm) {
      sheet.addRow([
        o.kodeOrder,
        `${rupiah(o.totalHarga)} / ${o.refundAmount === null ? 'belum dicatat' : rupiah(o.refundAmount)} / ${dateTime(o.cancelledAt)}`,
      ]);
    }
  }

  return workbook.xlsx.writeBuffer();
}

function generatePdf(shiftId) {
  return shiftService.getShiftDetail(shiftId).then(
    (shift) =>
      new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(18).text(`Laporan Shift — ${shift.username}`, { underline: true });
        doc.moveDown();

        doc.fontSize(11);
        doc.text(`Mulai: ${dateTime(shift.startedAt)}`);
        doc.text(`Selesai: ${dateTime(shift.endedAt)}`);
        doc.text(`Jumlah Order: ${shift.orderCount}`);
        doc.moveDown();

        doc.fontSize(13).text('Pendapatan per Metode', { underline: true });
        doc.fontSize(11);
        doc.text(`QRIS: ${rupiah(shift.byMetode.qris)}`);
        doc.text(`Tunai: ${rupiah(shift.byMetode.tunai)}`);
        doc.text(`Debit: ${rupiah(shift.byMetode.debit)}`);
        doc.text(`Gojek: ${shift.gojekAmount === null ? '—' : rupiah(shift.gojekAmount)}`);
        doc.text(`GrabFood: ${shift.grabfoodAmount === null ? '—' : rupiah(shift.grabfoodAmount)}`);
        doc.fontSize(12).text(`Total Pendapatan: ${rupiah(shift.totalRevenueWithOnline)}`, { continued: false });
        doc.moveDown();

        if (shift.cashCounted !== null) {
          doc.fontSize(13).text('Rekonsiliasi Kas Tunai', { underline: true });
          doc.fontSize(11);
          doc.text(`Kas awal: ${shift.cashStart === null ? '—' : rupiah(shift.cashStart)}`);
          doc.text(`Tunai terjual: ${rupiah(shift.byMetode.tunai)}`);
          doc.text(`Seharusnya di laci: ${rupiah(shift.expectedCash)}`);
          doc.text(`Dihitung kasir: ${rupiah(shift.cashCounted)}`);
          if (shift.isMinus) doc.fillColor('red');
          doc.text(`Selisih: ${reconLabel(shift.cashDifference)}`);
          doc.fillColor('black');
          doc.moveDown();
        }

        if (shift.cancelledAfterConfirm.length > 0) {
          doc.fontSize(13).text('Order Tunai Dikonfirmasi Lalu Dibatalkan', { underline: true });
          doc.fontSize(10);
          for (const o of shift.cancelledAfterConfirm) {
            doc.text(
              `${o.kodeOrder} — ${rupiah(o.totalHarga)} — refund: ${
                o.refundAmount === null ? 'belum dicatat' : rupiah(o.refundAmount)
              } — dibatalkan ${dateTime(o.cancelledAt)}`
            );
          }
        }

        doc.end();
      })
  );
}

module.exports = { generateExcel, generatePdf };
