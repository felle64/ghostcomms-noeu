import { useEffect, useState } from 'react'

type Props = { onOpen: (peerId: string) => void }

export default function Chats({ onOpen }: Props) {
  const [peer, setPeer] = useState('')
  const [myId, setMyId] = useState<string>('')
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('peers') || '[]') } catch { return [] }
  })

  useEffect(() => {
    const id = localStorage.getItem('deviceId') || ''
    setMyId(id)
  }, [])

  function openPeer(id: string) {
    const p = id.trim()
    if (!p) return
    // save recent (dedupe + cap 8)
    const next = [p, ...recent.filter(x => x !== p)].slice(0, 8)
    setRecent(next)
    localStorage.setItem('peers', JSON.stringify(next))
    onOpen(p)
  }

  async function copyMyId() {
    if (!myId) return
    try { await navigator.clipboard.writeText(myId) } catch {}
  }

  async function pastePeer() {
    try {
      const t = await navigator.clipboard.readText()
      if (t) setPeer(t.trim())
    } catch {}
  }

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 8 }}>GhostComms • NoEU</h2>

      <div style={{
        display: 'flex', gap: 8, alignItems: 'center',
        padding: 12, border: '1px solid #eee', borderRadius: 12, marginBottom: 16
      }}>
        <div style={{ fontSize: 12, opacity: .8 }}>Your deviceId</div>
        <code style={{
          userSelect: 'all', padding: '6px 8px', borderRadius: 8,
          background: '#f6f6f6', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis'
        }}>
          {myId || '—'}
        </code>
        <button onClick={copyMyId} disabled={!myId}>Copy</button>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); openPeer(peer) }}
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
      >
        <input
          value={peer}
          onChange={(e) => setPeer(e.target.value)}
          placeholder="Peer deviceId"
          style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', flex: 1 }}
        />
        <button type="button" onClick={pastePeer}>Paste</button>
        <button type="submit">Open</button>
      </form>

      {recent.length > 0 && (
        <div>
          <div style={{ fontSize: 12, opacity: .8, marginBottom: 8 }}>Recent</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {recent.map(id => (
              <button
                key={id}
                onClick={() => openPeer(id)}
                style={{
                  textAlign: 'left', padding: 10, borderRadius: 8,
                  border: '1px solid #eee', background: '#fff'
                }}
                title={id}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
