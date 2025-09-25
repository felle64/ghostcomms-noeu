import { useEffect, useState } from 'react'
import Thread from './screens/Thread'
import Chats from './screens/Chats'
import Login from './screens/Login'
import { API } from './api'

export default function App() {
  const [user, setUser] = useState<{
    username: string
    userId: string
    deviceId: string
  } | null>(null)
  const [peer, setPeer] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if logged in
    const jwt = localStorage.getItem('jwt')
    const username = localStorage.getItem('username')
    const userId = localStorage.getItem('userId')
    const deviceId = localStorage.getItem('deviceId')
    
    if (jwt && username && userId && deviceId) {
      setUser({ username, userId, deviceId })
    }
    setLoading(false)
  }, [])

  const handleLogin = (data: {
    username: string
    userId: string
    deviceId: string
    jwt: string
  }) => {
    localStorage.setItem('jwt', data.jwt)
    localStorage.setItem('username', data.username)
    localStorage.setItem('userId', data.userId)
    localStorage.setItem('deviceId', data.deviceId)
    setUser({
      username: data.username,
      userId: data.userId,
      deviceId: data.deviceId
    })
  }

  const handleLogout = () => {
    localStorage.clear()
    setUser(null)
    setPeer(null)
  }

  if (loading) {
    return <div className="p-6">Loading...</div>
  }

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  if (peer) {
    return (
      <Thread 
        self={user.deviceId}
        peer={peer}
        onBack={() => setPeer(null)}
      />
    )
  }

  return (
    <Chats 
      user={user}
      onOpen={setPeer}
      onLogout={handleLogout}
    />
  )
}