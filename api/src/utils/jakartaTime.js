// Asia/Jakarta (WIB) is a fixed UTC+7 offset with no DST — every helper
// here computes directly off that fixed offset rather than depending on
// process.env.TZ being correctly propagated everywhere (AGENTS.md rule
// #15: this must never silently become UTC).
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

function jakartaDateParts(date = new Date()) {
  const shifted = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

function jakartaDateStamp(date = new Date()) {
  const { year, month, day } = jakartaDateParts(date);
  return `${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

function jakartaDateISO(date = new Date()) {
  const { year, month, day } = jakartaDateParts(date);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Returns the [start, end) UTC instants for one Jakarta calendar day, given
// either an explicit 'YYYY-MM-DD' string or (default) today in Jakarta.
// Returns null for a malformed dateStr so callers can turn that into a
// clean validation error instead of a bogus date range.
function jakartaDayBoundsUTC(dateStr) {
  let year, month, day;
  if (dateStr) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]) - 1;
    day = Number(match[3]);
  } else {
    ({ year, month, day } = jakartaDateParts());
  }
  const start = new Date(Date.UTC(year, month, day, 0, 0, 0) - JAKARTA_OFFSET_MS);
  const end = new Date(Date.UTC(year, month, day + 1, 0, 0, 0) - JAKARTA_OFFSET_MS);
  if (Number.isNaN(start.getTime())) return null;
  return { start, end };
}

module.exports = { jakartaDateStamp, jakartaDateISO, jakartaDayBoundsUTC };
