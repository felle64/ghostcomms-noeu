import { useEffect, useRef, useState } from 'react'
import { API } from '../api'
import { encryptFor, decryptFrom } from '../crypto/signal'
import {
  loadThread, saveMessage, markDelivered,
  clearThread, clearAll, getRetentionDays, setRetentionDays, pruneThread
} from '../storage/db'

type Msg = { id: string; text: string; mine?: boolean; delivered?: boolean; ts?: number }

export default function Thread({ self, peer, onBack }:{
  self:string; peer:string; onBack:()=>void
}) {
  const [items, setItems] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle'|'connecting'|'online'|'reconnecting'|'offline'>('idle')
  const [retention, setRetention] = useState<number>(getRetentionDays())

  const wsRef = useRef<WebSocket | null>(null)
  const connIdRef = useRef(0)
  const stoppedRef = useRef(false)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const maxReconnectAttempts = 5
  const listRef = useRef<HTMLDivElement | null>(null)

  // --- utils ---
  function genId(): string {
    const c = (globalThis as any).crypto
    if (c?.randomUUID) return c.randomUUID()
    const buf = new Uint8Array(16)
    if (c?.getRandomValues) c.getRandomValues(buf)
    else for (let i = 0; i < 16; i++) buf[i] = (Math.random() * 256) | 0
    buf[6] = (buf[6] & 0x0f) | 0x40
    buf[8] = (buf[8] & 0x3f) | 0x80
    const h = Array.from(buf, b => b.toString(16).padStart(2, '0'))
    return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10).join('')}`
  }
  const scrollToBottom = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // --- load + prune on open ---
  useEffect(() => {
    let alive = true
    ;(async () => {
      await pruneThread(peer, retention) // auto-prune this thread based on setting
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
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current)
      wsRef.current?.close(1000, 'unmount')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer])

  function connect(initial=false) {
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
      console.log('WS: Connected successfully')
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

      // ---- incoming/backlog ----
      if (env.from === peer || env.from === '(offline)' || env.from == null) {
        try {
          const plain = await decryptFrom(peer, env.ciphertext)
          const txt = new TextDecoder().decode(plain)
          const msg: Msg = { id: env.id, text: txt, mine: false, ts: Date.now() }
          setItems(x => [...x, msg])
          await saveMessage({ id: env.id, peer, text: txt, mine: false, ts: msg.ts! })
          scrollToBottom()
          // prune opportunistically after receive
          await pruneThread(peer, retention)
        } catch (e) {
          console.warn('Failed to decrypt message', e)
        }
      }
    }

    ws.onclose = (ev) => {
      console.log('WS: Connection closed', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean })
      if (myId !== connIdRef.current || stoppedRef.current) return
      if (ev.code === 1000 && (ev as any).reason === 'unmount') return

      if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        setStatus('offline'); setErr('Connection failed. Please refresh to try again.'); return
      }
      reconnectAttemptsRef.current++
      setStatus('reconnecting')
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 10000)
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (!stoppedRef.current && myId === connIdRef.current) connect()
      }, delay)
    }

    ws.onerror = (error) => {
      console.warn('WS: Error', error)
    }
  }

  // --- send ---
  async function send(e: React.FormEvent) {
    e.preventDefault()
    const ws = wsRef.current
    if (!text.trim() || !ws || ws.readyState !== WebSocket.OPEN) return

    const clientMsgId = genId()
    const ct = await encryptFor(peer, new TextEncoder().encode(text))

    ws.send(JSON.stringify({
      to: peer,
      ciphertext: ct,
      contentType: 'msg',
      clientMsgId,
    }))

    const now = Date.now()
    const mine: Msg = { id: clientMsgId, text, mine: true, delivered: false, ts: now }
    setItems(x => [...x, mine])
    await saveMessage({ id: clientMsgId, peer, text, mine: true, delivered: false, ts: now })
    setText('')
    scrollToBottom()
    await pruneThread(peer, retention)
  }

  // --- UI actions ---
  async function onClearThread() {
    if (!confirm('Clear ALL messages in this chat on this device? This cannot be undone.')) return
    await clearThread(peer)
    setItems([])
  }
  async function onClearAll() {
    if (!confirm('Clear ALL chats and messages on this device? This cannot be undone.')) return
    await clearAll()
    setItems([])
  }
  function onChangeRetention(e: React.ChangeEvent<HTMLSelectElement>) {
    const days = Number(e.target.value)
    setRetention(days)
    setRetentionDays(days)
  }

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100vh'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, padding:8, borderBottom:'1px solid #eee', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <button onClick={onBack}>←</button>
          <div>Chat with {peer.slice(0,8)}… <small style={{opacity:.6, marginLeft:8}}>{status}</small></div>
        </div>

        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <label style={{fontSize:12, opacity:.7}}>Auto-prune:</label>
          <select value={retention} onChange={onChangeRetention}>
            <option value={0}>Keep forever</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>365 days</option>
          </select>
          <button onClick={onClearThread} title="Clear only this chat">Clear chat</button>
          <button onClick={onClearAll} title="Clear ALL chats">Clear all</button>
        </div>
      </div>

      {err && <div style={{padding:8, color:'#b91c1c'}}>⚠ {err}</div>}

      <div
        ref={listRef}
        style={{
          flex:1, overflowY:'auto', padding:12,
          display:'flex', flexDirection:'column', gap:8
        }}
      >
        {items.map(m => (
          <div
            key={m.id}
            style={{
              maxWidth:'80%',
              padding:'8px 12px',
              borderRadius:16,
              boxShadow:'0 1px 3px rgba(0,0,0,.12)',
              backgroundColor: m.mine ? '#007AFF' : '#E5E5EA',
              color: m.mine ? 'white' : 'black',
              display:'flex',
              alignSelf: m.mine ? 'flex-end' : 'flex-start',
              whiteSpace:'pre-wrap',
              wordBreak:'break-word'
            }}
          >
            <span>{m.text}</span>
            {m.mine && <small style={{ opacity:.7, marginLeft:6 }}>{m.delivered ? '✓' : '…'}</small>}
          </div>
        ))}
      </div>

      <form onSubmit={send} style={{display:'flex', gap:8, padding:8}}>
        <input
          value={text}
          onChange={e=>setText(e.target.value)}
          placeholder="Message"
          style={{flex:1, padding:10, border:'1px solid #ccc', borderRadius:12}}
        />
        <button disabled={status!=='online'} type="submit">Send</button>
      </form>
    </div>
  )
}
