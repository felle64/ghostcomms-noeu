export default function Composer({
  value, setValue, disabled, onSend, onTyping
}:{
  value: string
  setValue: (s: string) => void
  disabled: boolean
  onSend: (e: React.FormEvent) => void
  onTyping?: () => void
}) {
  return (
    <form onSubmit={onSend} className="composer">
      <input
        value={value}
        onChange={e => { setValue(e.target.value); onTyping?.() }}
        placeholder="Message"
      />
      <button disabled={disabled} type="submit">Send</button>
    </form>
  )
}
