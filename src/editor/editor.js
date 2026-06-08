const canvas = document.getElementById('canvas')
const ctx    = canvas.getContext('2d')

let tool        = 'pen'
let drawing     = false
let startX      = 0, startY = 0
let color       = '#ff0000'
let strokeWidth = 2
let history      = []
let redoHistory  = []
let textObjects  = []        // objetos de texto persistentes
let ctxMenuTarget = null    // texto sob o menu de contexto

const SHAPE_ICONS = {
  rect:    `<rect x="2" y="4" width="12" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>`,
  ellipse: `<ellipse cx="8" cy="8" rx="6" ry="5" fill="none" stroke="currentColor" stroke-width="2"/>`
}

let blurShape = 'rect'   // forma ativa do blur: 'rect' | 'ellipse'

// ── Seleção de ferramenta ─────────────────────────────────────────────────

document.querySelectorAll('[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.tool
    if (t === 'undo') { undo(); return }
    if (t === 'redo') { redo(); return }
    activateTool(t, btn)
  })
})

function activateTool(t, activeBtn) {
  // Sair do modo recorte se mudar de ferramenta
  if (tool === 'crop' && t !== 'crop') exitCropMode()

  // Ao sair da ferramenta texto: confirma textos abertos
  if (t !== 'text') {
    textObjects.filter(o => o.state === 'editing').forEach(o => {
      o.textarea.value.trim() ? lockTextObj(o) : removeTextObj(o)
    })
  }

  tool = t
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'))
  if (activeBtn) activeBtn.classList.add('active')

  if (t === 'crop') {
    enterCropMode(); return
  }

  canvas.style.cursor = t === 'text' ? 'text' : 'crosshair'

  // Textos só capturam eventos de mouse quando a ferramenta texto está ativa
  textObjects.forEach(obj => {
    obj.wrapper.style.pointerEvents = t === 'text' ? 'auto' : 'none'
  })
}

document.getElementById('color-picker').addEventListener('input', e => { color = e.target.value })
document.getElementById('stroke-range').addEventListener('input', e => { strokeWidth = Number(e.target.value) })

// ── Atalhos de teclado ────────────────────────────────────────────────────

const toolKeys = { p: 'pen', l: 'line', a: 'arrow', b: 'blur', t: 'text', c: 'crop' }

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') return

  // Atalhos do modo recorte têm prioridade
  if (tool === 'crop') {
    if (e.key === 'Enter') { cropConfirm(); return }
    if (e.key === 'Escape') { exitCropMode(); document.querySelector('[data-tool="pen"]').click(); return }
    return
  }

  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { undo(); return }
  if (e.ctrlKey && e.shiftKey && e.key === 'z') { redo(); return }
  if (e.ctrlKey && e.key === 's') { document.getElementById('btn-save').click(); return }
  if (e.ctrlKey && e.key === 'c') { document.getElementById('btn-copy').click(); return }
  if (e.key === 'Escape')         { commitAllText(); window.electronAPI.closeEditor(); return }
  if (e.key.toLowerCase() === 'r') { document.getElementById('tool-shape').click(); return }
  const mapped = toolKeys[e.key.toLowerCase()]
  if (mapped) document.querySelector(`[data-tool="${mapped}"]`).click()
})

// ── Menu de formas ────────────────────────────────────────────────────────

const shapeBtn  = document.getElementById('tool-shape')
const shapeMenu = document.getElementById('shape-menu')

function openMenuLeftOf(menu, btn) {
  menu.hidden = false
  const r  = btn.getBoundingClientRect()
  const mw = menu.offsetWidth || 160
  menu.style.top  = r.top + 'px'
  menu.style.left = Math.max(4, r.left - mw - 6) + 'px'
}

shapeBtn.addEventListener('contextmenu', e => {
  e.preventDefault()
  blurMenu.hidden = true
  openMenuLeftOf(shapeMenu, shapeBtn)
})

document.querySelectorAll('#shape-menu .shape-opt').forEach(item => {
  item.addEventListener('click', () => {
    const shape = item.dataset.shape
    shapeBtn.dataset.tool = shape
    shapeBtn.title = item.dataset.label + ' (R) · clique direito → trocar forma'
    document.getElementById('shape-icon').innerHTML = SHAPE_ICONS[shape]
    document.querySelectorAll('#shape-menu .shape-opt').forEach(o => o.classList.remove('selected'))
    item.classList.add('selected')
    shapeMenu.hidden = true
    shapeBtn.click()
  })
})

// ── Menu de formas do blur ────────────────────────────────────────────────

const blurBtn  = document.getElementById('tool-blur')
const blurMenu = document.getElementById('blur-menu')

blurBtn.addEventListener('contextmenu', e => {
  e.preventDefault()
  shapeMenu.hidden = true
  openMenuLeftOf(blurMenu, blurBtn)
})

document.querySelectorAll('#blur-menu .shape-opt').forEach(item => {
  item.addEventListener('click', () => {
    blurShape = item.dataset.blurShape
    blurBtn.title = 'Borrar ' + item.dataset.label + ' (B) · clique direito → trocar forma'
    document.querySelectorAll('#blur-menu .shape-opt').forEach(o => o.classList.remove('selected'))
    item.classList.add('selected')
    blurMenu.hidden = true
    blurBtn.click()
  })
})


// ── Carregamento da imagem ────────────────────────────────────────────────

window.electronAPI.onLoadImage((base64, w, h) => {
  canvas.width  = w
  canvas.height = h
  const img = new Image()
  img.onload = () => { ctx.drawImage(img, 0, 0); saveHistory() }
  img.src = `data:image/png;base64,${base64}`
})

// ── Histórico ─────────────────────────────────────────────────────────────

function saveHistory() {
  history.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
  if (history.length > 40) history.shift()
  redoHistory = []   // nova ação descarta o histórico de refazer
}
function undo() {
  if (history.length <= 1) return
  redoHistory.push(history.pop())
  if (redoHistory.length > 40) redoHistory.shift()
  ctx.putImageData(history[history.length - 1], 0, 0)
}
function redo() {
  if (!redoHistory.length) return
  const state = redoHistory.pop()
  history.push(state)
  ctx.putImageData(state, 0, 0)
}
function restoreLast() {
  ctx.putImageData(history[history.length - 1], 0, 0)
}

// ── Eventos de desenho ────────────────────────────────────────────────────

canvas.addEventListener('mousedown', e => {
  if (tool === 'text') { handleTextMousedown(e); return }
  drawing = true
  startX = e.offsetX
  startY = e.offsetY
  if (tool === 'pen') {
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.strokeStyle = color
    ctx.lineWidth   = strokeWidth
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
  }
})

canvas.addEventListener('mousemove', e => {
  // Cursor de mãozinha quando sobre texto confirmado no modo texto
  if (tool === 'text' && !drawing) {
    for (const obj of textObjects) {
      if (obj.state === 'locked' && isOverEl(obj.wrapper, e.clientX, e.clientY)) {
        canvas.style.cursor = 'move'
        return
      }
    }
    canvas.style.cursor = 'text'
    return
  }

  if (!drawing) return
  const cx = e.offsetX, cy = e.offsetY
  if (tool === 'pen') { ctx.lineTo(cx, cy); ctx.stroke(); return }
  restoreLast()
  renderShape(tool, startX, startY, cx, cy, true)
})

canvas.addEventListener('mouseup', e => {
  if (!drawing) return
  drawing = false
  const cx = e.offsetX, cy = e.offsetY
  if (tool === 'pen') {
    ctx.closePath()
  } else {
    restoreLast()
    renderShape(tool, startX, startY, cx, cy, false)
  }
  saveHistory()
})

// ── Renderização das formas ───────────────────────────────────────────────

function renderShape(type, x1, y1, x2, y2, isPreview) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle   = color
  ctx.lineWidth   = strokeWidth
  ctx.lineCap     = 'round'

  switch (type) {
    case 'line':
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      break
    case 'arrow':
      drawArrow(x1, y1, x2, y2)
      break
    case 'rect':
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
      break
    case 'ellipse': {
      const erx = Math.abs(x2 - x1) / 2, ery = Math.abs(y2 - y1) / 2
      const ecx = Math.min(x1, x2) + erx,  ecy = Math.min(y1, y2) + ery
      ctx.beginPath(); ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2); ctx.stroke()
      break
    }
    case 'blur':
      if (isPreview) {
        ctx.strokeStyle = 'rgba(210,30,30,0.9)'; ctx.lineWidth = 1.5
        ctx.setLineDash([5, 3])
        if (blurShape === 'ellipse') {
          const brx = Math.abs(x2-x1)/2, bry = Math.abs(y2-y1)/2
          ctx.beginPath(); ctx.ellipse(Math.min(x1,x2)+brx, Math.min(y1,y2)+bry, brx, bry, 0, 0, Math.PI*2); ctx.stroke()
        } else {
          ctx.strokeRect(x1, y1, x2-x1, y2-y1)
        }
        ctx.setLineDash([])
      } else {
        pixelate(x1, y1, x2, y2, blurShape)
      }
      break
  }
  ctx.restore()
}

function drawArrow(x1, y1, x2, y2) {
  const headLen = Math.max(12, strokeWidth * 5)
  const angle   = Math.atan2(y2 - y1, x2 - x1)
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI/6), y2 - headLen * Math.sin(angle - Math.PI/6))
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI/6), y2 - headLen * Math.sin(angle + Math.PI/6))
  ctx.closePath(); ctx.fill()
}

// ── Blur ──────────────────────────────────────────────────────────────────

function pixelate(x1, y1, x2, y2, shape = 'rect') {
  const rx = Math.round(Math.min(x1, x2)), ry = Math.round(Math.min(y1, y2))
  const rw = Math.round(Math.abs(x2 - x1)), rh = Math.round(Math.abs(y2 - y1))
  if (rw < 2 || rh < 2) return

  const RADIUS = 6, PASSES = 3, BLEND = 0.65, WHITE = 255
  const original = ctx.getImageData(rx, ry, rw, rh)
  let blurred = new ImageData(new Uint8ClampedArray(original.data), rw, rh)
  for (let p = 0; p < PASSES; p++) blurred = boxBlurPass(blurred, rw, rh, RADIUS)

  const mixed = new Uint8ClampedArray(original.data.length)
  for (let i = 0; i < mixed.length; i += 4) {
    mixed[i]   = blurred.data[i]   * BLEND + WHITE * (1-BLEND) | 0
    mixed[i+1] = blurred.data[i+1] * BLEND + WHITE * (1-BLEND) | 0
    mixed[i+2] = blurred.data[i+2] * BLEND + WHITE * (1-BLEND) | 0
    mixed[i+3] = 255
  }

  ctx.save()
  if (shape === 'ellipse') {
    // putImageData ignora clip path — usa canvas temporário + drawImage
    const tmp = document.createElement('canvas')
    tmp.width = rw; tmp.height = rh
    tmp.getContext('2d').putImageData(new ImageData(mixed, rw, rh), 0, 0)
    ctx.beginPath()
    ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(tmp, rx, ry)
  } else {
    ctx.putImageData(new ImageData(mixed, rw, rh), rx, ry)
  }
  ctx.restore()
}

function boxBlurPass(imgData, w, h, r) {
  const src = new Uint8ClampedArray(imgData.data)
  const tmp = new Uint8ClampedArray(src.length)
  const out = new Uint8ClampedArray(src.length)
  const len = 2 * r + 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0
      for (let dx = -r; dx <= r; dx++) {
        const nx = Math.max(0, Math.min(w-1, x+dx)), i = (y*w+nx)*4
        sr += src[i]; sg += src[i+1]; sb += src[i+2]
      }
      const i = (y*w+x)*4
      tmp[i] = sr/len|0; tmp[i+1] = sg/len|0; tmp[i+2] = sb/len|0; tmp[i+3] = src[i+3]
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0
      for (let dy = -r; dy <= r; dy++) {
        const ny = Math.max(0, Math.min(h-1, y+dy)), i = (ny*w+x)*4
        sr += tmp[i]; sg += tmp[i+1]; sb += tmp[i+2]
      }
      const i = (y*w+x)*4
      out[i] = sr/len|0; out[i+1] = sg/len|0; out[i+2] = sb/len|0; out[i+3] = tmp[i+3]
    }
  }
  return new ImageData(out, w, h)
}

// ── Sistema de texto ──────────────────────────────────────────────────────
//
//  state: 'editing' → textarea visível, Enter = nova linha, Ctrl/Shift+Enter = confirmar
//  state: 'locked'  → display div visível, arrastar = mover, botão direito = menu
//

function handleTextMousedown(e) {
  hideTextCtxMenu()
  // Clique sobre texto existente é tratado pelo próprio wrapper (mousedown ali)
  // Se chegou aqui é porque o clique foi na área do canvas sem texto → cria novo
  for (const obj of textObjects) {
    if (isOverEl(obj.wrapper, e.clientX, e.clientY)) return
  }
  spawnTextObj(e)
}

function isOverEl(el, cx, cy) {
  const r = el.getBoundingClientRect()
  return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
}

function spawnTextObj(e) {
  const fontSize  = Math.max(14, strokeWidth * 6)
  const txtColor  = color
  const cRect     = canvas.getBoundingClientRect()

  const wrapper = document.createElement('div')
  wrapper.className = 'text-obj'
  wrapper.style.cssText = `position:fixed;left:${cRect.left + e.offsetX}px;top:${cRect.top + e.offsetY}px;z-index:9998;cursor:move;user-select:none;display:inline-flex;flex-direction:column`

  // ── Textarea (estado editing) ──
  const textarea = document.createElement('textarea')
  textarea.rows = 1
  textarea.placeholder = 'Digite aqui...'
  textarea.style.cssText = `
    background:transparent;
    border:1.5px dashed ${txtColor};
    border-radius:3px;
    outline:none;
    color:${txtColor};
    font-size:${fontSize}px;
    font-family:Arial,sans-serif;
    font-weight:bold;
    padding:4px 8px;
    min-width:120px;
    max-width:420px;
    width:240px;
    resize:horizontal;
    overflow:hidden;
    cursor:text;
    caret-color:${txtColor};
    line-height:1.35;
    display:block;
  `

  // ── Display div (estado locked) ──
  const display = document.createElement('div')
  display.style.cssText = `
    color:${txtColor};
    font-size:${fontSize}px;
    font-family:Arial,sans-serif;
    font-weight:bold;
    padding:4px 8px;
    max-width:420px;
    white-space:pre-wrap;
    line-height:1.35;
    cursor:move;
    display:none;
    min-height:1em;
  `

  // ── Barra de botões (estado editing) ──
  const btnBar = document.createElement('div')
  btnBar.style.cssText = 'display:flex;gap:3px;padding:2px 0;'

  const okBtn  = mkSmallBtn('✓', '#2a9d2a', 'Confirmar')
  const delBtn = mkSmallBtn('✕', '#c44',    'Descartar (Esc)')
  btnBar.append(
    mkHint('Enter ou Ctrl+↵ = pular linha'),
    okBtn, delBtn
  )

  const obj = { wrapper, textarea, display, btnBar, state: 'editing', fontSize, color: txtColor }

  // Auto-resize altura da textarea
  const resizeTA = () => {
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 220) + 'px'
  }
  textarea.addEventListener('input', resizeTA)

  // Teclado dentro da textarea
  textarea.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.shiftKey) && ev.key === 'Enter') {
      // Ctrl+Enter / Shift+Enter = inserir nova linha manualmente
      ev.preventDefault()
      const pos = textarea.selectionStart
      const val = textarea.value
      textarea.value = val.slice(0, pos) + '\n' + val.slice(pos)
      textarea.selectionStart = textarea.selectionEnd = pos + 1
      resizeTA()
    } else if (ev.key === 'Escape') {
      textarea.value.trim() ? lockTextObj(obj) : removeTextObj(obj)
    }
    // Enter puro = nova linha (comportamento padrão do textarea)
    ev.stopPropagation()
  })

  textarea.addEventListener('mousedown', ev => ev.stopPropagation())

  okBtn.addEventListener('click',  () => lockTextObj(obj))
  delBtn.addEventListener('click', () => removeTextObj(obj))

  // Botão direito sobre o display → menu de contexto
  display.addEventListener('contextmenu', ev => {
    ev.preventDefault(); ev.stopPropagation()
    showTextCtxMenu(ev.clientX, ev.clientY, obj)
  })

  // Arrastar o wrapper (exceto textarea e botões)
  setupDrag(wrapper, [textarea, okBtn, delBtn])

  wrapper.append(textarea, btnBar, display)
  document.body.appendChild(wrapper)
  textObjects.push(obj)
  textarea.focus()
  return obj
}

function lockTextObj(obj) {
  if (!obj.textarea.value.trim()) { removeTextObj(obj); return }
  obj.state        = 'locked'
  obj.display.textContent = obj.textarea.value
  obj.display.style.display = 'block'
  obj.textarea.style.display = 'none'
  obj.btnBar.style.display   = 'none'
}

function unlockTextObj(obj) {
  obj.state = 'editing'
  obj.display.style.display  = 'none'
  obj.textarea.style.display = 'block'
  obj.btnBar.style.display   = 'flex'
  obj.textarea.focus()
  obj.textarea.setSelectionRange(obj.textarea.value.length, obj.textarea.value.length)
}

function removeTextObj(obj) {
  obj.wrapper.remove()
  textObjects = textObjects.filter(o => o !== obj)
}

function commitAllText() {
  ;[...textObjects].forEach(obj => {
    const text = obj.state === 'editing' ? obj.textarea.value : (obj.display.textContent || '')
    if (!text.trim()) { removeTextObj(obj); return }

    const cRect     = canvas.getBoundingClientRect()
    const wRect     = obj.wrapper.getBoundingClientRect()
    const drawX     = wRect.left - cRect.left + 8
    const lineH     = obj.fontSize * 1.35
    let   drawY     = wRect.top  - cRect.top + obj.fontSize

    ctx.font      = `bold ${obj.fontSize}px Arial`
    ctx.fillStyle = obj.color
    text.split('\n').forEach(line => {
      ctx.fillText(line || '', drawX, drawY)
      drawY += lineH
    })
    saveHistory()
    removeTextObj(obj)
  })
}

// ── Menu de contexto do texto ─────────────────────────────────────────────

const textCtxMenu = document.getElementById('text-ctx-menu')

function showTextCtxMenu(x, y, obj) {
  ctxMenuTarget = obj
  textCtxMenu.style.left   = x + 'px'
  textCtxMenu.style.top    = y + 'px'
  textCtxMenu.hidden = false
}

function hideTextCtxMenu() {
  textCtxMenu.hidden = true
  ctxMenuTarget = null
}

document.getElementById('ctx-edit').addEventListener('click', () => {
  if (ctxMenuTarget) unlockTextObj(ctxMenuTarget)
  hideTextCtxMenu()
})

document.getElementById('ctx-delete').addEventListener('click', () => {
  if (ctxMenuTarget) removeTextObj(ctxMenuTarget)
  hideTextCtxMenu()
})

document.addEventListener('click', e => {
  if (!textCtxMenu.contains(e.target)) hideTextCtxMenu()
  if (!shapeMenu.contains(e.target))   shapeMenu.hidden = true
  if (!blurMenu.contains(e.target))    blurMenu.hidden  = true
})

// ── Drag helper ───────────────────────────────────────────────────────────

function setupDrag(wrapper, excludeEls) {
  wrapper.addEventListener('mousedown', ev => {
    if (ev.button !== 0) return
    if (excludeEls.some(el => el === ev.target || el.contains(ev.target))) return

    let sl = parseInt(wrapper.style.left) || 0
    let st = parseInt(wrapper.style.top)  || 0
    const mx0 = ev.clientX, my0 = ev.clientY

    const onMove = mv => {
      wrapper.style.left = (sl + mv.clientX - mx0) + 'px'
      wrapper.style.top  = (st + mv.clientY - my0) + 'px'
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    ev.preventDefault()
  })
}

// ── Helpers de UI ─────────────────────────────────────────────────────────

function mkSmallBtn(label, bg, title) {
  const btn = document.createElement('button')
  btn.textContent = label; btn.title = title
  btn.style.cssText = `background:${bg};color:#fff;border:none;border-radius:3px;width:22px;height:22px;font-size:12px;cursor:pointer;flex-shrink:0`
  return btn
}

function mkHint(text) {
  const s = document.createElement('span')
  s.textContent = text
  s.style.cssText = 'font-size:10px;color:rgba(0,0,0,0.45);flex:1;padding:0 4px;line-height:22px;white-space:nowrap;pointer-events:none'
  return s
}

// ── Barra inferior ────────────────────────────────────────────────────────

document.getElementById('btn-save').addEventListener('click', async () => {
  commitAllText()
  const base64 = canvas.toDataURL('image/png').split(',')[1]
  const ok = await window.electronAPI.saveImage(base64)
  if (ok) toast('Salvo!')
})

document.getElementById('btn-copy').addEventListener('click', () => {
  commitAllText()
  const base64 = canvas.toDataURL('image/png').split(',')[1]
  window.electronAPI.copyImage(base64)
  toast('Copiado!')
})

document.getElementById('btn-close').addEventListener('click', () => {
  commitAllText(); window.electronAPI.closeEditor()
})
document.getElementById('btn-close-win').addEventListener('click', () => {
  commitAllText(); window.electronAPI.closeEditor()
})

function toast(msg) {
  const el = document.createElement('div')
  el.textContent = msg
  Object.assign(el.style, {
    position:'fixed', bottom:'58px', left:'50%', transform:'translateX(-50%)',
    background:'rgba(0,0,0,0.85)', color:'#fff', padding:'6px 18px',
    borderRadius:'5px', fontSize:'13px', zIndex:'99999', pointerEvents:'none'
  })
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 1800)
}

// ── Modo Reselecionar / Ampliar ───────────────────────────────────────────
//
//  Mostra o screenshot original completo (em escala) dentro de um overlay.
//  A região atual é pré-selecionada. O usuário pode arrastar para ampliar
//  ou reduzir. Ao confirmar, o main.js recompõe fundo + anotações.
//

const expandOverlay = document.getElementById('expand-overlay')
const expandCanvas  = document.getElementById('expand-canvas')
const expandCtx     = expandCanvas.getContext('2d')
const expandHintEl  = document.getElementById('expand-hint')

let expScale     = 1       // fator de escala screenshot → canvas
let expScrW      = 0       // dimensões lógicas do screenshot completo
let expScrH      = 0
let expState     = 'idle'  // idle | selecting | selected | resizing | moving
let expSel       = { x: 0, y: 0, w: 0, h: 0 }  // em pixels LÓGICOS
let expAnchor    = { x: 0, y: 0 }
let expDragStart = null
let expActiveHnd = null
let expScrImg    = null    // Image() do screenshot completo

const EXP_HR  = 5
const EXP_MIN = 10
const EXP_CURSORS = {
  nw:'nw-resize', ne:'ne-resize', se:'se-resize', sw:'sw-resize',
  n:'ns-resize',  s:'ns-resize',  e:'ew-resize',  w:'ew-resize',
}

document.getElementById('btn-expand').addEventListener('click', async () => {
  const data = await window.electronAPI.getOriginalForExpand()
  if (!data) { toast('Screenshot original não disponível'); return }

  expScrW = data.w; expScrH = data.h

  // Calcula escala para caber no overlay (que ocupa a janela inteira)
  const ow = window.innerWidth, oh = window.innerHeight
  expScale = Math.min(ow / expScrW, oh / expScrH) * 0.96  // margem 2%

  expandCanvas.width  = Math.round(expScrW * expScale)
  expandCanvas.height = Math.round(expScrH * expScale)

  // Carrega imagem do screenshot
  expScrImg = new Image()
  expScrImg.onload = () => {
    // Pré-seleciona a região atual em coordenadas lógicas
    expSel   = { x: data.cropX, y: data.cropY, w: data.cropW, h: data.cropH }
    expState = 'selected'
    expandOverlay.classList.add('active')
    setExpHint('selected')
    drawExp()
  }
  expScrImg.src = `data:image/png;base64,${data.base64}`
})

function setExpHint(mode) {
  const K = t => `<kbd style="background:rgba(255,255,255,.18);padding:1px 5px;border-radius:3px">${t}</kbd>`
  if (mode === 'idle') {
    expandHintEl.innerHTML = `Arraste para nova seleção &nbsp;•&nbsp; ${K('Esc')} cancelar`
  } else {
    expandHintEl.innerHTML = `${K('Enter')} ou duplo clique para aplicar &nbsp;•&nbsp; arraste as alças para ajustar &nbsp;•&nbsp; ${K('Esc')} cancelar`
  }
}

// Converte coordenada do canvas → coordenada lógica do screenshot
const toLog  = v  => v  / expScale
const toPx   = v  => v  * expScale
const toLogP = (x, y) => ({ x: toLog(x), y: toLog(y) })

function expNorm() {
  if (expState === 'selecting') {
    return {
      x: Math.min(expAnchor.x, expSel.x),
      y: Math.min(expAnchor.y, expSel.y),
      w: Math.abs(expSel.x - expAnchor.x),
      h: Math.abs(expSel.y - expAnchor.y),
    }
  }
  return { ...expSel }
}

function expHandlePoints(s) {
  const { x, y, w, h } = s
  const mx = x + w/2, my = y + h/2
  return [
    ['nw',x,y], ['n',mx,y], ['ne',x+w,y],
    ['w',x,my],              ['e',x+w,my],
    ['sw',x,y+h], ['s',mx,y+h], ['se',x+w,y+h],
  ]
}

function expHitHandle(lx, ly) {
  const hr = EXP_HR / expScale  // tolerância em lógico
  for (const [n, hx, hy] of expHandlePoints(expSel)) {
    if (Math.abs(lx-hx) <= hr+2 && Math.abs(ly-hy) <= hr+2) return n
  }
  return null
}

function expInSel(lx, ly) {
  const s = expSel
  return lx >= s.x && lx <= s.x+s.w && ly >= s.y && ly <= s.y+s.h
}

function expClamp(x, y, w, h) {
  x = Math.max(0, x); y = Math.max(0, y)
  w = Math.min(w, expScrW - x); h = Math.min(h, expScrH - y)
  return { x, y, w, h }
}

function drawExp() {
  const CW = expandCanvas.width, CH = expandCanvas.height
  expandCtx.clearRect(0, 0, CW, CH)
  if (expScrImg) expandCtx.drawImage(expScrImg, 0, 0, CW, CH)
  if (expState === 'idle') return

  const s = expNorm()
  const px = toPx(s.x), py = toPx(s.y), pw = toPx(s.w), ph = toPx(s.h)

  // Overlay escuro fora da seleção
  expandCtx.fillStyle = 'rgba(0,0,0,0.52)'
  expandCtx.fillRect(0,    0,  CW,  py)
  expandCtx.fillRect(0,    py, px,  ph)
  expandCtx.fillRect(px+pw, py, CW-(px+pw), ph)
  expandCtx.fillRect(0,    py+ph, CW, CH-(py+ph))

  // Borda branca
  expandCtx.save()
  expandCtx.strokeStyle = '#fff'
  expandCtx.lineWidth   = 1.5
  expandCtx.setLineDash(expState === 'selecting' ? [5,3] : [])
  expandCtx.strokeRect(px, py, pw, ph)
  expandCtx.setLineDash([])
  expandCtx.restore()

  // Label dimensões
  const label = `${Math.round(s.w)} × ${Math.round(s.h)}`
  expandCtx.font = 'bold 12px monospace'
  const tw = expandCtx.measureText(label).width
  const lx = px + Math.max(0, pw - tw - 8)
  const ly = py > 22 ? py - 6 : py + ph + 16
  expandCtx.fillStyle = 'rgba(0,0,0,0.72)'
  expandCtx.fillRect(lx-4, ly-14, tw+10, 18)
  expandCtx.fillStyle = '#fff'
  expandCtx.fillText(label, lx, ly)

  // Alças
  if (expState !== 'selecting') {
    expandCtx.save()
    expandCtx.lineWidth = 1.5
    for (const [, hx, hy] of expHandlePoints(s)) {
      const px2 = toPx(hx), py2 = toPx(hy)
      expandCtx.fillStyle = '#fff'
      expandCtx.strokeStyle = 'rgba(0,0,0,0.5)'
      expandCtx.fillRect(px2-EXP_HR, py2-EXP_HR, EXP_HR*2, EXP_HR*2)
      expandCtx.strokeRect(px2-EXP_HR, py2-EXP_HR, EXP_HR*2, EXP_HR*2)
    }
    expandCtx.restore()
  }
}

function expApplyResize(handle, dlx, dly) {
  let { x, y, w, h } = expDragStart.sel
  switch (handle) {
    case 'nw': x+=dlx; y+=dly; w-=dlx; h-=dly; break
    case 'n':          y+=dly;          h-=dly; break
    case 'ne':         y+=dly; w+=dlx;  h-=dly; break
    case 'e':                  w+=dlx;          break
    case 'se':                 w+=dlx;  h+=dly; break
    case 's':                           h+=dly; break
    case 'sw': x+=dlx;         w-=dlx;  h+=dly; break
    case 'w':  x+=dlx;         w-=dlx;          break
  }
  if (w < EXP_MIN) { if ('nw,sw,w'.includes(handle)) x = expDragStart.sel.x + expDragStart.sel.w - EXP_MIN; w = EXP_MIN }
  if (h < EXP_MIN) { if ('nw,n,ne'.includes(handle)) y = expDragStart.sel.y + expDragStart.sel.h - EXP_MIN; h = EXP_MIN }
  expSel = expClamp(x, y, w, h)
}

async function expConfirm() {
  if (expState !== 'selected') return
  const { x, y, w, h } = expSel
  if (w < EXP_MIN || h < EXP_MIN) return

  expandOverlay.classList.remove('active')

  // Queima textos pendentes antes de capturar o ImageData atual
  commitAllText()
  const oldData = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const result = await window.electronAPI.applyExpand({ newX: x, newY: y, newW: w, newH: h })
  if (!result) { toast('Erro ao ampliar — tente novamente'); return }

  // Cria canvas temporário com o novo fundo
  const tmp    = document.createElement('canvas')
  tmp.width    = result.newW
  tmp.height   = result.newH
  const tmpCtx = tmp.getContext('2d')

  const bg = new Image()
  bg.onload = () => {
    tmpCtx.drawImage(bg, 0, 0)
    // Cola as anotações (+ fundo original) no offset correto
    tmpCtx.putImageData(oldData, result.offsetX, result.offsetY)
    // Aplica ao canvas principal
    canvas.width  = result.newW
    canvas.height = result.newH
    ctx.drawImage(tmp, 0, 0)
    history = []
    saveHistory()
  }
  bg.src = `data:image/png;base64,${result.base64}`
}

// Eventos do expand canvas
expandCanvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return
  const { x: lx, y: ly } = toLogP(e.offsetX, e.offsetY)

  if (expState === 'selected') {
    const h = expHitHandle(lx, ly)
    if (h) {
      expState = 'resizing'; expActiveHnd = h
      expDragStart = { lx, ly, sel: { ...expSel } }; return
    }
    if (expInSel(lx, ly)) {
      expState = 'moving'
      expDragStart = { lx, ly, sel: { ...expSel } }; return
    }
  }
  expState = 'selecting'
  expAnchor = { x: lx, y: ly }
  expSel    = { x: lx, y: ly, w: 0, h: 0 }
  setExpHint('idle'); drawExp()
})

expandCanvas.addEventListener('mousemove', e => {
  const { x: lx, y: ly } = toLogP(e.offsetX, e.offsetY)

  if (expState === 'selected') {
    const h = expHitHandle(lx, ly)
    expandCanvas.style.cursor = h ? EXP_CURSORS[h] : expInSel(lx, ly) ? 'move' : 'crosshair'
  }

  if (expState === 'selecting') {
    expSel = { x: lx, y: ly, w: 0, h: 0 }; drawExp(); return
  }
  if (expState === 'moving') {
    const dx = lx - expDragStart.lx, dy = ly - expDragStart.ly
    expSel = expClamp(expDragStart.sel.x+dx, expDragStart.sel.y+dy, expDragStart.sel.w, expDragStart.sel.h)
    drawExp(); return
  }
  if (expState === 'resizing') {
    expApplyResize(expActiveHnd, lx - expDragStart.lx, ly - expDragStart.ly)
    drawExp()
  }
})

expandCanvas.addEventListener('mouseup', () => {
  if (expState === 'selecting') {
    const n = expNorm()
    if (n.w >= EXP_MIN && n.h >= EXP_MIN) {
      expSel = n; expState = 'selected'; setExpHint('selected')
    } else {
      expState = 'idle'; setExpHint('idle')
    }
    drawExp(); return
  }
  if (expState === 'resizing' || expState === 'moving') expState = 'selected'
})

expandCanvas.addEventListener('dblclick', () => { if (expState === 'selected') expConfirm() })

document.addEventListener('keydown', e => {
  if (!expandOverlay.classList.contains('active')) return
  if (e.key === 'Enter')  { expConfirm(); e.stopPropagation() }
  if (e.key === 'Escape') { expandOverlay.classList.remove('active'); e.stopPropagation() }
}, true)   // capture = true → processa antes dos outros listeners

// ── Modo Recorte (Crop) ───────────────────────────────────────────────────

const cropCanvas = document.getElementById('crop-canvas')
const cropCtx    = cropCanvas.getContext('2d')
const cropHint   = document.getElementById('crop-hint')

const CROP_HR  = 5
const CROP_MIN = 5
const CROP_CURSORS = {
  nw:'nw-resize', ne:'ne-resize', se:'se-resize', sw:'sw-resize',
  n:'ns-resize',  s:'ns-resize',  e:'ew-resize',  w:'ew-resize',
}

let cropState       = 'idle'
let cropSel         = { x: 0, y: 0, w: 0, h: 0 }
let cropAnchor      = { x: 0, y: 0 }
let cropDragStart   = null
let cropActiveHnd   = null

function enterCropMode() {
  cropCanvas.width  = canvas.width
  cropCanvas.height = canvas.height
  cropCanvas.style.display = 'block'
  cropState = 'idle'
  cropSel   = { x: 0, y: 0, w: 0, h: 0 }
  setCropHint('idle')
  drawCrop()
}

function exitCropMode() {
  cropCanvas.style.display = 'none'
  cropHint.style.display   = 'none'
  cropState = 'idle'
}

function setCropHint(mode) {
  const KBD = t => `<kbd style="background:rgba(255,255,255,.15);padding:1px 5px;border-radius:3px">${t}</kbd>`
  cropHint.style.display = 'block'
  if (mode === 'idle') {
    cropHint.innerHTML = `Arraste para selecionar a área de recorte &nbsp;•&nbsp; ${KBD('Esc')} cancelar`
  } else {
    cropHint.innerHTML = `${KBD('Enter')} ou duplo clique para recortar &nbsp;•&nbsp; arraste as alças para ajustar &nbsp;•&nbsp; ${KBD('Esc')} cancelar`
  }
}

// Normaliza (garante w/h positivos durante o arraste inicial)
function cropNorm() {
  if (cropState === 'selecting') {
    return {
      x: Math.min(cropAnchor.x, cropSel.x),
      y: Math.min(cropAnchor.y, cropSel.y),
      w: Math.abs(cropSel.x - cropAnchor.x),
      h: Math.abs(cropSel.y - cropAnchor.y),
    }
  }
  return { ...cropSel }
}

function cropHandlePoints(x, y, w, h) {
  const mx = x + w/2, my = y + h/2
  return [
    ['nw',x,y], ['n',mx,y], ['ne',x+w,y],
    ['w',x,my],              ['e',x+w,my],
    ['sw',x,y+h], ['s',mx,y+h], ['se',x+w,y+h],
  ]
}

function cropHitHandle(mx, my) {
  for (const [n, hx, hy] of cropHandlePoints(cropSel.x, cropSel.y, cropSel.w, cropSel.h)) {
    if (Math.abs(mx-hx) <= CROP_HR+3 && Math.abs(my-hy) <= CROP_HR+3) return n
  }
  return null
}

function cropInSel(mx, my) {
  const s = cropSel
  return mx >= s.x && mx <= s.x+s.w && my >= s.y && my <= s.y+s.h
}

function cropClamp(x, y, w, h) {
  const W = cropCanvas.width, H = cropCanvas.height
  x = Math.max(0, x); y = Math.max(0, y)
  w = Math.min(w, W-x); h = Math.min(h, H-y)
  return { x, y, w, h }
}

function drawCrop() {
  const W = cropCanvas.width, H = cropCanvas.height
  cropCtx.clearRect(0, 0, W, H)

  if (cropState === 'idle') {
    cropCtx.fillStyle = 'rgba(0,0,0,0.15)'
    cropCtx.fillRect(0, 0, W, H)
    return
  }

  const s = cropNorm()

  // Escurece fora da seleção
  cropCtx.fillStyle = 'rgba(0,0,0,0.55)'
  cropCtx.fillRect(0, 0, W, s.y)
  cropCtx.fillRect(0, s.y, s.x, s.h)
  cropCtx.fillRect(s.x+s.w, s.y, W-(s.x+s.w), s.h)
  cropCtx.fillRect(0, s.y+s.h, W, H-(s.y+s.h))

  // Borda
  cropCtx.save()
  cropCtx.strokeStyle = '#fff'
  cropCtx.lineWidth   = 1.5
  cropCtx.setLineDash(cropState === 'selecting' ? [5,3] : [])
  cropCtx.strokeRect(s.x, s.y, s.w, s.h)
  cropCtx.setLineDash([])
  cropCtx.restore()

  // Dimensões
  const label = `${Math.round(s.w)} × ${Math.round(s.h)}`
  cropCtx.font = 'bold 12px monospace'
  const tw = cropCtx.measureText(label).width
  const lx = s.x + Math.max(0, s.w - tw - 8)
  const ly = s.y > 22 ? s.y - 6 : s.y + s.h + 16
  cropCtx.fillStyle = 'rgba(0,0,0,0.7)'
  cropCtx.fillRect(lx-4, ly-14, tw+10, 18)
  cropCtx.fillStyle = '#fff'
  cropCtx.fillText(label, lx, ly)

  // Alças
  if (cropState !== 'selecting') {
    cropCtx.save()
    cropCtx.lineWidth = 1.5
    for (const [, hx, hy] of cropHandlePoints(s.x, s.y, s.w, s.h)) {
      cropCtx.fillStyle = '#fff'
      cropCtx.strokeStyle = 'rgba(0,0,0,0.5)'
      cropCtx.fillRect(hx-CROP_HR, hy-CROP_HR, CROP_HR*2, CROP_HR*2)
      cropCtx.strokeRect(hx-CROP_HR, hy-CROP_HR, CROP_HR*2, CROP_HR*2)
    }
    cropCtx.restore()
  }
}

function cropApplyResize(handle, dx, dy) {
  let { x, y, w, h } = cropDragStart.sel
  switch (handle) {
    case 'nw': x+=dx; y+=dy; w-=dx; h-=dy; break
    case 'n':         y+=dy;         h-=dy; break
    case 'ne':        y+=dy; w+=dx;  h-=dy; break
    case 'e':                w+=dx;         break
    case 'se':               w+=dx;  h+=dy; break
    case 's':                        h+=dy; break
    case 'sw': x+=dx;        w-=dx;  h+=dy; break
    case 'w':  x+=dx;        w-=dx;         break
  }
  if (w < CROP_MIN) { if ('nw,sw,w'.includes(handle)) x = cropDragStart.sel.x + cropDragStart.sel.w - CROP_MIN; w = CROP_MIN }
  if (h < CROP_MIN) { if ('nw,n,ne'.includes(handle)) y = cropDragStart.sel.y + cropDragStart.sel.h - CROP_MIN; h = CROP_MIN }
  cropSel = cropClamp(x, y, w, h)
}

function cropConfirm() {
  if (cropState !== 'selected') return
  const { x, y, w, h } = cropSel
  if (w < CROP_MIN || h < CROP_MIN) return
  const imageData = ctx.getImageData(
    Math.round(x), Math.round(y), Math.round(w), Math.round(h)
  )
  canvas.width  = Math.round(w)
  canvas.height = Math.round(h)
  ctx.putImageData(imageData, 0, 0)
  history = []
  saveHistory()
  exitCropMode()
  // Volta para a caneta
  document.querySelector('[data-tool="pen"]').click()
}

// Eventos do crop canvas
cropCanvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return
  const mx = e.offsetX, my = e.offsetY

  if (cropState === 'selected') {
    const h = cropHitHandle(mx, my)
    if (h) {
      cropState = 'resizing'
      cropActiveHnd = h
      cropDragStart = { mx, my, sel: { ...cropSel } }
      return
    }
    if (cropInSel(mx, my)) {
      cropState = 'moving'
      cropDragStart = { mx, my, sel: { ...cropSel } }
      return
    }
    // Fora: nova seleção
  }
  cropState  = 'selecting'
  cropAnchor = { x: mx, y: my }
  cropSel    = { x: mx, y: my, w: 0, h: 0 }
  setCropHint('idle')
  drawCrop()
})

cropCanvas.addEventListener('mousemove', e => {
  const mx = e.offsetX, my = e.offsetY

  // Atualiza cursor
  if (cropState === 'selected') {
    const h = cropHitHandle(mx, my)
    cropCanvas.style.cursor = h ? CROP_CURSORS[h] : cropInSel(mx, my) ? 'move' : 'crosshair'
  } else {
    cropCanvas.style.cursor = 'crosshair'
  }

  if (cropState === 'selecting') {
    cropSel = { x: mx, y: my, w: 0, h: 0 }
    drawCrop(); return
  }
  if (cropState === 'moving') {
    const dx = mx - cropDragStart.mx, dy = my - cropDragStart.my
    cropSel = cropClamp(cropDragStart.sel.x+dx, cropDragStart.sel.y+dy, cropDragStart.sel.w, cropDragStart.sel.h)
    drawCrop(); return
  }
  if (cropState === 'resizing') {
    cropApplyResize(cropActiveHnd, mx - cropDragStart.mx, my - cropDragStart.my)
    drawCrop()
  }
})

cropCanvas.addEventListener('mouseup', () => {
  if (cropState === 'selecting') {
    const n = cropNorm()
    if (n.w >= CROP_MIN && n.h >= CROP_MIN) {
      cropSel   = n
      cropState = 'selected'
      setCropHint('selected')
    } else {
      cropState = 'idle'
      setCropHint('idle')
    }
    drawCrop(); return
  }
  if (cropState === 'resizing' || cropState === 'moving') {
    cropState = 'selected'
  }
})

cropCanvas.addEventListener('dblclick', () => {
  if (cropState === 'selected') cropConfirm()
})

// Ativa caneta por padrão
document.querySelector('[data-tool="pen"]').click()
