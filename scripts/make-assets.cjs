// Renders the app icon and NSIS installer artwork from HTML, then writes PNG / ICO / BMP files into build/.
// Run with: npm run assets
const { app, BrowserWindow, nativeImage } = require('electron')
const { join } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')

const OUT = join(__dirname, '..', 'build')
const ACCENT = '#5fd4ad'
const BG = '#0a0a0b'

const LOGO = (stroke, accent, width) => `
<svg viewBox="0 0 24 24" fill="none" style="width:${width}px;height:${width}px;display:block">
  <rect x="2.5" y="3" width="8" height="6" rx="1.6" stroke="${stroke}" stroke-width="1.6"/>
  <rect x="13.5" y="15" width="8" height="6" rx="1.6" stroke="${stroke}" stroke-width="1.6"/>
  <rect x="13.5" y="3" width="8" height="6" rx="1.6" stroke="${stroke}" stroke-width="1.6" opacity="0.4"/>
  <path d="M6.5 9v4.5a1.5 1.5 0 0 0 1.5 1.5h5.5" stroke="${accent}" stroke-width="1.8" stroke-linecap="round"/>
</svg>`

const FONT = `font-family:'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif;`

const ICON_HTML = `
<body style="margin:0;background:transparent">
  <div style="width:1024px;height:1024px;display:grid;place-items:center">
    <div style="width:900px;height:900px;border-radius:212px;display:grid;place-items:center;position:relative;overflow:hidden;
      background:radial-gradient(120% 110% at 28% 12%,#22222a 0%,#111115 48%,#0a0a0b 100%);
      box-shadow:inset 0 3px 0 rgba(255,255,255,.09),inset 0 0 0 3px rgba(255,255,255,.06)">
      <div style="position:absolute;inset:0;background:radial-gradient(60% 50% at 70% 85%,rgba(95,212,173,.18),transparent 70%)"></div>
      <div style="position:relative">${LOGO('#f4f4f5', ACCENT, 600)}</div>
    </div>
  </div>
</body>`

// Designed in 164x314 CSS px, rendered at 3x and downscaled for crisp edges
const SIDEBAR_HTML = `
<body style="margin:0;background:${BG};${FONT}">
  <div style="zoom:3;width:164px;height:314px;position:relative;overflow:hidden;background:${BG}">
    <div style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.07) .6px,transparent .7px);background-size:9px 9px"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(90% 55% at 50% 30%,rgba(95,212,173,.16),transparent 70%)"></div>
    <svg viewBox="0 0 164 200" style="position:absolute;left:0;top:18px;width:164px;height:200px">
      <defs>
        <filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
      </defs>
      ${[
        'M58,52 C80,52 80,34 102,34',
        'M58,64 C82,64 80,118 104,118',
        'M146,40 C162,40 160,76 128,104',
        'M70,150 C88,150 86,126 104,126'
      ]
        .map(
          (d) =>
            `<path d="${d}" stroke="${ACCENT}" stroke-width="1.4" fill="none" opacity=".35" filter="url(#g)"/><path d="${d}" stroke="${ACCENT}" stroke-width=".9" fill="none"/>`
        )
        .join('')}
      ${[
        [14, 40, 44, 4],
        [102, 22, 44, 5],
        [104, 104, 40, 3],
        [26, 138, 44, 3]
      ]
        .map(
          ([x, y, w, rows]) => `
        <g>
          <rect x="${x}" y="${y}" width="${w}" height="${10 + rows * 8}" rx="3.5" fill="#121216" stroke="rgba(255,255,255,.12)" stroke-width=".6"/>
          <rect x="${x + 5}" y="${y + 3.5}" width="${w * 0.45}" height="2.6" rx="1.3" fill="rgba(255,255,255,.7)"/>
          ${Array.from({ length: rows })
            .map(
              (_, r) =>
                `<line x1="${x}" x2="${x + w}" y1="${y + 10 + r * 8}" y2="${y + 10 + r * 8}" stroke="rgba(255,255,255,.06)" stroke-width=".5"/>
                 <rect x="${x + 5}" y="${y + 13 + r * 8}" width="${w * (0.3 + ((r * 7 + x) % 5) / 12)}" height="2" rx="1" fill="${r === 0 ? '#e9c46a' : 'rgba(255,255,255,.22)'}"/>`
            )
            .join('')}
        </g>`
        )
        .join('')}
      ${[
        [102, 34],
        [104, 118],
        [128, 104],
        [104, 126]
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${ACCENT}"/>`)
        .join('')}
    </svg>
    <div style="position:absolute;left:16px;right:16px;bottom:22px">
      <div style="display:flex;align-items:center;gap:7px">
        ${LOGO('#f4f4f5', ACCENT, 18)}
        <span style="color:#fafafa;font-size:15px;font-weight:600;letter-spacing:-.3px">Viewdata</span>
      </div>
      <div style="margin-top:8px;color:#a1a1aa;font-size:8.5px;line-height:1.45">
        Database explorer with live analytics and self-arranging schema diagrams.
      </div>
      <div style="margin-top:10px;color:${ACCENT};font:500 6.5px ui-monospace,Consolas,monospace;letter-spacing:.9px">
        POSTGRES · MYSQL · MARIADB · ORACLE · MONGODB
      </div>
    </div>
  </div>
</body>`

const HEADER_HTML = `
<body style="margin:0;background:${BG}">
  <div style="zoom:3;width:150px;height:57px;position:relative;overflow:hidden;background:${BG}">
    <div style="position:absolute;inset:0;background:radial-gradient(70% 120% at 85% 50%,rgba(95,212,173,.18),transparent 70%)"></div>
    <svg viewBox="0 0 150 57" style="position:absolute;inset:0">
      <path d="M20,40 C50,40 60,18 96,18" stroke="${ACCENT}" stroke-opacity=".25" stroke-width=".8" fill="none"/>
      <path d="M10,22 C40,22 70,44 100,40" stroke="rgba(255,255,255,.08)" stroke-width=".8" fill="none"/>
    </svg>
    <div style="position:absolute;right:14px;top:50%;transform:translateY(-50%)">${LOGO('#f4f4f5', ACCENT, 32)}</div>
  </div>
</body>`

async function render(html, width, height) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  const file = join(require('node:os').tmpdir(), `viewdata-asset-${width}x${height}.html`)
  writeFileSync(file, `<!doctype html><meta charset="utf-8">${html}`)
  await win.loadFile(file)
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width, height })
  win.destroy()
  return img
}

function toBmp24(img, width, height, bg = [10, 10, 11]) {
  const sized = img.resize({ width, height, quality: 'best' })
  const bgra = sized.toBitmap()
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const data = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = bgra[i + 3] / 255
      const o = (height - 1 - y) * rowSize + x * 3
      data[o] = Math.round(bgra[i] * a + bg[2] * (1 - a))
      data[o + 1] = Math.round(bgra[i + 1] * a + bg[1] * (1 - a))
      data[o + 2] = Math.round(bgra[i + 2] * a + bg[0] * (1 - a))
    }
  }
  const header = Buffer.alloc(54)
  header.write('BM', 0)
  header.writeUInt32LE(54 + data.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(data.length, 34)
  header.writeInt32LE(2835, 38)
  header.writeInt32LE(2835, 42)
  return Buffer.concat([header, data])
}

function toIco(img, sizes) {
  const pngs = sizes.map((s) => img.resize({ width: s, height: s, quality: 'best' }).toPNG())
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  const entries = Buffer.alloc(16 * sizes.length)
  let offset = 6 + entries.length
  sizes.forEach((s, i) => {
    const e = i * 16
    entries.writeUInt8(s >= 256 ? 0 : s, e)
    entries.writeUInt8(s >= 256 ? 0 : s, e + 1)
    entries.writeUInt16LE(1, e + 4)
    entries.writeUInt16LE(32, e + 6)
    entries.writeUInt32LE(pngs[i].length, e + 8)
    entries.writeUInt32LE(offset, e + 12)
    offset += pngs[i].length
  })
  return Buffer.concat([header, entries, ...pngs])
}

app.disableHardwareAcceleration()
// each render window is destroyed right after capture; keep the app alive between them
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true })

  const icon = await render(ICON_HTML, 1024, 1024)
  writeFileSync(join(OUT, 'icon.png'), icon.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
  writeFileSync(join(OUT, 'icon.ico'), toIco(icon, [16, 24, 32, 48, 64, 128, 256]))

  const sidebar = await render(SIDEBAR_HTML, 164 * 3, 314 * 3)
  writeFileSync(join(OUT, 'installerSidebar.bmp'), toBmp24(sidebar, 164, 314))

  const header = await render(HEADER_HTML, 150 * 3, 57 * 3)
  writeFileSync(join(OUT, 'installerHeader.bmp'), toBmp24(header, 150, 57))

  console.log('assets written to', OUT)
  app.exit(0)
})
