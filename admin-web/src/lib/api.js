export const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

let csrfToken = null

function setCsrfToken(token) {
  csrfToken = token
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
    error.details = data?.details
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
