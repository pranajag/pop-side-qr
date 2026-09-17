export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

// Public API — stateless, no session cookie, no CSRF token needed (see
// api/src/app.js: /api/public/* is mounted ahead of the CSRF middleware).
async function request(path, { method = 'GET', body } = {}) {
  const headers = body !== undefined ? { 'Content-Type': 'application/json' } : {}

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const error = new Error(data?.error || `Request gagal (${res.status})`)
    error.status = res.status
    error.details = data?.details
    throw error
  }
  return data
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
}

export function formatApiError(err) {
  if (err?.details?.length) {
    return err.details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)).join(', ')
  }
  return err?.message || 'Terjadi kesalahan'
}
