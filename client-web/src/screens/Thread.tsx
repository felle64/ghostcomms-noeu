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
  const connIdRef = useRef(0)        // identify the "current" socket
  const stoppedRef = useRef(false)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const maxReconnectAttempts = 5

  useEffect(() => {
    stoppedRef.current = false
    connect(true)
    return () => { 
      stoppedRef.current = true
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      wsRef.current?.close() 
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
      if (myId !== connIdRef.current) return  // stale
      setStatus('online')
      reconnectAttemptsRef.current = 0 // Reset attempts on successful connection
      console.log('WS: Connected successfully')
    }

    ws.onmessage = async (ev) => {
      if (myId !== connIdRef.current) return
      try {
        const env = JSON.parse(ev.data)
        if (env.from === peer) {
          const plain = await decryptFrom(peer, env.ciphertext)
          setItems(x => [...x, { id: env.id, text: new TextDecoder().decode(plain) }])
        }
      } catch (e) {
        console.warn('Failed to process message:', e)
      }
    }

    ws.onclose = (ev) => {
      console.log('WS: Connection closed', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean })
      
      if (myId !== connIdRef.current || stoppedRef.current) return
      
      // Check if we've exceeded max reconnection attempts
      if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        console.log('Max reconnection attempts reached, giving up')
        setStatus('offline')
        setErr('Connection failed. Please refresh to try again.')
        return
      }
      
      // Handle different close codes
      if (ev.code === 1000) {
        // Normal closure - check if it was intentional
        const reasonStr = ev.reason ? new TextDecoder().decode(ev.reason as any) : ''
        console.log('Normal close with reason:', reasonStr)
        
        if (reasonStr === 'replaced') {
          console.log('Connection was replaced by another, not reconnecting')
          return
        }
      }
      
      // For code 1006 (abnormal closure) or other unexpected closes, attempt reconnection
      reconnectAttemptsRef.current++
      setStatus('reconnecting')
      
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 10000) // Exponential backoff, max 10s
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`)
      
      reconnectTimeoutRef.current = setTimeout(() => {
        if (!stoppedRef.current && myId === connIdRef.current) {
          console.log('Attempting to reconnect...')
          connect()
        }
      }, delay)
    }

    ws.onerror = (error) => {
      console.warn('WS: Error occurred', error)
      // Don't set error status here, let onclose handle it
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const ws = wsRef.current
    if (!text.trim() || !ws || ws.readyState !== WebSocket.OPEN) return
    
    try {
      const ct = await encryptFor(peer, new TextEncoder().encode(text))
      ws.send(JSON.stringify({ to: peer, ciphertext: ct, contentType: 'msg' }))
      setItems(x => [...x, { id: crypto.randomUUID(), text, mine: true }])
      setText('')
    } catch (error) {
      console.error('Failed to send message:', error)
      setErr('Failed to send message')
    }
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
          <div key={m.id} style={{maxWidth:'80%', margin: m.mine? '8px 0 8px auto':'8px 0', padding:8, borderRadius:16, boxShadow:'0 1px 3px rgba(0,0,0,.12)', backgroundColor: m.mine ? '#007AFF' : '#E5E5EA', color: m.mine ? 'white' : 'black'}}>
            {m.text}
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