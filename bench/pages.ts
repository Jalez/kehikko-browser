import { createServer } from 'node:http'

/**
 * Typical pages for measuring what kept pages cost, served on loopback: three heavy ones (a dashboard
 * that animates a canvas every frame, polls every second and runs a CSS animation; a page ticking
 * timers every 10 ms; a page with a looping video-like animation) and three ordinary ones. Each counts
 * its own script ticks in `window.ticks`, so a test can tell whether it ran while out of sight.
 */
const HEAVY_DASHBOARD = `<!doctype html><title>dashboard</title>
<style>@keyframes spin{to{transform:rotate(360deg)}} .s{width:80px;height:80px;background:#08f;animation:spin 1s linear infinite}</style>
<div class="s"></div><canvas id="c" width="800" height="400"></canvas>
<script>
window.ticks = 0
const c = document.getElementById('c').getContext('2d')
;(function draw(t) { window.ticks++; for (let i = 0; i < 400; i++) { c.fillStyle = 'hsl(' + ((t / 10 + i) % 360) + ',70%,50%)'; c.fillRect((i * 37) % 800, (i * 53 + t / 5) % 400, 12, 12) } requestAnimationFrame(draw) })(0)
setInterval(() => { window.ticks++; fetch('/poll').catch(() => {}) }, 1000)
</script>`
const TIMERS = `<!doctype html><title>timers</title><p id="p"></p><script>window.ticks=0;setInterval(()=>{window.ticks++;document.getElementById('p').textContent=Date.now()},10)</script>`
const MOTION = `<!doctype html><title>motion</title><style>@keyframes m{50%{transform:translateX(300px) scale(2)}} b{display:block;width:50px;height:50px;background:red;animation:m 2s infinite}</style>${'<b></b>'.repeat(40)}<script>window.ticks=0;(function f(){window.ticks++;requestAnimationFrame(f)})()</script>`
const ARTICLE = (n: number) => `<!doctype html><title>article ${n}</title><script>window.ticks=0</script>${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(30)}</p>`.repeat(1)

export const PAGES: Record<string, string> = {
  '/dashboard': HEAVY_DASHBOARD,
  '/timers': TIMERS,
  '/motion': MOTION,
  '/article-1': ARTICLE(1),
  '/article-2': ARTICLE(2),
  '/article-3': ARTICLE(3),
  '/front': '<!doctype html><title>front</title><p>On screen.</p>',
}

/** Served with node:http, which needs no `Response`: the tests' DOM replaces that global. */
export async function servePages(): Promise<{ origin: string; stop(): void }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname
    if (path === '/poll') return void response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    const html = PAGES[path]
    if (!html) return void response.writeHead(404).end('not here')
    response.writeHead(200, { 'content-type': 'text/html' }).end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return { origin: `http://127.0.0.1:${port}`, stop: () => void server.close() }
}
