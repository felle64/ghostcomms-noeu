export default function Composer({
  value, setValue, disabled, onSend
}:{
  value: string
  setValue: (s: string) => void
  disabled: boolean
  onSend: (e: React.FormEvent) => void
}) {
  return (
    <form onSubmit={onSend} style={{display:'flex', gap:8, padding:8}}>
      <input
        value={value}
        onChange={e=>setValue(e.target.value)}
        placeholder="Message"
        style={{flex:1, padding:10, border:'1px solid #ccc', borderRadius:12}}
      />
      <button disabled={disabled} type="submit">Send</button>
    </form>
  )
}
