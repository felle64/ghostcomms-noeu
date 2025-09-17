// Centralized, robust API base + WS helper

function computeBase(): string {
  // env may be undefined or the literal string "undefined"
  const envVal = (import.meta as any).env?.VITE_API_URL
  const fromEnv = (typeof envVal === 'string' ? envVal.trim() : '')
  if (fromEnv && fromEnv !== 'undefined') {
    return fromEnv.replace(/\/$/, '')
  }
  // dev fallback: if we're on :5173 use the server on :8080
  const o = location.origin
  return o.includes(':5173') ? o.replace(':5173', ':8080') : o
}

const BASE = computeBase()

export const API = {
  base: BASE,
  url(path: string) {
    return `${BASE}${path.startsWith('/') ? path : `/${path}`}`
  },
  ws(token: string) {
    const wsBase = BASE.replace(/^http(s?):/, 'ws$1:')
    return new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`)
  },
}

export default API
