import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Theme bootstrap: dark lives on body[data-dark-theme],
// platform on html[data-platform]. The renderer boots light; the saved theme
// (Settings → Appearance) is applied as soon as settings arrive — see stores/app.ts.
const ua = navigator.userAgent
const platform = ua.includes('Mac') ? 'darwin' : ua.includes('Win') ? 'win32' : 'linux'
document.documentElement.setAttribute('data-platform', platform)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
