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

process.on('uncaughtException', (err) => {
  // Log and stay alive: a single bad callback must not take the whole app
  // (and every running turn) down silently.
  console.error('[halis] uncaught exception:', err)
})

// Single-instance lock FIRST: constructing HalisApp has real side effects
// (key migration writes the vault + settings, the schedule timer starts) —
// two instances racing on those files must never happen.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap(): void {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  const halis = new HalisApp()

  /** Packaged builds carry the icon via extraResources; dev reads build/icon.png. */
  function windowIcon(): string {
    return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')
  }

  function createWindow(): void {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 980,
      minHeight: 640,
      show: false,
      backgroundColor: '#FFFFFF',
      title: 'Halis Code',
      icon: windowIcon(),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    })

    mainWindow.on('ready-to-show', () => mainWindow?.show())

    // A crashed renderer used to leave a permanently white window with no
    // way back — reload it instead.
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[halis] renderer gone:', details.reason)
      if (!mainWindow?.isDestroyed()) mainWindow?.webContents.reload()
    })

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

  let mainWindow: BrowserWindow | null = null

  app.whenReady().then(() => {
    registerIpc(halis, () => mainWindow)
    // Workspace setup can legitimately fail (HOME not writable, sandbox
    // restrictions) — the app must still open so the user can pick another
    // folder in Settings, instead of an invisible process hanging forever.
    try {
      halis.ensureWorkspace()
    } catch (err) {
      console.error('[halis] workspace init failed:', err)
    }
    modelCatalog.startBackgroundRefresh()
    void halis.startup()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      // window-all-closed stopped the refresh timer; on macOS the app keeps
      // running, so re-activating must bring the catalog updates back or the
      // model lists stay frozen until a full restart.
      modelCatalog.startBackgroundRefresh()
    })
  })

  app.on('window-all-closed', () => {
    modelCatalog.stopBackgroundRefresh()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    halis.stopAll()
    halis.schedules.stop()
    void halis.mcp.closeAll()
  })
}
