import { BrowserWindow } from 'electron'

const MIN_VISIBLE_MS = 2300

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { --accent: #5fd4ad; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden;
    font-family: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; -webkit-user-select: none; }
  .card { position: absolute; inset: 14px; border-radius: 22px; overflow: hidden;
    background: radial-gradient(120% 90% at 20% 0%, #1a1a20 0%, #0d0d10 55%, #0a0a0b 100%);
    border: 1px solid rgba(255,255,255,.07);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 30px 60px -20px rgba(0,0,0,.85);
    animation: enter .9s cubic-bezier(.16,1,.3,1) both; }
  .grid { position: absolute; inset: 0; opacity: 0;
    background-image: radial-gradient(rgba(255,255,255,.07) 1px, transparent 1.2px); background-size: 18px 18px;
    -webkit-mask-image: radial-gradient(70% 70% at 50% 45%, #000 30%, transparent 75%);
    animation: fade 1.6s .2s ease-out forwards; }
  .glow { position: absolute; width: 420px; height: 420px; left: 50%; top: 40%; transform: translate(-50%,-50%);
    background: radial-gradient(circle, rgba(95,212,173,.16), transparent 60%); filter: blur(10px); opacity: 0;
    animation: glow 2.4s .5s cubic-bezier(.16,1,.3,1) forwards; }
  .stage { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; }
  svg.logo { width: 84px; height: 84px; overflow: visible; }
  .box { fill: none; stroke: #f4f4f5; stroke-width: 1.5; stroke-dasharray: 30; stroke-dashoffset: 30;
    animation: draw .8s cubic-bezier(.65,0,.35,1) forwards; }
  .box.b2 { animation-delay: .15s; } .box.b3 { animation-delay: .3s; stroke-opacity: .4; }
  .link { fill: none; stroke: var(--accent); stroke-width: 1.7; stroke-linecap: round; stroke-dasharray: 14; stroke-dashoffset: 14;
    animation: draw .7s .75s cubic-bezier(.65,0,.35,1) forwards; }
  .pulse { fill: var(--accent); opacity: 0; animation: fade .2s 1.2s forwards; }
  .word { display: flex; font-size: 30px; font-weight: 600; letter-spacing: -.6px; color: #fafafa; }
  .word span { display: inline-block; opacity: 0; transform: translateY(14px); filter: blur(8px);
    animation: rise .9s cubic-bezier(.16,1,.3,1) forwards; }
  .tag { margin-top: -12px; font-size: 12.5px; color: #a1a1aa; opacity: 0; animation: fade .8s 1.45s forwards; }
  .engines { position: absolute; bottom: 30px; left: 0; right: 0; text-align: center;
    font: 500 10px ui-monospace, 'Cascadia Mono', Consolas, monospace; letter-spacing: 2px; color: var(--accent);
    opacity: 0; animation: fade 1s 1.7s forwards; }
  .bar { position: absolute; left: 0; bottom: 0; height: 1px; width: 100%;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    transform-origin: left; transform: scaleX(0); animation: sweep 2.2s .3s cubic-bezier(.65,0,.35,1) forwards; }
  body.out .card { animation: leave .42s cubic-bezier(.7,0,.84,0) forwards; }
  @keyframes enter { from { opacity: 0; transform: scale(.94); filter: blur(10px); } to { opacity: 1; transform: none; filter: none; } }
  @keyframes leave { to { opacity: 0; transform: scale(1.05); filter: blur(12px); } }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes fade { to { opacity: 1; } }
  @keyframes glow { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.6); } 100% { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
  @keyframes rise { to { opacity: 1; transform: none; filter: none; } }
  @keyframes sweep { to { transform: scaleX(1); } }
</style></head>
<body>
  <div class="card">
    <div class="grid"></div>
    <div class="glow"></div>
    <div class="stage">
      <svg class="logo" viewBox="0 0 24 24">
        <rect class="box" x="2.5" y="3" width="8" height="6" rx="1.6" pathLength="30"/>
        <rect class="box b3" x="13.5" y="3" width="8" height="6" rx="1.6" pathLength="30"/>
        <rect class="box b2" x="13.5" y="15" width="8" height="6" rx="1.6" pathLength="30"/>
        <path id="lk" class="link" d="M6.5 9v4.5a1.5 1.5 0 0 0 1.5 1.5h5.5" pathLength="14"/>
        <circle class="pulse" r=".75">
          <animateMotion dur="1.6s" begin="1.2s" repeatCount="indefinite"><mpath href="#lk"/></animateMotion>
        </circle>
      </svg>
      <div class="word">${[...'Viewdata']
        .map((c, i) => `<span style="animation-delay:${0.95 + i * 0.045}s">${c}</span>`)
        .join('')}</div>
      <div class="tag">Every database you run, on one dark screen.</div>
    </div>
    <div class="engines">POSTGRES · MYSQL · MARIADB · ORACLE · MONGODB</div>
    <div class="bar"></div>
  </div>
</body></html>`

export interface Splash {
  /** Plays the exit animation once the splash has been visible long enough, then reveals `main` */
  handoff(main: BrowserWindow): void
}

export function showSplash(): Splash {
  const shownAt = Date.now()
  const splash = new BrowserWindow({
    width: 560,
    height: 360,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    center: true,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML))
  splash.once('ready-to-show', () => splash.show())

  return {
    handoff(main) {
      const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt))
      setTimeout(async () => {
        if (!splash.isDestroyed()) {
          await splash.webContents.executeJavaScript(`document.body.classList.add('out')`).catch(() => {})
        }
        setTimeout(() => {
          main.setOpacity(0)
          main.show()
          main.focus()
          let o = 0
          const fade = setInterval(() => {
            o = Math.min(1, o + 0.08)
            if (!main.isDestroyed()) main.setOpacity(o)
            if (o >= 1) clearInterval(fade)
          }, 16)
          if (!splash.isDestroyed()) splash.destroy()
        }, 400)
      }, wait)
    }
  }
}
