import { useEffect, useState } from 'react'
import { API } from '../api'

type Props = { 
  user: {
    username: string
    userId: string
    deviceId: string
  }
  onOpen: (peerId: string) => void
  onLogout: () => void
}

type Device = {
  id: string
  deviceName?: string
  lastSeenAt: string
  createdAt: string
}

export default function Chats({ user, onOpen, onLogout }: Props) {
  const [contactUsername, setContactUsername] = useState('')
  const [contacts, setContacts] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('contacts') || '[]') } catch { return [] }
  })
  const [myDevices, setMyDevices] = useState<Device[]>([])
  const [showDevices, setShowDevices] = useState(false)

  useEffect(() => {
    fetchMyDevices()
  }, [])

  const fetchMyDevices = async () => {
    try {
      const jwt = localStorage.getItem('jwt')
      const res = await fetch(API.url('/my-devices'), {
        headers: { Authorization: `Bearer ${jwt}` }
      })
      if (res.ok) {
        const data = await res.json()
        setMyDevices(data.devices)
      }
    } catch (err) {
      console.error('Failed to fetch devices:', err)
    }
  }

  const addContact = async (username: string) => {
    const u = username.toLowerCase().trim()
    if (!u || u === user.username) return

    // Verify user exists
    try {
      const res = await fetch(API.url(`/user/${encodeURIComponent(u)}`))
      if (!res.ok) {
        alert('User not found')
        return
      }
    } catch {
      alert('Failed to add contact')
      return
    }

    // Save contact (dedupe + cap 20)
    const next = [u, ...contacts.filter(x => x !== u)].slice(0, 20)
    setContacts(next)
    localStorage.setItem('contacts', JSON.stringify(next))
    setContactUsername('')
    openChat(u)
  }

  const openChat = (username: string) => {
    onOpen(username)
  }

  const removeDevice = async (deviceId: string) => {
    if (!confirm('Remove this device? It will need to log in again to reconnect.')) return
    
    try {
      const jwt = localStorage.getItem('jwt')
      const res = await fetch(API.url(`/device/${deviceId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${jwt}` }
      })
      
      if (res.ok) {
        await fetchMyDevices()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to remove device')
      }
    } catch (err) {
      alert('Failed to remove device')
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / 86400000)
    
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    return date.toLocaleDateString()
  }

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24
      }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>GhostComms • NoEU</h2>
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>
            Logged in as <strong>{user.username}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button 
            onClick={() => setShowDevices(!showDevices)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--panel)',
              cursor: 'pointer'
            }}
          >
            Devices ({myDevices.length})
          </button>
          <button 
            onClick={onLogout}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--panel)',
              cursor: 'pointer'
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {showDevices && (
        <div style={{
          marginBottom: 24,
          padding: 16,
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--panel)'
        }}>
          <h3 style={{ marginBottom: 12 }}>Your Devices</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {myDevices.map(device => (
              <div
                key={device.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--bg)'
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {device.deviceName || 'Unnamed Device'}
                    {device.id === user.deviceId && (
                      <span style={{ 
                        marginLeft: 8, 
                        fontSize: 12, 
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'var(--primary)',
                        color: 'white'
                      }}>
                        Current
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Last seen: {formatDate(device.lastSeenAt)}
                  </div>
                </div>
                {device.id !== user.deviceId && (
                  <button
                    onClick={() => removeDevice(device.id)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 6,
                      border: '1px solid #ef4444',
                      background: 'transparent',
                      color: '#ef4444',
                      fontSize: 12,
                      cursor: 'pointer'
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); addContact(contactUsername) }}
        style={{ display: 'flex', gap: 8, marginBottom: 24 }}
      >
        <input
          value={contactUsername}
          onChange={(e) => setContactUsername(e.target.value)}
          placeholder="Add contact by username"
          style={{ 
            padding: 10, 
            borderRadius: 8, 
            border: '1px solid var(--border)', 
            flex: 1,
            background: 'var(--bg)'
          }}
        />
        <button type="submit">Add Contact</button>
      </form>

      {contacts.length > 0 && (
        <div>
          <div style={{ fontSize: 14, opacity: .8, marginBottom: 12 }}>Contacts</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {contacts.map(username => (
              <button
                key={username}
                onClick={() => openChat(username)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: 16,
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--panel)',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>
                    {username}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Click to open encrypted chat
                  </div>
                </div>
                <div style={{ color: 'var(--muted)' }}>→</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {contacts.length === 0 && (
        <div style={{
          padding: 32,
          textAlign: 'center',
          color: 'var(--muted)',
          borderRadius: 12,
          border: '1px dashed var(--border)'
        }}>
          <div style={{ marginBottom: 8 }}>No contacts yet</div>
          <div style={{ fontSize: 12 }}>
            Add contacts by their username to start encrypted conversations
          </div>
        </div>
      )}
    </div>
  )
}