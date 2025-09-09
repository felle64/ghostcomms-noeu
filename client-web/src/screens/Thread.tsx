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
  const retriesRef = useRef(0)
  const openedOnceRef = useRef(false)
  const stopRef = useRef(false)

  useEffect(() => {
    stopRef.current = false
    connect()
    return () => { stopRef.current = true; wsRef.current?.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer])

  function connect() {
    const token = localStorage.getItem('jwt')
    if (!token) { setErr('No JWT found (re-register).'); setStatus('offline'); return }
    setStatus(openedOnceRef.current ? 'reconnecting' : 'connecting')
    setErr(null)

    const ws = API.ws(token)
    wsRef.current = ws

    ws.onopen = () => {
      openedOnceRef.current = true
      retriesRef.current = 0
      setStatus('online')
    }

    ws.onmessage = async (ev) => {
      try {
        const env = JSON.parse(ev.data)
        if (env.from === peer) {
          const plain = await decryptFrom(peer, env.ciphertext)
          setItems(x => [...x, { id: env.id, text: new TextDecoder().decode(plain) }])
        }
      } catch {}
    }

    ws.onerror = () => {
      // don’t spam UI; onclose will handle retries
    }

    ws.onclose = (ev) => {
      if (stopRef.current) return
      // 1000/1001/1006 during HMR or transient network -> retry
      const transient = [1000,1001,1006].includes(ev.code)
      if (transient && retriesRef.current < 5) {
        const backoff = Math.min(1000 * Math.pow(2, retriesRef.current), 8000)
        retriesRef.current += 1
        setStatus('reconnecting')
        setTimeout(connect, backoff)
        return
      }
      setStatus('offline')
      setErr(`WebSocket closed (${ev.code}) ${ev.reason || ''}`.trim())
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const ct = await encryptFor(peer, new TextEncoder().encode(text))
    wsRef.current.send(JSON.stringify({ to: peer, ciphertext: ct, contentType: 'msg' }))
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
