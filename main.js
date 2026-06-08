const {
  app, BrowserWindow, globalShortcut, ipcMain,
  clipboard, nativeImage, screen, desktopCapturer,
  Tray, Menu, dialog
} = require('electron')
const path = require('path')
const fs = require('fs')

let overlayWindow = null
let editorWindow = null
let tray = null
let capturedImageBuffer  = null
let captureScaleFactor   = 1
let overlayImageBuffer   = null   // screenshot em resolução lógica (para o expand)
let lastCropLogical      = null   // {x,y,w,h} em pixels lógicos do último crop
let lastScreenSize       = null   // {w,h} da tela lógica

process.on('unhandledRejection', (reason) => {
  console.error('[cap-g] UnhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[cap-g] UncaughtException:', err)
})

app.whenReady().then(() => {
  app.setName('Cap-G')
  createTray()
  registerShortcut()
})

const ASSET = (name) => path.join(__dirname, 'assets', name)

// Carrega ícone de arquivo; se não existir usa bitmap gerado como fallback
function loadIcon(filename) {
  const p = ASSET(filename)
  if (fs.existsSync(p)) return nativeImage.createFromPath(p)
  return null
}

function buildFallbackTrayIcon() {
  const size = 32
  const data = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const cx = size / 2, cy = size / 2
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      const inside = dist < size / 2 - 1
      data[i]     = inside ? 80  : 0
      data[i + 1] = inside ? 140 : 0
      data[i + 2] = inside ? 200 : 0
      data[i + 3] = inside ? 255 : 0
    }
  }
  return nativeImage.createFromBitmap(data, { width: size, height: size })
}

function createTray() {
  const trayIcon = loadIcon('tray.png') || buildFallbackTrayIcon()
  tray = new Tray(trayIcon)
  const menu = Menu.buildFromTemplate([
    { label: 'Capturar Tela (PrintScreen)', click: startCapture },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() }
  ])
  tray.setToolTip('Cap-G — Pressione PrintScreen')
  tray.setContextMenu(menu)
  tray.on('click', startCapture)
}

function registerShortcut() {
  // Windows 11 intercepta PrintScreen nativo (Snipping Tool).
  // Tenta cada candidato em ordem e usa o primeiro que o SO liberar.
  const candidates = [
    'PrintScreen',
    'Ctrl+PrintScreen',
    'Alt+PrintScreen',
    'Ctrl+Shift+S'
  ]

  for (const accel of candidates) {
    try {
      const ok = globalShortcut.register(accel, startCapture)
      if (ok) {
        console.log(`[cap-g] Atalho registrado: ${accel}`)
        tray.setToolTip(`Cap-G — Atalho: ${accel}`)
        return
      }
    } catch (_) {}
  }

  console.warn('[cap-g] Nenhum atalho pôde ser registrado. Use o ícone na bandeja.')
  tray.setToolTip('Cap-G — Clique no ícone para capturar')
}

async function startCapture() {
  if (overlayWindow) return

  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.size
    captureScaleFactor = primaryDisplay.scaleFactor

    console.log(`[cap-g] Capturando ${width}x${height} scale=${captureScaleFactor}`)

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width:  Math.round(width  * captureScaleFactor),
        height: Math.round(height * captureScaleFactor)
      }
    })

    if (!sources.length) {
      console.warn('[cap-g] Nenhuma fonte de tela encontrada')
      return
    }

    const fullThumb = sources[0].thumbnail

    // Guarda em resolução física para o crop final
    capturedImageBuffer = fullThumb.toPNG()

    // Para o overlay envia em resolução lógica (muito menor via IPC)
    const overlayThumb  = fullThumb.resize({ width, height })
    overlayImageBuffer  = overlayThumb.toPNG()          // guarda para o modo expand
    lastScreenSize      = { w: width, h: height }
    const overlayBase64 = overlayImageBuffer.toString('base64')

    showOverlay(overlayBase64, width, height)
  } catch (err) {
    console.error('[cap-g] Falha ao capturar tela:', err)
  }
}

function showOverlay(imageBase64, width, height) {
  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    // transparent: true causava crash no GPU process do Windows 11 —
    // o canvas já desenha o escurecimento, não precisamos de transparência real
    transparent: false,
    backgroundColor: '#000000',
    show: false,       // mostra só depois que o screenshot estiver desenhado
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: loadIcon('icon.ico') || loadIcon('tray.png') || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  overlayWindow.setAlwaysOnTop(true)

  overlayWindow.loadFile(path.join(__dirname, 'src', 'overlay', 'overlay.html'))

  overlayWindow.webContents.once('did-finish-load', () => {
    if (!overlayWindow) return
    overlayWindow.webContents.send('set-screenshot', imageBase64)
    // Aguarda o canvas renderizar antes de exibir (evita flash preto)
    setTimeout(() => overlayWindow && overlayWindow.show(), 80)
  })

  overlayWindow.webContents.on('render-process-gone', (_, details) => {
    console.error('[cap-g] Overlay crashed:', details.reason)
    overlayWindow = null
  })

  overlayWindow.on('closed', () => { overlayWindow = null })
}

ipcMain.on('selection-cancel', () => {
  if (overlayWindow) { overlayWindow.close(); overlayWindow = null }
})

ipcMain.on('selection-complete', (_, region) => {
  if (overlayWindow) { overlayWindow.close(); overlayWindow = null }
  if (region.width < 5 || region.height < 5) return
  lastCropLogical = { x: region.x, y: region.y, w: region.width, h: region.height }

  try {
    const fullImage = nativeImage.createFromBuffer(capturedImageBuffer)
    const { width: imgW, height: imgH } = fullImage.getSize()

    // Converte coordenadas lógicas → pixels físicos
    let sx = Math.round(region.x      * captureScaleFactor)
    let sy = Math.round(region.y      * captureScaleFactor)
    let sw = Math.round(region.width  * captureScaleFactor)
    let sh = Math.round(region.height * captureScaleFactor)

    // Garante que o recorte não ultrapassa os limites da imagem (evita crash nativo)
    sx = Math.max(0, Math.min(sx, imgW - 1))
    sy = Math.max(0, Math.min(sy, imgH - 1))
    sw = Math.min(sw, imgW - sx)
    sh = Math.min(sh, imgH - sy)

    if (sw < 1 || sh < 1) return

    console.log(`[cap-g] Crop ${sx},${sy} ${sw}x${sh} de ${imgW}x${imgH}`)

    const cropped      = fullImage.crop({ x: sx, y: sy, width: sw, height: sh })
    const croppedBase64 = cropped.toPNG().toString('base64')

    showEditor(croppedBase64, region.width, region.height)
  } catch (err) {
    console.error('[cap-g] Erro ao recortar imagem:', err)
  }
})

function showEditor(imageBase64, imgW, imgH) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const winW = Math.min(imgW + 80,  sw - 40)
  const winH = Math.min(imgH + 120, sh - 40)

  editorWindow = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 400,
    minHeight: 300,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    icon: loadIcon('icon.ico') || loadIcon('tray.png') || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Captura qualquer crash/erro do processo renderer do editor
  editorWindow.webContents.on('render-process-gone', (_, details) => {
    console.error('[cap-g] Editor renderer crashed:', JSON.stringify(details))
  })
  editorWindow.webContents.on('did-fail-load', (_, code, desc) => {
    console.error('[cap-g] Editor falhou ao carregar:', code, desc)
  })
  editorWindow.webContents.on('console-message', (_, level, msg, line, src) => {
    if (level >= 2) console.error(`[editor] ${src}:${line} — ${msg}`)
  })

  editorWindow.loadFile(path.join(__dirname, 'src', 'editor', 'editor.html'))

  editorWindow.webContents.once('did-finish-load', () => {
    console.log('[cap-g] Editor carregado, enviando imagem...')
    editorWindow.webContents.send('load-image', imageBase64, imgW, imgH)
    console.log('[cap-g] Imagem enviada')
  })

  editorWindow.on('closed', () => { editorWindow = null })
}

ipcMain.handle('save-image', async (_, imageBase64) => {
  if (!editorWindow) return false
  const result = await dialog.showSaveDialog(editorWindow, {
    defaultPath: `screenshot_${Date.now()}.png`,
    filters: [{ name: 'Imagem PNG', extensions: ['png'] }]
  })
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, Buffer.from(imageBase64, 'base64'))
    return true
  }
  return false
})

ipcMain.on('copy-image', (_, imageBase64) => {
  const image = nativeImage.createFromBuffer(Buffer.from(imageBase64, 'base64'))
  clipboard.writeImage(image)
})

ipcMain.on('close-editor', () => {
  if (editorWindow) { editorWindow.close(); editorWindow = null }
})

// Retorna o screenshot lógico completo + coordenadas do crop atual
ipcMain.handle('get-original-for-expand', () => {
  if (!overlayImageBuffer || !lastCropLogical || !lastScreenSize) return null
  return {
    base64: overlayImageBuffer.toString('base64'),
    w: lastScreenSize.w,
    h: lastScreenSize.h,
    cropX: lastCropLogical.x,
    cropY: lastCropLogical.y,
    cropW: lastCropLogical.w,
    cropH: lastCropLogical.h,
  }
})

// Recorta nova região do buffer físico; retorna imagem + offset para compositing
ipcMain.handle('apply-expand', (_, { newX, newY, newW, newH }) => {
  try {
    const fullImage = nativeImage.createFromBuffer(capturedImageBuffer)
    const { width: imgW, height: imgH } = fullImage.getSize()
    let sx = Math.round(newX * captureScaleFactor)
    let sy = Math.round(newY * captureScaleFactor)
    let sw = Math.round(newW * captureScaleFactor)
    let sh = Math.round(newH * captureScaleFactor)
    sx = Math.max(0, Math.min(sx, imgW - 1))
    sy = Math.max(0, Math.min(sy, imgH - 1))
    sw = Math.min(sw, imgW - sx)
    sh = Math.min(sh, imgH - sy)
    if (sw < 1 || sh < 1) return null
    const cropped = fullImage.crop({ x: sx, y: sy, width: sw, height: sh })
    return {
      base64:  cropped.toPNG().toString('base64'),
      newW:    Math.round(newW),
      newH:    Math.round(newH),
      offsetX: Math.round(lastCropLogical.x - newX),
      offsetY: Math.round(lastCropLogical.y - newY),
    }
  } catch (err) {
    console.error('[cap-g] apply-expand error:', err)
    return null
  }
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', (e) => e.preventDefault()) // mantém rodando na bandeja
