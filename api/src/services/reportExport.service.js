const ExcelJS = require('exceljs');
const reportService = require('./report.service');

const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});
function rupiah(value) {
  return rupiahFormatter.format(Number(value));
}

const METODE_LABEL = { qris: 'QRIS', tunai: 'Tunai', debit: 'Debit' };

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.alignment = { vertical: 'middle' };
  });
}

// Same shape report.service.js's getReport() already produces for
// ReportView.vue's own on-screen numbers — one source of truth for what a
// report "is", this just renders it as a properly formatted workbook
// instead of the page's cards, and instead of the plain-text CSV this
// replaces (store owner's own words: "dirapihkan, tidak murni tulisan
// saja").
async function generateExcel(fromStr, toStr) {
  const r = await reportService.getReport(fromStr, toStr);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Popside';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Laporan');
  sheet.columns = [{ width: 34 }, { width: 16 }, { width: 16 }, { width: 16 }];

  const titleRow = sheet.addRow([`Laporan Pendapatan — ${r.from} s/d ${r.to}`]);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 4);
  sheet.addRow([]);

  const summaryHeader = sheet.addRow(['Ringkasan']);
  summaryHeader.font = { bold: true };
  sheet.addRow(['Total Pendapatan', rupiah(r.total)]);
  sheet.addRow(['Jumlah Pesanan', r.orderCount]);
  sheet.addRow(['Total Diskon', rupiah(r.totalDiscount)]);
  sheet.addRow([
    'Margin Kotor',
    r.knownMarginRevenue > 0 ? rupiah(r.totalMargin) : '—',
    r.knownMarginRevenue > 0 ? `(dari ${rupiah(r.knownMarginRevenue)} pendapatan ber-HPP)` : 'Belum ada produk dengan HPP terisi',
  ]);
  sheet.addRow([]);

  const metodeHeader = sheet.addRow(['Metode Bayar', 'Jumlah']);
  styleHeaderRow(metodeHeader);
  for (const [metode, amount] of Object.entries(r.byMetode)) {
    sheet.addRow([METODE_LABEL[metode] ?? metode, rupiah(amount)]);
  }
  sheet.addRow([]);

  const productHeader = sheet.addRow(['Produk', 'Qty', 'Pendapatan', 'Margin']);
  styleHeaderRow(productHeader);
  for (const p of r.topProducts) {
    sheet.addRow([p.nama, p.qty, rupiah(p.revenue), p.margin === null ? 'HPP belum diisi' : rupiah(p.margin)]);
  }

  return workbook.xlsx.writeBuffer();
}

// A simplified double-entry jurnal umum (general journal) — cash-basis,
// net-of-discount revenue per payment method, the convention many small
// businesses' own bookkeepers already use rather than a full contra-
// revenue discount account. QRIS/Debit post to a receivable account
// (settles to the bank a day or two later, not same-day cash-in-hand like
// Tunai does) rather than straight to Kas. Meant as a starting point for
// manual import into Jurnal.id/Accurate/etc — account names and the exact
// column layout almost certainly need adjusting to match whichever
// software and chart of accounts is actually in use; this is not a
// certified template for any specific one.
const AKUN_DEBIT = { tunai: 'Kas', qris: 'Piutang QRIS', debit: 'Piutang Bank (Debit)' };

async function generateJournalExcel(fromStr, toStr) {
  const r = await reportService.getReport(fromStr, toStr);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Popside';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Jurnal Umum');
  sheet.columns = [
    { width: 12 },
    { width: 44 },
    { width: 22 },
    { width: 22 },
    { width: 16, style: { numFmt: '#,##0' } },
  ];

  const titleRow = sheet.addRow([`Jurnal Umum — ${r.from} s/d ${r.to}`]);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 5);
  sheet.addRow([]);

  const header = sheet.addRow(['Tanggal', 'Keterangan', 'Akun Debit', 'Akun Kredit', 'Jumlah']);
  styleHeaderRow(header);

  let totalJumlah = 0;
  for (const [metode, amount] of Object.entries(r.byMetode)) {
    if (amount <= 0) continue;
    sheet.addRow([
      r.to,
      `Penjualan ${METODE_LABEL[metode]} ${r.from} s/d ${r.to}`,
      AKUN_DEBIT[metode],
      'Pendapatan Penjualan',
      amount,
    ]);
    totalJumlah += amount;
  }
  const totalRow = sheet.addRow(['', '', '', 'Total', totalJumlah]);
  totalRow.font = { bold: true };

  if (r.totalDiscount > 0) {
    sheet.addRow([]);
    const noteRow = sheet.addRow([
      `Catatan: total diskon periode ini ${rupiah(r.totalDiscount)} sudah dikurangkan langsung dari Pendapatan Penjualan di atas (net), belum dipisah ke akun Diskon Penjualan tersendiri — sesuaikan manual kalau chart of account Anda memisahkannya.`,
    ]);
    noteRow.font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
    sheet.mergeCells(noteRow.number, 1, noteRow.number, 5);
    sheet.getRow(noteRow.number).height = 30;
    noteRow.alignment = { wrapText: true, vertical: 'top' };
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateExcel, generateJournalExcel };
