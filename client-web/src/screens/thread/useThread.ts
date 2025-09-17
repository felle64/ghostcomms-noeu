import { useEffect, useRef, useState } from 'react'
import { API } from '../../api'
import { encryptFor, decryptFrom } from '../../crypto/signal'
import {
  loadThread, saveMessage, markDelivered,
  clearThread as dbClearThread, clearAll as dbClearAll,
  getRetentionDays, setRetentionDays, pruneThread
} from '../../storage/db'
import { getSettings, patchSettings, type Settings } from '../../storage/settings'

export type Msg = {
  id: string
  text: string
  mine?: boolean
  delivered?: boolean
  ts?: number
  system?: boolean
}
type Status = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (u: Uint8Array) => new TextDecoder().decode(u)

function genId(): string {
  const c = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
}

function makeSystem(text: string): Msg {
  return { id: genId(), text, system: true, ts: Date.now() }
}

async function sendControl(ws: WebSocket, peer: string, payload: any) {
  const plaintext = JSON.stringify({ type: 'ctrl', ...payload })
  const ct = await encryptFor(peer, enc(plaintext))
  ws.send(JSON.stringify({ to: peer, ciphertext: ct, contentType: 'msg' }))
}

export function useThread({ self, peer }: { self: string; peer: string }) {
  // UI state
  const [items, setItems] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [retention, setRetention] = useState<number>(getRetentionDays())
  const [settings, setSettings] = useState<Settings>(getSettings())
  const [peerTyping, setPeerTyping] = useState(false)

  // refs / runtime
  const wsRef = useRef<WebSocket | null>(null)
  const connIdRef = useRef(0)
  const stoppedRef = useRef(false)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const maxReconnectAttempts = 5
  const listRef = useRef<HTMLDivElement | null>(null)

  // typing timers/refs
  const lastTypingSentRef = useRef(0)
  const typingStopTimerRef = useRef<number | null>(null)
  const peerTypingUntilRef = useRef(0) // deadline in ms

  const scrollToBottom = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // --- peer typing indicator (deadline-based ticker) ---
  useEffect(() => {
    const id = window.setInterval(() => {
      const on =
        settings.showTyping &&
        status === 'online' &&
        Date.now() < peerTypingUntilRef.current
      setPeerTyping(prev => (prev !== on ? on : prev))
    }, 400)
    return () => window.clearInterval(id)
  }, [settings.showTyping, status])

  // --- initial load + per-peer inbox fetch + prune ---
  useEffect(() => {
    // reset typing UI when switching threads
    peerTypingUntilRef.current = 0
    setPeerTyping(false)

    let alive = true
    ;(async () => {
      // 1) fetch pending messages from this peer (server inbox)
      const jwt = localStorage.getItem('jwt') || ''
      try {
        const res = await fetch(API.url(`/inbox/from/${encodeURIComponent(peer)}`), {
          headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' }
        })
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.items)) {
            for (const it of data.items) {
              try {
                const plain = await decryptFrom(peer, it.ciphertextB64)
                const txt = new TextDecoder().decode(plain)
                const msg = { id: it.id, text: txt, mine: false, ts: Date.now() }
                if (alive) setItems(x => [...x, msg])
                await saveMessage({ id: it.id, peer, text: txt, mine: false, ts: msg.ts! })
              } catch (e) {
                console.warn('Failed to decrypt inbox item', e)
              }
            }
          }
        } else {
          console.warn('inbox fetch failed', res.status)
        }
      } catch (e) {
        console.warn('inbox error', e)
      }

      // 2) prune + load local history
      await pruneThread(peer, retention)
      const list = await loadThread(peer)
      if (!alive) return
      setItems(list)
      setTimeout(scrollToBottom, 0)
    })()

    return () => { alive = false }
  }, [peer, retention])

  // --- connect WS for this thread ---
  useEffect(() => {
    stoppedRef.current = false
    connect(true)
    return () => {
      stoppedRef.current = true
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current!)
      if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current!)
      wsRef.current?.close(1000, 'unmount')
      peerTypingUntilRef.current = 0
      setPeerTyping(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer])

  function connect(initial = false) {
    const token = localStorage.getItem('jwt')
    if (!token) { setErr('No JWT found'); setStatus('offline'); return }

    const myId = ++connIdRef.current
    setStatus(initial ? 'connecting' : 'reconnecting')
    setErr(null)

    const ws = API.ws(token)
    wsRef.current = ws

    ws.onopen = () => {
      if (myId !== connIdRef.current) return
      setStatus('online')
      reconnectAttemptsRef.current = 0
    }

    ws.onmessage = async (ev) => {
      if (myId !== connIdRef.current) return

      let env: any
      try { env = JSON.parse(ev.data) } catch { return }

      // ---- delivery ACK ----
      if (env.type === 'delivered') {
        if (env.clientMsgId) {
          setItems(x => x.map(m => m.id === env.clientMsgId ? { ...m, delivered: true } : m))
          await markDelivered(env.clientMsgId)
        }
        return
      }

      // only handle messages relevant to this thread
      if (!(env.from === peer || env.from === '(offline)' || env.from == null)) return

      try {
        const plain = await decryptFrom(peer, env.ciphertext)
        const txt = dec(plain)

        // ---- control messages ----
        try {
          const obj = JSON.parse(txt)
          if (obj?.type === 'ctrl') {
            if (obj.action === 'peer-cleared') {
              const when = obj.at ? new Date(obj.at).toLocaleString() : 'now'
              peerTypingUntilRef.current = 0
              setPeerTyping(false)
              const sys = makeSystem(`Peer cleared their local chat (${when}).`)
              setItems(x => [...x, sys])
              await saveMessage({ id: sys.id, peer, text: sys.text, mine: false, system: true, ts: sys.ts! })
              scrollToBottom()
              return
            }
            if (obj.action === 'typing') {
              if (settings.showTyping) {
                if (obj.state === 'start') {
                  // extend deadline
                  peerTypingUntilRef.current = Date.now() + 3500
                } else {
                  peerTypingUntilRef.current = 0
                }
              }
              return
            }
          }
        } catch { /* not JSON → treat as normal text */ }

        // ---- normal incoming message ----
        peerTypingUntilRef.current = 0
        setPeerTyping(false)

        const msg: Msg = { id: env.id, text: txt, mine: false, ts: Date.now() }
        setItems(x => [...x, msg])
        await saveMessage({ id: env.id, peer, text: txt, mine: false, ts: msg.ts! })
        scrollToBottom()
        await pruneThread(peer, retention)
      } catch (e) {
        console.warn('Failed to decrypt', e)
      }
    }

    ws.onclose = (ev) => {
      if (myId !== connIdRef.current || stoppedRef.current) return
      if (ev.code === 1000 && (ev as any).reason === 'unmount') return

      // reset typing on close
      peerTypingUntilRef.current = 0
      setPeerTyping(false)

      if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        setStatus('offline')
        setErr('Connection failed. Refresh to retry.')
        return
      }
      reconnectAttemptsRef.current++
      setStatus('reconnecting')
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 10000)
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (!stoppedRef.current && myId === connIdRef.current) connect()
      }, delay)
    }

    ws.onerror = () => { /* handled in onclose */ }
  }

  // --- typing send/throttle helpers ---
  function sendTyping(state: 'start' | 'stop') {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (state === 'start') {
      const now = Date.now()
      if (now - lastTypingSentRef.current < 2000) return // throttle 2s
      lastTypingSentRef.current = now
    }
    const payload = { action: 'typing', state, at: Date.now() }
    sendControl(ws, peer, payload).catch(() => {})
  }

  function noteTyping() {
    if (!settings.sendTyping) return
    sendTyping('start')
    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current)
    typingStopTimerRef.current = window.setTimeout(() => sendTyping('stop'), 3000) // 3s idle
  }

  // --- send message ---
  async function send(e: React.FormEvent) {
    e.preventDefault()
    const ws = wsRef.current
    if (!text.trim() || !ws || ws.readyState !== WebSocket.OPEN) return

    const clientMsgId = genId()
    let ct: string
    try {
      ct = await encryptFor(peer, enc(text))
    } catch (err) {
      const msg = (err as Error).message || String(err)
      setErr(`Cannot send: ${msg}`)
      return
    }

    if (settings.sendTyping) sendTyping('stop')
    ws.send(JSON.stringify({ to: peer, ciphertext: ct, contentType: 'msg', clientMsgId }))

    const now = Date.now()
    const mine: Msg = { id: clientMsgId, text, mine: true, delivered: false, ts: now }
    setItems(x => [...x, mine])
    await saveMessage({ id: clientMsgId, peer, text, mine: true, delivered: false, ts: now })
    setText('')
    setTimeout(scrollToBottom, 0)
    await pruneThread(peer, retention)
  }

  // --- clear helpers ---
  async function clearThread() {
    if (!confirm('Clear ALL messages in this chat on this device? This cannot be undone.')) return
    await dbClearThread(peer)
    setItems([])

    if (settings.notifyOnClear && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      await sendControl(wsRef.current, peer, { action: 'peer-cleared', at: Date.now() })
      const sys = makeSystem('You cleared this chat (peer notified).')
      setItems([sys])
      await saveMessage({ id: sys.id, peer, text: sys.text, mine: false, system: true, ts: sys.ts! })
    }
  }

  async function clearAll() {
  if (!confirm('Clear ALL chats on THIS device only? No peers will be notified. This cannot be undone.')) return
  await dbClearAll()
  setItems([])
}


  return {
    items, setItems,
    text, setText,
    status, err,
    retention,
    setRetention: (d: number) => { setRetention(d); setRetentionDays(d) },
    listRef,
    send,
    clearThread,
    clearAll,
    peerTyping,
    settings,
    toggleSetting: (patch: Partial<Settings>) => setSettings(patchSettings(patch)),
    noteTyping,
  }
}
