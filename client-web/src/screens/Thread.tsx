import { useEffect, useRef, useState } from 'react'
import { API } from '../api'
import { encryptFor, decryptFrom } from '../crypto/signal'

export default function Thread({ self, peer, onBack }:{
  self:string; peer:string; onBack:()=>void
}) {
  const [items, setItems] = useState<{id:string; text:string; mine?:boolean}[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle'|'connecting'|'online'|'reconnecting'|'offline'>('idle')
  const wsRef = useRef<WebSocket | null>(null)
  const connectingRef = useRef(false)
  const stoppedRef = useRef(false)

  useEffect(() => {
    stoppedRef.current = false
    ensureConnected(true)
    return () => { stoppedRef.current = true; wsRef.current?.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer])

  function ensureConnected(initial=false) {
    if (stoppedRef.current) return
    const ws = wsRef.current
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    if (connectingRef.current) return
    connectingRef.current = true

    const token = localStorage.getItem('jwt')
    if (!token) { setErr('No JWT found — refresh to re-register'); setStatus('offline'); connectingRef.current = false; return }

    setStatus(initial ? 'connecting' : 'reconnecting')
    setErr(null)

    const next = API.ws(token)
    wsRef.current = next

    next.onopen = () => {
      connectingRef.current = false
      setStatus('online')
    }
    next.onmessage = async (ev) => {
      try {
        const env = JSON.parse(ev.data)
        if (env.from === peer) {
          const plain = await decryptFrom(peer, env.ciphertext)
          setItems(x => [...x, { id: env.id, text: new TextDecoder().decode(plain) }])
        }
      } catch {}
    }
    next.onerror = () => { /* noisy; rely on onclose */ }
    next.onclose = () => {
      connectingRef.current = false
      if (stoppedRef.current) return
      setStatus('reconnecting')
      setTimeout(() => ensureConnected(), 800)
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const ws = wsRef.current
    if (!text.trim() || !ws || ws.readyState !== WebSocket.OPEN) return
    const ct = await encryptFor(peer, new TextEncoder().encode(text))
    ws.send(JSON.stringify({ to: peer, ciphertext: ct, contentType: 'msg' }))
    setItems(x => [...x, { id: crypto.randomUUID(), text, mine: true }])
    setText('')
  }

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100vh'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, padding:8, borderBottom:'1px solid #eee'}}>
        <button onClick={onBack}>←</button>
        <div>Chat with {peer.slice(0,8)}… <small style={{opacity:.6, marginLeft:8}}>{status}</small></div>
      </div>
      {err && status === 'offline' && <div style={{padding:8, color:'#b91c1c'}}>⚠ {err}</div>}
      <div style={{flex:1, overflowY:'auto', padding:12}}>
        {items.map(m => (
          <div key={m.id} style={{maxWidth:'80%', margin: m.mine? '8px 0 8px auto':'8px 0', padding:8, borderRadius:16, boxShadow:'0 1px 3px rgba(0,0,0,.12)'}}>
            {m.text}
          </div>
        ))}
      </div>
      <form onSubmit={send} style={{display:'flex', gap:8, padding:8}}>
        <input value={text} onChange={e=>setText(e.target.value)} placeholder="Message" style={{flex:1, padding:10, border:'1px solid #ccc', borderRadius:12}} />
        <button disabled={status!=='online'}>Send</button>
      </form>
    </div>
  )
}
