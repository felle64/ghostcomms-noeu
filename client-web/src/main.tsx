import { createRoot } from 'react-dom/client'
import App from './app'

// No <StrictMode/> in dev — it double mounts and opens 2 sockets.
createRoot(document.getElementById('root')!).render(<App />)
