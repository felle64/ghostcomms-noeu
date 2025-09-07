import { useEffect, useRef, useState } from 'react'
import { API } from '../api'
import { encryptFor, decryptFrom } from '../crypto/signal'

export default function Thread({ self, peer, onBack }:{ self:string; peer:string; onBack:()=>void }){
  const [items, setItems] = useState<{id:string; text:string; mine?:boolean}[]>([])
  const [text, setText] = useState('')
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const jwt = localStorage.getItem('jwt')!
    const ws = API.ws(jwt)
    ws.onmessage = async (ev) => {
      const env = JSON.parse(ev.data)
      if (env.from === peer) {
        const plain = await decryptFrom(peer, env.ciphertext)
        const str = new TextDecoder().decode(plain)
        setItems(x => [...x, { id: env.id, text: str }])
        // Ephemeral: delete locally on read (default behavior)
      }
    }
    wsRef.current = ws
    return () => ws.close()
  }, [peer])

  async function send(ev: React.FormEvent) {
    ev.preventDefault()
    if (!text.trim()) return
    const ct = await encryptFor(peer, new TextEncoder().encode(text))
    wsRef.current?.send(JSON.stringify({ to: peer, ciphertext: ct, contentType: 'msg' }))
    setItems(x => [...x, { id: crypto.randomUUID(), text, mine: true }])
    setText('')
  }

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100vh'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, padding:8, borderBottom:'1px solid #eee'}}>
        <button onClick={onBack}>←</button>
        <div>Chat with {peer.slice(0,8)}…</div>
      </div>
      <div style={{flex:1, overflowY:'auto', padding:12}}>
        {items.map(m => (
          <div key={m.id} style={{maxWidth:'80%', margin: m.mine? '8px 0 8px auto':'8px 0', padding:8, borderRadius:16, boxShadow:'0 1px 3px rgba(0,0,0,.12)'}}>
            {m.text}
          </div>
        ))}
      </div>
      <form onSubmit={send} style={{display:'flex', gap:8, padding:8}}>
        <input value={text} onChange={e=>setText(e.target.value)} placeholder="Message" style={{flex:1, padding:10, borderRadius:12, border:'1px solid #ccc'}} />
        <button>Send</button>
      </form>
    </div>
  )
}
