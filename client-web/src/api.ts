export const API = {
  base: import.meta.env.VITE_API_URL,
  ws(token: string) {
    return new WebSocket(`${API.base.replace('http', 'ws')}/ws`, token)
  },
}
