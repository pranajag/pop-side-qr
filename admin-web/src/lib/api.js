export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

let csrfToken = null

function setCsrfToken(token) {
  csrfToken = token
}

async function request(path, { method = 'GET', body, isFormData = false } = {}) {
  const headers = {}
  if (body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json'
  }
  // GET/HEAD/OPTIONS are exempt server-side too (see api/src/app.js) — no
  // point sending a token that isn't required.
  if (method !== 'GET' && csrfToken) {
    headers['x-csrf-token'] = csrfToken
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  })

  if (res.status === 204) return null

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
  post: (path, body, opts) => request(path, { method: 'POST', body, ...opts }),
  put: (path, body, opts) => request(path, { method: 'PUT', body, ...opts }),
  del: (path) => request(path, { method: 'DELETE' }),
  setCsrfToken,
}

// Zod validation errors arrive as { error: 'Validation failed', details: [{ field, message }] }
export function formatApiError(err) {
  if (err?.details?.length) {
    return err.details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)).join(', ')
  }
  return err?.message || 'Terjadi kesalahan'
}
