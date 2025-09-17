/// <reference types="vite/client" />
import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app'
import './styles/chat.css'


const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

const root = createRoot(container)

// Disable StrictMode in dev to avoid duplicate WS connections from double-mount.
// (StrictMode is fine in production; it doesn’t double-run there.)
const tree = import.meta.env.DEV ? <App /> : (
  <StrictMode>
    <App />
  </StrictMode>
)

root.render(tree)

// Ensure hot-reload unmounts the previous tree (prevents stray sockets)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount()
  })
}
