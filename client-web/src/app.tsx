import { useEffect, useState } from 'react'
import Thread from './screens/Thread'
import Chats from './screens/Chats'
import QRAdd from './screens/QRAdd'

export default function App(){
  const [self, setSelf] = useState<string | null>(localStorage.getItem('deviceId'))
  const [peer, setPeer] = useState<string | null>(null)

  useEffect(() => { if (!self) bootstrap().then(setSelf) }, [self])

  if (!self) return <div className="p-6">Setting up device…</div>
  if (peer) return <Thread self={self} peer={peer} onBack={()=>setPeer(null)} />
  return <Chats onOpen={setPeer} />
}

async function bootstrap(): Promise<string> {
  // Placeholder: generate mock keys and register
  const dummy = btoa('dummy-key')
  const res = await fetch(import.meta.env.VITE_API_URL + '/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityKeyPubB64: dummy,
      signedPrekeyPubB64: dummy,
      oneTimePrekeysB64: [dummy]
    })
  })
  const data = await res.json()
  localStorage.setItem('jwt', data.jwt)
  localStorage.setItem('deviceId', data.deviceId)
  return data.deviceId as string
}
