import { useEffect } from 'react'
import type { Settings } from '../../storage/settings'

export default function Header({
  peer, status, retention, setRetention, onBack, onClearThread, onClearAll,
  peerTyping, settings, onToggle
}:{
  peer: string
  status: 'idle'|'connecting'|'online'|'reconnecting'|'offline'
  retention: number
  setRetention: (d: number) => void
  onBack: () => void
  onClearThread: () => void
  onClearAll: () => void
  peerTyping: boolean
  settings: Pick<Settings,'sendTyping'|'notifyOnClear'> & { showTyping?: boolean }
  onToggle: (patch: Partial<Settings>) => void
}) {
  // Always show peer activity indicator (we only toggle whether we SEND it)
  useEffect(() => {
    if ((settings as any).showTyping === false) onToggle({ showTyping: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keyboard shortcut: Esc to go back
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  return (
    <div className="header">
      <div className="left">
        <button className="backbtn" onClick={onBack} aria-label="Back">
          {/* Arrow icon (inline SVG) */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="label">Back</span>
        </button>

        <div className="title">
        Chat with @{peer}
          <small>{peerTyping ? 'typing…' : status}</small>
      </div>
      </div>

      <div className="toolbar">
        {/* iOS-style toggles */}
        <label className="ios-switch" title="Show the other side that you are active (typing)">
          <input
            type="checkbox"
            checked={!!settings.sendTyping}
            onChange={e => onToggle({ sendTyping: e.target.checked })}
            aria-label="Show activity"
          />
          <span className="track" aria-hidden="true"></span>
          <span className="toggle-text">Show activity</span>
        </label>

        <label className="ios-switch" title="Notify peer when you clear this chat">
          <input
            type="checkbox"
            checked={!!settings.notifyOnClear}
            onChange={e => onToggle({ notifyOnClear: e.target.checked })}
            aria-label="Notify on clear"
          />
          <span className="track" aria-hidden="true"></span>
          <span className="toggle-text">Notify on clear</span>
        </label>

        <span style={{color:'var(--muted)', fontSize:12}}>Auto-prune:</span>
        <select value={retention} onChange={e => setRetention(Number(e.target.value))}>
          <option value={0}>Keep forever</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={365}>365 days</option>
        </select>

        <button onClick={onClearThread} title="Clear only this chat">Clear chat</button>
        <button
  onClick={onClearAll}
  title="Clears all chats on this device only — no notifications are sent."
>
  Clear all (local)
</button>

      </div>
    </div>
  )
}
