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
  base: (import.meta as any).env?.VITE_API_URL ??
        (location.origin.includes(':5173')
          ? location.origin.replace(':5173', ':8080')
          : location.origin),
  url(p: string) { return this.base.replace(/\/$/, '') + p },
  ws(token: string) {
    const wsBase = this.base.replace(/^http(s?)/, 'ws$1')
    return new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`)
  },
  async resolveDevice(who: string): Promise<string> {
    const r = await fetch(this.url(`/resolve/${encodeURIComponent(who)}`))
    if (!r.ok) throw new Error('resolve failed')
    const j = await r.json()
    return j.deviceId as string
  },
}

