process.env.KANASORI_BOOT = '1';

import { createServer } from 'node:http';

function publicError(error) {
  return String(error?.stack || error)
    .replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, 'postgres://[redacted]')
    .replace(/password[=:][^\s'")]+/gi, 'password=[redacted]')
    .slice(0, 1500);
}

let appPromise;
function loadApp() {
  if (!appPromise) {
    const specifier = './' + 'classroom-server.mjs';
    appPromise = import(specifier).then(mod => mod.createApp({
      origin: process.env.APP_ORIGIN,
      secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
    })).catch(error => {
      appPromise = null;
      throw error;
    });
  }
  return appPromise;
}

function handler(req, res) {
  const path = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  loadApp().then(app => app.handle(req, res)).catch(error => {
    console.error(error);
    if (res.headersSent) return;
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(publicError(error));
  });
}

export default handler;

const port = Number(process.env.PORT || 5500);
const host = (process.env.PORT || process.env.VERCEL) ? '0.0.0.0' : (process.env.HOST || '127.0.0.1');
const server = createServer(handler);
server.on('error', error => console.error(error));
server.listen(port, host, () => console.log(`かな소리: http://${host}:${port}`));
