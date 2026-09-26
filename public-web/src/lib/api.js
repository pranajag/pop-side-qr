export const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

// Public API — no login session, no CSRF token needed (see api/src/app.js:
// /api/public/* is mounted ahead of the CSRF middleware). Cookies ARE sent
// (credentials: 'include'): the API sets two httpOnly cookies here — the
// ordering device (only this device can track its orders) and the member
// OTP verification. JavaScript cannot read either one; they are sameSite
// strict, so other sites cannot send them.
async function request(
  path,
  { method = 'GET', body, isFormData = false } = {}
) {
  // FormData sets its own multipart Content-Type (with the boundary) —
  // setting it manually here would drop the boundary and break the upload.
  const headers =
    body !== undefined && !isFormData
      ? { 'Content-Type': 'application/json' }
      : {}

  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers,
    body:
      body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  })

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const error = new Error(data?.error || `Request gagal (${res.status})`)
    error.status = res.status
    error.details = data?.details
    // Machine-readable tag for the few refusals a screen has to react to
    // structurally (see api/src/utils/AppError.js). Undefined for most.
    error.code = data?.code
    throw error
  }
  return data
}

export const api = {
  get: (path) => request(path),
  post: (path, body, opts) => request(path, { method: 'POST', body, ...opts }),
}

export function formatApiError(err) {
  if (err?.details?.length) {
    return err.details
      .map((d) => (d.field ? `${d.field}: ${d.message}` : d.message))
      .join(', ')
  }
  return err?.message || 'Terjadi kesalahan'
}
