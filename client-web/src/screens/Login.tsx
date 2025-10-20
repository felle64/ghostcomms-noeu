import { useState } from 'react'
import { API } from '../api'
import { myIdentityPubB64, mySignedPrekeyPubB64, generateOneTimePrekeys } from '../crypto/signal'

type Props = {
  onLogin: (data: {
    username: string
    userId: string
    deviceId: string
    jwt: string
  }) => void
}

export default function Login({ onLogin }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const idPub = myIdentityPubB64()
      const spPub = mySignedPrekeyPubB64()
      const otks = generateOneTimePrekeys(10)

      const endpoint = mode === 'signup' ? '/signup' : '/login'
      const res = await fetch(API.url(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.toLowerCase().trim(),
          password,
          deviceName: deviceName || undefined,
          identityKeyPubB64: idPub,
          signedPrekeyPubB64: spPub,
          oneTimePrekeysB64: otks
        })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(data.error || `Error ${res.status}`)
      }

      const data = await res.json()
      onLogin(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        padding: 32,
        borderRadius: 16,
        background: 'var(--panel)',
        border: '1px solid var(--border)'
      }}>
        <h1 style={{ marginBottom: 8 }}>GhostComms • NoEU</h1>
        <p style={{ color: 'var(--muted)', marginBottom: 24, fontSize: 14 }}>
          Privacy-first messaging outside EU jurisdiction
        </p>

        <div style={{ 
          display: 'flex', 
          gap: 8, 
          marginBottom: 24,
          padding: 4,
          background: 'var(--bg)',
          borderRadius: 12
        }}>
          <button
            onClick={() => setMode('login')}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              borderRadius: 8,
              background: mode === 'login' ? 'var(--primary)' : 'transparent',
              color: mode === 'login' ? 'white' : 'inherit',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Login
          </button>
          <button
            onClick={() => setMode('signup')}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              borderRadius: 8,
              background: mode === 'signup' ? 'var(--primary)' : 'transparent',
              color: mode === 'signup' ? 'white' : 'inherit',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              required
              pattern="[a-zA-Z0-9_]+"
              minLength={3}
              maxLength={30}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)'
              }}
            />
            <small style={{ color: 'var(--muted)', fontSize: 12 }}>
              3-30 characters, alphanumeric and underscore only
            </small>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'Choose a strong password' : 'Enter password'}
              required
              minLength={8}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)'
              }}
            />
            {mode === 'signup' && (
              <small style={{ color: 'var(--muted)', fontSize: 12 }}>
                Minimum 8 characters
              </small>
            )}
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
              Device Name (optional)
            </label>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g., iPhone, Desktop, Laptop"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)'
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: 12,
              borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              marginBottom: 16,
              fontSize: 14
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 8,
              border: 'none',
              background: loading ? 'var(--muted)' : 'var(--primary)',
              color: 'white',
              fontWeight: 500,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Processing...' : (mode === 'signup' ? 'Create Account' : 'Login')}
          </button>
        </form>

        <div style={{ 
          marginTop: 24, 
          paddingTop: 24, 
          borderTop: '1px solid var(--border)',
          fontSize: 12,
          color: 'var(--muted)',
          textAlign: 'center'
        }}>
          <strong>Privacy Notice:</strong> Your password is hashed on the server with PBKDF2 (100,000 iterations).
          Messages are end-to-end encrypted with NaCl. Use HTTPS connections only. No phone number required.
        </div>
      </div>
    </div>
  )
}