import { PASS_THRESHOLD } from '../js/lessons.js';

// Attempts are the durable outbox: a failed remote write never loses local work.
export function createSheetsSync(db, { url = '', token = '', preview = false, fetcher = fetch } = {}) {
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error('SHEETS_WEB_APP_URL must be a Google Apps Script /exec URL');
  const enabled = Boolean(url && token && !preview);
  db.exec('CREATE TABLE IF NOT EXISTS sheet_receipts (id TEXT PRIMARY KEY REFERENCES attempts(id), sentAt TEXT NOT NULL)');
  let running = null, failed = false, closed = false;
  function status(teacher) {
    const counts = db.prepare(`SELECT COUNT(*) total, COUNT(s.id) sent FROM attempts a LEFT JOIN sheet_receipts s ON s.id=a.id WHERE a.classId IN (SELECT classId FROM permissions WHERE teacher=?)`).get(teacher);
    return { enabled, preview, total: counts.total, sent: counts.sent, pending: counts.total-counts.sent, failed: enabled && failed };
  }
  function flush() {
    if (!enabled || closed) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      const rows = db.prepare(`SELECT a.*, c.name className FROM attempts a JOIN classes c ON c.id=a.classId LEFT JOIN sheet_receipts s ON s.id=a.id WHERE s.id IS NULL ORDER BY a.at LIMIT 50`).all();
      for (const row of rows) {
        if (closed) break;
        try {
          const { owner, ...record } = row;
          const response = await fetcher(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token, record:{...record, threshold:PASS_THRESHOLD}}), signal:AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error('Remote failure');
          const ack = await response.json();
          if (ack.ok !== true || ack.id !== row.id) throw new Error('Missing acknowledgement');
          if (closed) break;
          db.prepare('INSERT OR IGNORE INTO sheet_receipts VALUES (?,?)').run(row.id,new Date().toISOString());
          failed = false;
        } catch { failed = true; break; }
      }
    })().finally(() => { running = null; });
    return running;
  }
  let interval;
  return { status, flush, start() { if (enabled && !interval) { interval=setInterval(flush,30000); interval.unref(); void flush(); } }, close() { closed=true; clearInterval(interval); } };
}
