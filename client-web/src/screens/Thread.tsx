import { useEffect, useRef, useState } from 'react'
import { API } from '../api'
import { encryptFor, decryptFrom } from '../crypto/signal'

type Msg = { id: string; text: string; mine?: boolean; delivered?: boolean }

export default function Thread({ self, peer, onBack }:{
  self:string; peer:string; onBack:()=>void
}) {
  const [items, setItems] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle'|'connecting'|'online'|'reconnecting'|'offline'>('idle')

  const wsRef = useRef<WebSocket | null>(null)
  const connIdRef = useRef(0)            // identify the “current” socket
  const stoppedRef = useRef(false)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const maxReconnectAttempts = 5

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

  function genId(): string {
  const c = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID()

  // Fallback: RFC4122 v4 using getRandomValues (or Math.random if needed)
  const buf = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(buf)
  else for (let i = 0; i < 16; i++) buf[i] = (Math.random() * 256) | 0

  buf[6] = (buf[6] & 0x0f) | 0x40  // version 4
  buf[8] = (buf[8] & 0x3f) | 0x80  // variant

  const h = Array.from(buf, b => b.toString(16).padStart(2, '0'))
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10).join('')}`
}


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

    // 🔽 THIS is the onmessage you asked about
    ws.onmessage = async (ev) => {
      if (myId !== connIdRef.current) return
      let env: any
      try { env = JSON.parse(ev.data) } catch { return }
      

      // Server ACK → flip ✓ on our bubble
      if (env.type === 'delivered') {
        if (env.clientMsgId) {
          setItems(x => x.map(m => m.id === env.clientMsgId ? { ...m, delivered: true } : m))
        }
        return
      }

      // Normal incoming message
      if (env.from === peer) {
        try {
          const plain = await decryptFrom(peer, env.ciphertext)
          setItems(x => [...x, { id: env.id, text: new TextDecoder().decode(plain) }])
        } catch (e) {
          console.warn('Failed to decrypt message', e)
        }
      }
    }

    ws.onclose = (ev) => {
      console.log('WS: Connection closed', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean })
      if (myId !== connIdRef.current || stoppedRef.current) return

      // normal intentional close we triggered
      if (ev.code === 1000 && (ev as any).reason === 'unmount') return

      if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        setStatus('offline')
        setErr('Connection failed. Please refresh to try again.')
        return
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
      // onclose will handle retry
    }
  }

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
      clientMsgId,                 // <-- lets the server ACK target this bubble
    }))

    setItems(x => [...x, { id: clientMsgId, text, mine: true, delivered: false }])
    setText('')
  }

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100vh'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, padding:8, borderBottom:'1px solid #eee'}}>
        <button onClick={onBack}>←</button>
        <div>Chat with {peer.slice(0,8)}… <small style={{opacity:.6, marginLeft:8}}>{status}</small></div>
      </div>

      {err && <div style={{padding:8, color:'#b91c1c'}}>⚠ {err}</div>}

      <div style={{flex:1, overflowY:'auto', padding:12}}>
        {items.map(m => (
          <div
            key={m.id}
            style={{
            maxWidth: '80%',
            padding: '8px 12px',
            borderRadius: 16,
            boxShadow: '0 1px 3px rgba(0,0,0,.12)',
            backgroundColor: m.mine ? '#007AFF' : '#E5E5EA',
            color: m.mine ? 'white' : 'black',
            display: 'flex',                         // was: inline-flex
            alignSelf: m.mine ? 'flex-end' : 'flex-start',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            // margin no longer needed; flex handles placement
  }}
>
  <span>{m.text}</span>
  {m.mine && <small style={{ opacity: .7, marginLeft: 6 }}>{m.delivered ? '✓' : '…'}</small>}
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
