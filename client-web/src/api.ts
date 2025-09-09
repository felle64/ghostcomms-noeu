// client-web/src/api.ts
const API_BASE =
  (import.meta as any).env?.VITE_API_URL ??
  (location.origin.includes(':5173')
    ? location.origin.replace(':5173', ':8080')
    : location.origin)

export const API = {
  base: API_BASE,
  ws(token: string) {
    const wsBase = API_BASE.replace(/^http(s?)/, 'ws$1')
    const url = `${wsBase}/ws?token=${encodeURIComponent(token)}`
    return new WebSocket(url) // no subprotocol
  },
}
export default API
