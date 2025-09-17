import type { RefObject } from 'react'
import type { Msg } from './useThread'

export default function MessageList({
  listRef, items
}:{
  listRef: RefObject<HTMLDivElement>
  items: Msg[]
}) {
  return (
    <div ref={listRef} className="messages">
      {items.map(m => (
        m.system ? (
          <div key={m.id} className="system">{m.text}</div>
        ) : (
          <div key={m.id} className={`bubble ${m.mine ? 'mine' : 'other'}`}>
            <span>{m.text}</span>
            {m.mine && (
              <small style={{ opacity:.75, marginLeft:6 }}>
                {m.delivered ? '✓' : '…'}
              </small>
            )}
          </div>
        )
      ))}
    </div>
  )
}
