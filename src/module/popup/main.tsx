import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

createRoot(document.getElementById('webwings-popup-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
