export default function Header({
  peer, status, retention, setRetention, onBack, onClearThread, onClearAll
}:{
  peer: string
  status: 'idle'|'connecting'|'online'|'reconnecting'|'offline'
  retention: number
  setRetention: (d: number) => void
  onBack: () => void
  onClearThread: () => void
  onClearAll: () => void
}) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:8, padding:8,
      borderBottom:'1px solid #eee', justifyContent:'space-between'
    }}>
      <div style={{display:'flex', alignItems:'center', gap:8}}>
        <button onClick={onBack}>←</button>
        <div>Chat with {peer.slice(0,8)}… <small style={{opacity:.6, marginLeft:8}}>{status}</small></div>
      </div>

      <div style={{display:'flex', alignItems:'center', gap:8}}>
        <label style={{fontSize:12, opacity:.7}}>Auto-prune:</label>
        <select value={retention} onChange={(e)=>setRetention(Number(e.target.value))}>
          <option value={0}>Keep forever</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={365}>365 days</option>
        </select>
        <button onClick={onClearThread} title="Clear only this chat">Clear chat</button>
        <button onClick={onClearAll} title="Clear ALL chats">Clear all</button>
      </div>
    </div>
  )
}
