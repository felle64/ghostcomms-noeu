import Dexie, { Table } from 'dexie'

export type StoredMsg = {
  id: string            // clientMsgId for mine, env.id for incoming
  peer: string          // peer deviceId
  text: string
  mine: boolean
  delivered?: boolean
  ts: number            // Date.now()
}

class GCDB extends Dexie {
  messages!: Table<StoredMsg, string>
  constructor() {
    super('ghostcomms')
    this.version(1).stores({
      messages: '&id, peer, ts' // primary key id; indexes peer, ts
    })
  }
}
export const db = new GCDB()

// ---------- CRUD ----------
export async function loadThread(peer: string) {
  return db.messages.where('peer').equals(peer).sortBy('ts')
}
export async function saveMessage(m: StoredMsg) {
  await db.messages.put(m)
}
export async function markDelivered(id: string) {
  await db.messages.update(id, { delivered: true })
}
export async function clearThread(peer: string) {
  await db.messages.where('peer').equals(peer).delete()
}
export async function clearAll() {
  await db.messages.clear()
}

// ---------- Retention ----------
const RETENTION_KEY = 'retentionDays'

export function getRetentionDays(): number {
  const raw = localStorage.getItem(RETENTION_KEY)
  if (raw == null) return 30 // default 30 days
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30
}
export function setRetentionDays(days: number) {
  localStorage.setItem(RETENTION_KEY, String(days))
}

/** Delete messages in a thread older than N days (0 = keep forever). Returns deleted count. */
export async function pruneThread(peer: string, days = getRetentionDays()) {
  if (days <= 0) return 0
  const cutoff = Date.now() - days * 86_400_000
  // Delete only this thread below cutoff
  // Dexie: where('peer').equals(...).and(...).delete()
  const deleted = await db.messages.where('peer').equals(peer).and(m => m.ts < cutoff).delete()
  return deleted
}

/** Global prune across all threads */
export async function pruneAll(days = getRetentionDays()) {
  if (days <= 0) return 0
  const cutoff = Date.now() - days * 86_400_000
  const deleted = await db.messages.where('ts').below(cutoff).delete()
  return deleted
}
