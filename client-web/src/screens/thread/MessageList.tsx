import type { Msg } from './useThread'
import { RefObject } from 'react'

export default function MessageList({ listRef, items }: {
  listRef: React.RefObject<HTMLDivElement | null>
  items: Msg[]
}) {
  return (
    <div
      ref={listRef}
      style={{ flex:1, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:8 }}
    >
      {items.map(m => (
        m.system ? (
          <div key={m.id} style={{ alignSelf:'center', opacity:.6, fontSize:12 }}>
            {m.text}
          </div>
        ) : (
          <div
            key={m.id}
            style={{
              maxWidth:'80%',
              padding:'8px 12px',
              borderRadius:16,
              boxShadow:'0 1px 3px rgba(0,0,0,.12)',
              backgroundColor: m.mine ? '#007AFF' : '#E5E5EA',
              color: m.mine ? 'white' : 'black',
              display:'flex',
              alignSelf: m.mine ? 'flex-end' : 'flex-start',
              whiteSpace:'pre-wrap',
              wordBreak:'break-word'
            }}
          >
            <span>{m.text}</span>
            {m.mine && <small style={{ opacity:.7, marginLeft:6 }}>{m.delivered ? '✓' : '…'}</small>}
          </div>
        )
      ))}
    </div>
  )
}
