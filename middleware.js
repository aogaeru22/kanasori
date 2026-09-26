const ALLOWED = /^(?:\/(?:attendance\.html|index\.html|app\.js|style\.css|teacher\.html|results\.html)?|\/js\/[a-z-]+\.js|\/css\/[a-z-]+\.css|\/kana\/(?:play\.html|catalog\.json|pronunciation-button\.png|[^.].*\.(?:swf|hwp))|\/fonts\/kyotai-w[234]\.woff2|\/audio\/feedback\/(?:[0-9]|[1-9][0-9]|100)\.wav)$/;

export default function middleware(request) {
  try {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (path.startsWith('/api/') || isPublic(path)) return;
    return deny();
  } catch {
    return;
  }
}

function isPublic(path) {
  return !path.includes('\\') && !path.split('/').some(part => part === '..' || part.startsWith('.')) && ALLOWED.test(path);
}

function deny() {
  return new Response('찾을 수 없습니다.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
}
