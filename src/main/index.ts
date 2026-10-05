import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { dropAll } from './adapters'
import { startAnalyticsLoop } from './analytics'
import { broadcast, registerIpc } from './ipc'
import { showSplash, type Splash } from './splash'
import { flush, initStore } from './store'

const BG = '#0a0a0b'

function createWindow(splash?: Splash): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: BG,
    title: 'Viewdata',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#a1a1aa', height: 40 },
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => (splash ? splash.handoff(win) : win.show()))
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let stopLoop: (() => void) | null = null

app.whenReady().then(async () => {
  app.setAppUserModelId('app.viewdata.desktop')
  const splash = showSplash()
  await initStore()
  registerIpc()
  createWindow(splash)
  stopLoop = startAnalyticsLoop(() => broadcast('analytics:updated'))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopLoop?.()
  flush()
  void dropAll()
})
