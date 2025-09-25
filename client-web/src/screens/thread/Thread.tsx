import Header from './Header'
import MessageList from './MessageList'
import Composer from './Composer'
import { useThread } from './useThread'

export default function Thread({ self, peer, onBack }:{
  self: string; 
  peer: string;  // This is now a username
  onBack: () => void
}) {
  const t = useThread({ self, peer })

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100vh'}}>
      <Header
        peer={peer}
        status={t.status}
        retention={t.retention}
        setRetention={t.setRetention}
        onBack={onBack}
        onClearThread={t.clearThread}
        onClearAll={t.clearAll}
        peerTyping={t.peerTyping}
        settings={t.settings}
        onToggle={t.toggleSetting}
      />

      {t.err && <div style={{padding:8, color:'#b91c1c'}}>⚠ {t.err}</div>}

      <MessageList listRef={t.listRef} items={t.items} />

      <Composer
        value={t.text}
        setValue={t.setText}
        disabled={t.status !== 'online'}
        onSend={t.send}
        onTyping={t.noteTyping}
      />
    </div>
  )
}