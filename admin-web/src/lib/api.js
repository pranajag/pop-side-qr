export const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

let csrfToken = null

function setCsrfToken(token) {
  csrfToken = token
}

// Called once on the first 401 from an already-open screen — see
// handleSessionExpired below. Wired up in main.js, which owns the router.
let onSessionExpired = null
function setSessionExpiredHandler(fn) {
  onSessionExpired = fn
}

// A 401 on a normal screen means the session is gone (expired, or the API
// restarted and dropped its in-memory store), not that this one request was
// malformed. Several views kick off store fetches on mount without awaiting
// them, so before this the only visible result was an empty list plus an
// "Uncaught (in promise)" in the console — staff had no idea they'd been
// logged out. Bounced to login instead, once, no matter how many parallel
// fetches fail together.
//
// The login request itself is excluded on purpose: a wrong password is also
// a 401, and redirecting to login from login would swallow the error the
// form needs to show.
let sessionExpiredFired = false
function handleSessionExpired(path) {
  // Langkah 2FA juga: 401 di sana berarti "ulangi dari password", dan layar
  // login sendiri yang menanganinya.
  if (path.startsWith('/auth/login') || path.startsWith('/auth/2fa')) return false
  if (sessionExpiredFired) return true
  sessionExpiredFired = true
  onSessionExpired?.()
  // Released once the app has actually navigated, so a later expiry in the
  // same tab still redirects.
  setTimeout(() => {
    sessionExpiredFired = false
  }, 3000)
  return true
}

async function request(
  path,
  { method = 'GET', body, isFormData = false } = {}
) {
  const headers = {}
  if (body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json'
  }
  // GET/HEAD/OPTIONS are exempt server-side too (see api/src/app.js) — no
  // point sending a token that isn't required.
  if (method !== 'GET' && csrfToken) {
    headers['x-csrf-token'] = csrfToken
  }

  let res
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers,
      body:
        body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    })
  } catch {
    // fetch() itself threw — no connectivity, not the server rejecting the
    // request. Every call site already shows err.message via
    // formatApiError(), so fixing the message once here (instead of
    // "Failed to fetch") is what actually gives staff a clear reason a
    // status change/confirm/etc. didn't go through, with no need to
    // individually gate every mutating button in the app.
    const error = new Error('Tidak ada koneksi internet. Coba lagi setelah online.')
    error.isOffline = true
    throw error
  }

  if (res.status === 204) return null

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const error = new Error(data?.error || `Request gagal (${res.status})`)
    error.status = res.status
    // Marked so main.js can keep an already-dealt-with 401 out of the
    // console. Several views start store fetches on mount without awaiting
    // them; when a session dies, each of those rejects with nothing left to
    // do about it — the redirect has already happened. Only this exact case
    // is suppressed, so every other unhandled rejection still shows up.
    if (res.status === 401) error.handled = handleSessionExpired(path)
    error.details = data?.details
    // Kode mesin untuk penolakan yang harus ditanggapi layar (mis.
    // PIN_DIPERLUKAN -> tampilkan kolom PIN), lihat api/src/utils/AppError.js.
    error.code = data?.code
    // Set by express-rate-limit (standardHeaders: true) on every response
    // from a rate-limited route, not just once it trips — harmless to read
    // generically here since most endpoints simply won't have them.
    const remaining = res.headers.get('ratelimit-remaining')
    const resetSeconds = res.headers.get('ratelimit-reset')
    if (remaining !== null) error.rateLimitRemaining = Number(remaining)
    if (resetSeconds !== null)
      error.rateLimitResetSeconds = Number(resetSeconds)
    throw error
  }
  return data
}

export const api = {
  get: (path) => request(path),
  post: (path, body, opts) => request(path, { method: 'POST', body, ...opts }),
  put: (path, body, opts) => request(path, { method: 'PUT', body, ...opts }),
  patch: (path, body, opts) =>
    request(path, { method: 'PATCH', body, ...opts }),
  del: (path) => request(path, { method: 'DELETE' }),
  setCsrfToken,
  setSessionExpiredHandler,
}

// Zod validation errors arrive as { error: 'Validation failed', details: [{ field, message }] }
export function formatApiError(err) {
  if (err?.details?.length) {
    return err.details
      .map((d) => (d.field ? `${d.field}: ${d.message}` : d.message))
      .join(', ')
  }
  return err?.message || 'Terjadi kesalahan'
}
