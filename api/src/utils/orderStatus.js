// Statuses that still represent live work on a table — everything before
// an order reaches 'completed' or 'cancelled' (MEMORY.md's status table).
// Shared rather than redeclared per service: order.service.js uses it to
// decide whether a table is free enough to start a new visit, and
// table.service.js to refuse clearing a table that still has orders in
// flight. Two copies would eventually disagree about one status.
const NON_TERMINAL_STATUSES = ['pending', 'waiting_verif', 'confirmed', 'cooking', 'ready'];

// The other half of the same split: an order here is finished with, one way
// or the other, and no longer occupies its table.
const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

// Setiap perpindahan status yang SAH — satu-satunya sumber aturan, dipakai
// sebagai penjaga oleh semua jalur yang mengubah status:
//   pending       -> waiting_verif  customer menandai sudah bayar QRIS
//   pending       -> confirmed      staff konfirmasi bayar tunai/debit
//   waiting_verif -> confirmed      staff verifikasi bukti QRIS
//   confirmed -> cooking -> ready -> completed   alur dapur, satu langkah
//   (apa pun yang belum selesai) -> cancelled    batal / void (void = sudah
//                                               dibayar, wajib PIN staff)
// completed dan cancelled final: tidak bisa ke mana-mana lagi, jadi order
// yang sudah selesai tidak bisa di-void dan status tidak bisa melompat.
// Tiap jalur tetap punya syarat tambahannya sendiri (mis. pending ->
// confirmed hanya lewat confirmPayment, yang membuat baris Payment dan
// mengkreditkan poin) — tabel ini batas luarnya, bukan penggantinya.
const TRANSITIONS = Object.freeze({
  pending: Object.freeze(['waiting_verif', 'confirmed', 'cancelled']),
  waiting_verif: Object.freeze(['confirmed', 'cancelled']),
  confirmed: Object.freeze(['cooking', 'cancelled']),
  cooking: Object.freeze(['ready', 'cancelled']),
  ready: Object.freeze(['completed', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

function canTransition(from, to) {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}

module.exports = { NON_TERMINAL_STATUSES, TERMINAL_STATUSES, TRANSITIONS, canTransition };
