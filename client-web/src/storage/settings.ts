export type Settings = {
  sendTyping: boolean;   // send typing control msgs
  showTyping: boolean;   // show “typing…” from peer
  notifyOnClear: boolean;// auto-notify peer when you clear
}

const DEFAULTS: Settings = { sendTyping: true, showTyping: true, notifyOnClear: true }

export function getSettings(): Settings {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem('settings') || '{}')) } }
  catch { return DEFAULTS }
}
export function setSettings(next: Settings) {
  localStorage.setItem('settings', JSON.stringify(next))
}
export function patchSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings(); const next = { ...cur, ...patch }; setSettings(next); return next
}
