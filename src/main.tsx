import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GlobalDialogHost } from './GlobalDialogs.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalDialogHost/>
    <App />
  </StrictMode>,
)
