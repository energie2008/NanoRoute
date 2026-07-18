import Database from 'better-sqlite3';
const db = new Database('./data/nanoroute.db', { readonly: true });

console.log('=== 最近 20 条 usage_log ===');
const rows = db.prepare(`SELECT id, timestamp, provider_id, model, status, latency_ms, error
                         FROM usage_log
                         ORDER BY id DESC LIMIT 20`).all();
for (const r of rows) {
  const ts = new Date(r.timestamp * 1000).toISOString().slice(11, 19);
  console.log(`[${r.id}] ${ts} ${r.provider_id} ${r.model} status=${r.status} lat=${r.latency_ms}ms`);
  if (r.error) console.log(`     err: ${r.error.slice(0, 400)}`);
}
