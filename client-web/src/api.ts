// src/api.ts
// Centralized API base + fetch helpers + WS helper

function computeBase(): string {
  // env may be undefined or the literal string "undefined"
  const envVal = (import.meta as any).env?.VITE_API_URL
  const fromEnv = typeof envVal === 'string' ? envVal.trim() : ''
  if (fromEnv && fromEnv !== 'undefined') {
    return fromEnv.replace(/\/$/, '') // strip trailing /
  }
  // Dev fallback: if we're on Vite (:5173), point to server (:8080)
  const o = location.origin
  return o.includes(':5173') ? o.replace(':5173', ':8080') : o
}

const BASE = computeBase()

function joinUrl(base: string, p: string): string {
  if (!p) return base
  return base.replace(/\/$/, '') + (p.startsWith('/') ? p : '/' + p)
}

async function doFetch<T>(
  method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE',
  path: string,
  body?: unknown,
  init?: RequestInit
): Promise<T> {
  const url = joinUrl(BASE, path)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(init?.headers as Record<string, string> || {}),
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // We don’t use cookies; JWT is in localStorage for WS – no credentials needed here.
    mode: 'cors',
    ...init,
  })

  // Try to parse JSON for better error messages
  let data: any = null
  const text = await res.text().catch(() => '')
  try { data = text ? JSON.parse(text) : null } catch { /* not json */ }

  if (!res.ok) {
    const msg = data?.error || data?.message || `${res.status} ${res.statusText}`
    throw new Error(`HTTP ${res.status}: ${msg}`)
  }
  return (data ?? ({} as any)) as T
}

export const API = {
  base: BASE,
  url: (p: string) => joinUrl(BASE, p),

  // Low-level
  get:  <T>(p: string, init?: RequestInit) => doFetch<T>('GET', p, undefined, init),
  post: <T>(p: string, body?: unknown, init?: RequestInit) => doFetch<T>('POST', p, body, init),

  // Auth endpoints (POST only!)
  signup: (input: {
    username: string
    password: string
    deviceName?: string
    identityKeyPubB64: string // 32B base64
    signedPrekeyPubB64: string // 32B base64
    oneTimePrekeysB64?: string[]
  }) => doFetch<{ userId: string; username: string; deviceId: string; deviceName?: string; jwt: string }>('POST', '/signup', input),

  login: (input: {
    username: string
    password: string
    deviceName?: string
    identityKeyPubB64: string // 32B base64
    signedPrekeyPubB64: string // 32B base64
    oneTimePrekeysB64?: string[]
  }) => doFetch<{ userId: string; username: string; deviceId: string; deviceName?: string; jwt: string; existingDevice?: boolean }>('POST', '/login', input),

  // Utilities
  resolveDevice: async (who: string): Promise<string> => {
    const r = await doFetch<{ deviceId: string }>('GET', `/resolve/${encodeURIComponent(who)}`)
    return r.deviceId
  },

  health: () => doFetch<{ ok: boolean; region?: string }>('GET', '/health'),

  // WebSocket helper (token in query; server verifies it)
  ws(token: string) {
    const wsBase = BASE.replace(/^http(s?)/, 'ws$1')
    return new WebSocket(`${wsBase.replace(/\/$/, '')}/ws?token=${encodeURIComponent(token)}`)
  },
}

export default API
