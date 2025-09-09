import { useEffect, useState } from 'react'
import Thread from './screens/Thread'
import Chats from './screens/Chats'
import QRAdd from './screens/QRAdd'

// Prefer env; fallback to common dev origin swap (5173 -> 8080)
const API_BASE =
  (import.meta as any).env?.VITE_API_URL ??
  (location.origin.includes(':5173')
    ? location.origin.replace(':5173', ':8080')
    : location.origin)

export default function App() {
  const [self, setSelf] = useState<string | null>(localStorage.getItem('deviceId'))
  const [peer, setPeer] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [booting, setBooting] = useState<boolean>(!self)

  useEffect(() => {
    if (!self) {
      bootstrap()
        .then((did) => { setSelf(did); setBooting(false) })
        .catch((e) => { setErr(String(e?.message || e)); setBooting(false) })
    }
  }, [self])

  if (booting) return <div className="p-6">Setting up device…</div>
  if (err) return (
    <div className="p-6 space-y-2">
      <div className="text-red-600 font-medium">Failed to set up device</div>
      <pre className="text-sm whitespace-pre-wrap">{err}</pre>
      <div className="text-sm opacity-70">Check VITE_API_URL and server CORS, then refresh.</div>
    </div>
  )
  if (!self) return <div className="p-6">Couldn’t get a device ID. Refresh after fixing errors above.</div>

  if (peer) return <Thread self={self} peer={peer} onBack={() => setPeer(null)} />
  return <Chats onOpen={setPeer} />
}

async function bootstrap(): Promise<string> {
  const dummy = btoa('dummy-key')
  const res = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityKeyPubB64: dummy,
      signedPrekeyPubB64: dummy,
      oneTimePrekeysB64: [dummy],
    }),
  })
  if (!res.ok) throw new Error(`POST /register ${res.status} ${res.statusText} — ${await res.text().catch(()=> '')}`)
  const data = await res.json()
  if (!data?.jwt || !data?.deviceId) throw new Error(`Bad /register payload: ${JSON.stringify(data)}`)
  localStorage.setItem('jwt', data.jwt)
  localStorage.setItem('deviceId', data.deviceId)
  return data.deviceId as string
}
