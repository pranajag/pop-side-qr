// Penghitung percobaan gagal per akun (di memori proses): `maks` kali salah
// dalam `jendelaMs` -> terkunci `kunciMs` penuh, terhitung dari salah yang
// terakhir (bukan dari salah pertama). Dipakai PIN void/konfirmasi
// (pinAttempts.js) dan kode 2FA (twoFactor.service.js).
function buatPenghitung({ maks, jendelaMs, kunciMs }) {
  const catatan = new Map(); // id -> { count, windowStart, lockedUntil }

  function isLocked(id, now = Date.now()) {
    const entry = catatan.get(id);
    if (!entry) return false;
    if (entry.lockedUntil) {
      if (now < entry.lockedUntil) return true;
      catatan.delete(id);
      return false;
    }
    if (now - entry.windowStart > jendelaMs) catatan.delete(id);
    return false;
  }

  // Mengembalikan true kalau kegagalan ini yang membuat akun terkunci.
  function recordFailure(id, now = Date.now()) {
    const entry = catatan.get(id);
    if (!entry || entry.lockedUntil || now - entry.windowStart > jendelaMs) {
      catatan.set(id, { count: 1, windowStart: now, lockedUntil: maks <= 1 ? now + kunciMs : null });
      return maks <= 1;
    }
    entry.count += 1;
    if (entry.count >= maks) {
      entry.lockedUntil = now + kunciMs;
      return true;
    }
    return false;
  }

  function recordSuccess(id) {
    catatan.delete(id);
  }

  return { isLocked, recordFailure, recordSuccess };
}

module.exports = { buatPenghitung };
