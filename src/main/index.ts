/**
 * Halis Code — Electron main entry.
 * Creates the window, boots the runtime, starts catalog refresh.
 */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { HalisApp } from './app-runtime'
import { registerIpc } from './ipc'
import { modelCatalog } from './models/catalog'

process.on('unhandledRejection', (reason) => {
  console.error('[halis] unhandled rejection:', reason)
})

let mainWindow: BrowserWindow | null = null
const halis = new HalisApp()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0B0E14',
    title: 'Halis Code',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // External links open in the browser, not in the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc(halis, () => mainWindow)
  halis.ensureWorkspace()
  modelCatalog.startBackgroundRefresh()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  modelCatalog.stopBackgroundRefresh()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  halis.stop('__all__')
})

// Single-instance lock: keep settings/vault writes race-free.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

