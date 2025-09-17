import { useEffect, useState } from 'react'
import Thread from './screens/Thread'
import Chats from './screens/Chats'
import { myIdentityPubB64 } from './crypto/signal'
import { API } from './api'

export default function App(){
  const [self, setSelf] = useState<string | null>(localStorage.getItem('deviceId'))
  const [peer, setPeer] = useState<string | null>(null)
  const [bootErr, setBootErr] = useState<string | null>(null)

  useEffect(() => {
    if (!self) {
      bootstrap().then(setSelf).catch((e) => setBootErr(e.message || String(e)))
    }
  }, [self])

  if (!self) {
    return (
      <div className="p-6">
        <div>Setting up device…</div>
        {bootErr && (
          <pre style={{color:'#b91c1c', whiteSpace:'pre-wrap', marginTop:12}}>
            {bootErr}
          </pre>
        )}
      </div>
    )
  }
  if (peer) return <Thread self={self} peer={peer} onBack={()=>setPeer(null)} />
  return <Chats onOpen={setPeer} />
}

async function bootstrap(): Promise<string> {
  const idPub = myIdentityPubB64()

  const res = await fetch(API.url('/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      identityKeyPubB64: idPub,
      // we reuse idPub as signedPrekey just for the MVP
      signedPrekeyPubB64: idPub,
      oneTimePrekeysB64: []
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(()=>'')
    throw new Error(`register failed: ${res.status} ${body.slice(0,120)}`)
  }

  let data: any
  try { data = await res.json() } catch (e) {
    const body = await res.text().catch(()=> '')
    throw new Error(`register parse failed: ${(e as Error).message} :: ${body.slice(0,120)}`)
  }

  if (!data?.deviceId || !data?.jwt) throw new Error('register response missing deviceId/jwt')

  localStorage.setItem('jwt', data.jwt)
  localStorage.setItem('deviceId', data.deviceId)
  return data.deviceId as string
}
