export function loadJSON(storage, key, fallback) {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function saveJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable (private mode, quota, disabled) — state just
    // won't survive a refresh; nothing else depends on it persisting.
  }
}
