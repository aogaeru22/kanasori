import { createApp } from '../../classroom-server.mjs';

let app;

export const maxDuration = 60;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization || '';
  if (!secret || header !== `Bearer ${secret}`) {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('unauthorized');
    return;
  }
  if (!process.env.DATABASE_URL) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('DATABASE_URL이 필요합니다.');
    return;
  }
  app ??= createApp({ origin: process.env.APP_ORIGIN, secure: true });
  if (app.db.ready) await app.db.ready;
  await app.sheets.flush();
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ok');
}
