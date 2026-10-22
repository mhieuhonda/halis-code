import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import App from './App'
import './styles.css'

// Hardware back: pop in-app history first, exit only at the root.
if (Capacitor.isNativePlatform()) {
  void CapApp.addListener('backButton', () => {
    if (window.history.length > 1) window.history.back()
    else void CapApp.exitApp()
  })
}

void createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
