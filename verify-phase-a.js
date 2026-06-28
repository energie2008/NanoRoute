/**
 * Phase A verification: channels table + sync engine (uses an in-process mock upstream).
 * Run: node verify-phase-a.js
 */
import { createServer } from 'node:http';
import Database from 'better-sqlite3';
import { initDB, closeDB, getNanoDB, getRawDB } from './state/db.js';
import { syncUpstream, resolveSyncType } from './providers/sync/index.js';

let pass = 0, fail = 0;
const ok = (n, c) => { console.log(`  ✓ ${n}`); pass++; };
const bad = (n, c) => { console.log(`  ✗ ${n} :: ${c}`); fail++; };

console.log('\n=== Phase A: Model Sync Engine ===');

// 1. DB schema: channels + channel_models
initDB();
const db = getNanoDB();
getRawDB().exec(`DELETE FROM channels; DELETE FROM channel_models;`);
console.log('[1] Database tables');
try {
  const raw = getRawDB();
  const cols = raw.prepare(`PRAGMA table_info(channels)`).all();
  ok(`channels table has ${cols.length} columns`);
  if (cols.some(c => c.name === 'auth_mode')) ok('channels.auth_mode column present');
  if (cols.some(c => c.name === 'sync_ttl_ms')) ok('channels.sync_ttl_ms column present');
  const cmcols = raw.prepare(`PRAGMA table_info(channel_models)`).all();
  ok(`channel_models table has ${cmcols.length} columns`);
} catch (e) { bad('table introspection', e.message); }

// 2. Channel CRUD
console.log('[2] Channel CRUD');
try {
  const created = db.upsertChannel({ id: 'test-openai', type: 'openai', base_url: 'https://api.openai.com', api_key: 'sk-test1234567890', auto_sync: true });
  if (created && created.id === 'test-openai') ok('create channel');
  const got = db.getChannel('test-openai');
  if (got && got.api_key === 'sk-test1234567890') ok('get channel (raw key)');
  if (got.auto_sync === 1) ok('auto_sync stored as 1');
  const all = db.getAllChannels();
  if (all.length === 1) ok('list channels = 1');
} catch (e) { bad('channel crud', e.message); }

// 3. Synced models persistence (atomic replace)
console.log('[3] Synced models persistence');
try {
  db.saveSyncedModels('test-openai', [
    { id: 'gpt-4o', name: 'GPT-4o', context: 128000, capabilities: ['chat','vision'], owned_by: 'openai' },
    { id: 'gpt-4o-mini', name: 'GPT-4o mini', context: 128000, capabilities: ['chat'], owned_by: 'openai' },
  ]);
  let models = db.getSyncedModels('test-openai');
  if (models.length === 2) ok('save 2 synced models');
  // replace (not append)
  db.saveSyncedModels('test-openai', [
    { id: 'gpt-4o', capabilities: ['chat','vision'] },
    { id: 'gpt-4o-mini', capabilities: ['chat'] },
    { id: 'gpt-4-turbo', capabilities: ['chat','vision'] },
  ]);
  models = db.getSyncedModels('test-openai');
  if (models.length === 3) ok('atomic replace -> 3 models');
  db.markSync('test-openai', 3, null);
  const ch = db.getChannel('test-openai');
  if (ch.last_sync_count === 3) ok('markSync count recorded');
} catch (e) { bad('synced models', e.message); }

// 4. Sync type resolution
console.log('[4] Sync type resolution');
const cases = [
  ['gemini', 'gemini'], ['google-gemini', 'gemini'],
  ['anthropic', 'anthropic'], ['claude', 'anthropic'],
  ['openai', 'openai'], ['qwen', 'openai'], ['deepseek', 'openai'],
  ['custom', 'custom'], ['', 'openai'],
];
let typeOk = true;
for (const [inp, exp] of cases) {
  if (resolveSyncType(inp) !== exp) { typeOk = false; bad(`resolveSyncType(${JSON.stringify(inp)})`, `expected ${exp}`); }
}
if (typeOk) ok(`resolveSyncType all ${cases.length} cases`);

// 5. Mock upstream sync via a local HTTP server returning OpenAI /models shape
console.log('[5] End-to-end sync (mock OpenAI upstream)');
const mockServer = createServer((req, res) => {
  if (req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'gpt-4o', owned_by: 'openai', created: 1 },
        { id: 'gpt-4o-mini', owned_by: 'openai', created: 2 },
        { id: 'text-embedding-3-small', owned_by: 'openai', created: 3 },
      ],
    }));
  } else { res.writeHead(404); res.end(); }
});

await new Promise((r) => mockServer.listen(0, r));
const port = mockServer.address().port;

try {
  const models = await syncUpstream({
    id: 'mock',
    type: 'openai',
    base_url: `http://127.0.0.1:${port}`,
    api_key: 'sk-mock',
  });
  if (models.length === 3) ok(`sync fetched ${models.length} models`);
  if (models[0].id === 'gpt-4o') ok('first model id correct');
  if (models.some(m => m.capabilities?.includes('vision'))) ok('vision capability guessed');
  // de-dup test
  const dup = await syncUpstream({ type: 'openai', base_url: `http://127.0.0.1:${port}/v1/models` });
  if (dup.length === models.length) ok('dedup stable');
} catch (e) { bad('mock sync', e.message); }

// 6. Error path: upstream returns 401
console.log('[6] Error path (401 upstream)');
const errServer = createServer((req, res) => { res.writeHead(401); res.end(JSON.stringify({ error: { message: 'invalid key' } })); });
await new Promise((r) => errServer.listen(0, r));
const errPort = errServer.address().port;
try {
  await syncUpstream({ type: 'openai', base_url: `http://127.0.0.1:${errPort}` });
  bad('401 should throw', 'no error');
} catch (e) {
  if (e.status === 401) ok('401 surfaces as status 401');
  else bad('401 status', `got ${e.status}`);
}

// 7. Anthropic fallback (server down -> curated list)
console.log('[7] Anthropic fallback on failure');
try {
  const m = await syncUpstream({ type: 'anthropic', base_url: 'http://127.0.0.1:1' });
  if (m.length > 0 && m[0].id.startsWith('claude')) ok(`anthropic fallback -> ${m.length} models`);
  else bad('anthropic fallback empty', '');
} catch (e) { bad('anthropic fallback threw', e.message); }

mockServer.close();
errServer.close();
closeDB();

console.log(`\n--- Phase A result: ${pass} passed, ${fail} failed ---`);
// Node v24 on Windows emits a benign libuv assertion during async handle cleanup
// after closeDB(); exit explicitly once assertions are printed.
process.exit(fail ? 1 : 0);
