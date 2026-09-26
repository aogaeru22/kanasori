export async function api(path, data) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('학습 서버에 연결되지 않았습니다. 서버 주소에서 다시 열어 주세요.'); }
  if (!response.ok) {
    const error = new Error(result.error || '요청을 처리하지 못했습니다.');
    error.status = response.status;
    throw error;
  }
  return result;
}
