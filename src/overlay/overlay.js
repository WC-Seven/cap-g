const canvas = document.getElementById('canvas')
const ctx    = canvas.getContext('2d')
const hint   = document.getElementById('hint')

const W = canvas.width  = window.screen.width
const H = canvas.height = window.screen.height
canvas.style.width  = '100vw'
canvas.style.height = '100vh'

let img   = null
let state = 'idle'   // idle | selecting | selected | resizing | moving
let sel   = { x: 0, y: 0, w: 0, h: 0 }  // sempre normalizado (w/h positivos) em selected
let anchor     = { x: 0, y: 0 }           // ponto fixo durante o primeiro arraste
let dragStart  = { mx: 0, my: 0, sel: null }
let activeHandle = null

const HR = 5  // metade do tamanho das alças (half-radius)
const MIN_SEL = 5

// ── Screenshot ────────────────────────────────────────────────────────────

window.electronAPI.onSetScreenshot(base64 => {
  img = new Image()
  img.onload = () => draw()
  img.src = `data:image/png;base64,${base64}`
})

// ── Desenho ───────────────────────────────────────────────────────────────

function draw() {
  ctx.clearRect(0, 0, W, H)
  if (img) ctx.drawImage(img, 0, 0, W, H)
  if (state === 'idle') return

  const { x, y, w, h } = getNorm()

  // Overlay escuro em volta da seleção
  ctx.fillStyle = 'rgba(0,0,0,0.48)'
  ctx.fillRect(0,     0, W,   y)           // topo
  ctx.fillRect(0,     y, x,   h)           // esquerda
  ctx.fillRect(x + w, y, W - (x+w), h)    // direita
  ctx.fillRect(0, y + h, W,   H - (y+h))  // baixo

  // Mostra screenshot na área selecionada
  if (w > 0 && h > 0 && img) {
    ctx.drawImage(img, x, y, w, h, x, y, w, h)
  }

  // Borda
  ctx.save()
  ctx.strokeStyle = '#1e90ff'
  ctx.lineWidth = 1.5
  ctx.setLineDash(state === 'selecting' ? [5, 3] : [])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
  ctx.restore()

  // Indicador de tamanho
  drawSizeLabel(x, y, w, h)

  // Alças (só quando seleção está confirmada)
  if (state !== 'selecting') drawHandles(x, y, w, h)
}

function drawSizeLabel(x, y, w, h) {
  const label = `${Math.round(w)} × ${Math.round(h)}`
  ctx.font = 'bold 12px monospace'
  const tw = ctx.measureText(label).width
  const lx = x + Math.max(0, w - tw - 8)
  const ly = y > 22 ? y - 6 : y + h + 16
  ctx.fillStyle = 'rgba(0,0,0,0.72)'
  ctx.fillRect(lx - 4, ly - 14, tw + 10, 18)
  ctx.fillStyle = '#fff'
  ctx.fillText(label, lx, ly)
}

function handlePoints(x, y, w, h) {
  const mx = x + w / 2, my = y + h / 2
  return [
    ['nw', x,     y    ], ['n', mx,    y    ], ['ne', x+w,  y    ],
    ['w',  x,     my   ],                      ['e',  x+w,  my   ],
    ['sw', x,     y+h  ], ['s', mx,    y+h  ], ['se', x+w,  y+h  ],
  ]
}

function drawHandles(x, y, w, h) {
  ctx.save()
  ctx.lineWidth = 1.5
  for (const [, hx, hy] of handlePoints(x, y, w, h)) {
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#1e90ff'
    ctx.fillRect(hx - HR, hy - HR, HR*2, HR*2)
    ctx.strokeRect(hx - HR, hy - HR, HR*2, HR*2)
  }
  ctx.restore()
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getNorm() {
  if (state === 'selecting') {
    return {
      x: anchor.x < sel.x ? anchor.x : sel.x,
      y: anchor.y < sel.y ? anchor.y : sel.y,
      w: Math.abs(sel.x - anchor.x),
      h: Math.abs(sel.y - anchor.y),
    }
  }
  return { ...sel }
}

function hitHandle(mx, my) {
  for (const [name, hx, hy] of handlePoints(sel.x, sel.y, sel.w, sel.h)) {
    if (Math.abs(mx - hx) <= HR + 3 && Math.abs(my - hy) <= HR + 3) return name
  }
  return null
}

function inSel(mx, my) {
  return mx >= sel.x && mx <= sel.x + sel.w && my >= sel.y && my <= sel.y + sel.h
}

function clampSel(x, y, w, h) {
  x = Math.max(0, x); y = Math.max(0, y)
  w = Math.min(w, W - x); h = Math.min(h, H - y)
  return { x, y, w, h }
}

// ── Cursor ────────────────────────────────────────────────────────────────

const HANDLE_CURSORS = {
  nw: 'nw-resize', ne: 'ne-resize', se: 'se-resize', sw: 'sw-resize',
  n: 'ns-resize',  s: 'ns-resize',  e: 'ew-resize',  w: 'ew-resize',
}

function updateCursor(mx, my) {
  if (state === 'idle' || state === 'selecting') {
    document.body.style.cursor = 'crosshair'; return
  }
  const h = hitHandle(mx, my)
  if (h) { document.body.style.cursor = HANDLE_CURSORS[h]; return }
  document.body.style.cursor = inSel(mx, my) ? 'move' : 'crosshair'
}

// ── Hint ──────────────────────────────────────────────────────────────────

const KBD = t => `<kbd style="background:rgba(255,255,255,.15);padding:1px 5px;border-radius:3px">${t}</kbd>`

function setHint(mode) {
  if (mode === 'idle') {
    hint.innerHTML = `Arraste para selecionar &nbsp;•&nbsp; ${KBD('Esc')} cancelar`
  } else {
    hint.innerHTML = `${KBD('Enter')} ou duplo clique para capturar &nbsp;•&nbsp; arraste as alças para redimensionar &nbsp;•&nbsp; ${KBD('Esc')} cancelar`
  }
}

setHint('idle')

// ── Mouse ─────────────────────────────────────────────────────────────────

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return
  const mx = e.clientX, my = e.clientY

  if (state === 'selected') {
    const h = hitHandle(mx, my)
    if (h) {
      state = 'resizing'
      activeHandle = h
      dragStart = { mx, my, sel: { ...sel } }
      return
    }
    if (inSel(mx, my)) {
      state = 'moving'
      dragStart = { mx, my, sel: { ...sel } }
      return
    }
    // Clique fora → nova seleção
    state = 'selecting'
    anchor = { x: mx, y: my }
    sel    = { x: mx, y: my, w: 0, h: 0 }
    setHint('idle')
    draw()
    return
  }

  // idle → selecting
  state  = 'selecting'
  anchor = { x: mx, y: my }
  sel    = { x: mx, y: my, w: 0, h: 0 }
})

canvas.addEventListener('mousemove', e => {
  const mx = e.clientX, my = e.clientY
  updateCursor(mx, my)

  if (state === 'selecting') {
    sel = { x: mx, y: my, w: 0, h: 0 }  // só guardamos o ponto atual; getNorm() calcula rect
    draw()
    return
  }

  if (state === 'moving') {
    const dx = mx - dragStart.mx, dy = my - dragStart.my
    sel = clampSel(
      dragStart.sel.x + dx,
      dragStart.sel.y + dy,
      dragStart.sel.w,
      dragStart.sel.h
    )
    draw(); return
  }

  if (state === 'resizing') {
    applyResize(activeHandle, mx - dragStart.mx, my - dragStart.my)
    draw()
  }
})

canvas.addEventListener('mouseup', () => {
  if (state === 'selecting') {
    const n = getNorm()
    if (n.w >= MIN_SEL && n.h >= MIN_SEL) {
      sel   = n
      state = 'selected'
      setHint('selected')
    } else {
      state = 'idle'
      sel   = { x: 0, y: 0, w: 0, h: 0 }
      setHint('idle')
    }
    draw(); return
  }

  if (state === 'resizing' || state === 'moving') {
    state = 'selected'
  }
})

canvas.addEventListener('dblclick', () => {
  if (state === 'selected') confirm()
})

// ── Resize ────────────────────────────────────────────────────────────────

function applyResize(handle, dx, dy) {
  let { x, y, w, h } = dragStart.sel

  switch (handle) {
    case 'nw': x += dx; y += dy; w -= dx; h -= dy; break
    case 'n':           y += dy;           h -= dy; break
    case 'ne':          y += dy; w += dx;  h -= dy; break
    case 'e':                    w += dx;           break
    case 'se':                   w += dx;  h += dy; break
    case 's':                              h += dy; break
    case 'sw': x += dx;          w -= dx;  h += dy; break
    case 'w':  x += dx;          w -= dx;           break
  }

  // Mínimo
  if (w < MIN_SEL) {
    if ('nw,sw,w'.includes(handle)) x = dragStart.sel.x + dragStart.sel.w - MIN_SEL
    w = MIN_SEL
  }
  if (h < MIN_SEL) {
    if ('nw,n,ne'.includes(handle)) y = dragStart.sel.y + dragStart.sel.h - MIN_SEL
    h = MIN_SEL
  }

  sel = clampSel(x, y, w, h)
}

// ── Teclado ───────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { window.electronAPI.selectionCancel(); return }
  if (e.key === 'Enter' && state === 'selected') { confirm(); return }

  // Setas: mover seleção pixel a pixel (Shift = 10px)
  if (state === 'selected') {
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowLeft')  { sel.x = Math.max(0, sel.x - step); e.preventDefault() }
    if (e.key === 'ArrowRight') { sel.x = Math.min(W - sel.w, sel.x + step); e.preventDefault() }
    if (e.key === 'ArrowUp')    { sel.y = Math.max(0, sel.y - step); e.preventDefault() }
    if (e.key === 'ArrowDown')  { sel.y = Math.min(H - sel.h, sel.y + step); e.preventDefault() }
    draw()
  }
})

// ── Confirmar ─────────────────────────────────────────────────────────────

function confirm() {
  window.electronAPI.selectionComplete({
    x:      Math.round(sel.x),
    y:      Math.round(sel.y),
    width:  Math.round(sel.w),
    height: Math.round(sel.h),
  })
}
