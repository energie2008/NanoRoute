// 直接操作数据库清除所有 gemini 相关熔断状态
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'data', 'nanoroute.db');

console.log('DB path:', dbPath);
const db = new Database(dbPath);

// 查看当前熔断状态
const before = db.prepare('SELECT key, fail_count, cooldown_until, backoff_seconds FROM cb_state WHERE key LIKE ?').all('%gemini%');
console.log('\n=== Before reset ===');
for (const row of before) {
  const remaining = Math.max(0, Math.round((row.cooldown_until - Date.now()) / 1000));
  console.log(`  ${row.key.padEnd(30)} fail=${row.fail_count} cooldown=${remaining}s backoff=${row.backoff_seconds}`);
}

// 重置所有 gemini 相关的熔断状态
const result = db.prepare('UPDATE cb_state SET fail_count=0, cooldown_until=0, backoff_seconds=1 WHERE key LIKE ?').run('%gemini%');
console.log(`\nReset ${result.changes} rows`);

// 验证
const after = db.prepare('SELECT key, fail_count, cooldown_until, backoff_seconds FROM cb_state WHERE key LIKE ?').all('%gemini%');
console.log('\n=== After reset ===');
for (const row of after) {
  console.log(`  ${row.key.padEnd(30)} fail=${row.fail_count} cooldown=0s backoff=${row.backoff_seconds}`);
}

db.close();
console.log('\nDone. Gemini circuit breakers cleared.');
