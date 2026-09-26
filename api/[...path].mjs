import { createApp } from '../server.mjs';

let app;

function requireEnv() {
  if (!process.env.DATABASE_URL) return 'DATABASE_URL이 필요합니다. Supabase의 Transaction pooler 연결 문자열을 Vercel 환경변수에 넣으세요.';
  if (!process.env.APP_ORIGIN?.startsWith('https://') || process.env.APP_ORIGIN.endsWith('/')) return 'APP_ORIGIN은 https://로 시작하고 끝에 / 가 없어야 합니다.';
  return '';
}

function getHandle() {
  app ??= createApp({ origin: process.env.APP_ORIGIN, secure: true });
  return app.handle;
}

export const maxDuration = 60;

export default function handler(req, res) {
  const message = requireEnv();
  if (message) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
    return;
  }
  return getHandle()(req, res);
}
