// Statuses that still represent live work on a table — everything before
// an order reaches 'completed' or 'cancelled' (MEMORY.md's status table).
// Shared rather than redeclared per service: order.service.js uses it to
// decide whether a table is free enough to start a new visit, and
// table.service.js to refuse clearing a table that still has orders in
// flight. Two copies would eventually disagree about one status.
const NON_TERMINAL_STATUSES = ['pending', 'waiting_verif', 'confirmed', 'cooking', 'ready'];

module.exports = { NON_TERMINAL_STATUSES };
