import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Theme bootstrap, DeepSeek Harness-style: dark lives on body[data-ds-dark-theme],
// platform on html[data-platform]. Follows the system, no in-app switch.
const mql = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => {
  if (mql.matches) document.body.setAttribute('data-ds-dark-theme', '')
  else document.body.removeAttribute('data-ds-dark-theme')
}
const ua = navigator.userAgent
const platform = ua.includes('Mac') ? 'darwin' : ua.includes('Win') ? 'win32' : 'linux'
document.documentElement.setAttribute('data-platform', platform)

applyTheme()
mql.addEventListener('change', applyTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
