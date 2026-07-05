import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'nanoroute.db');

let dbInstance = null;
let statements = null;

export function initDB() {
  if (dbInstance) return dbInstance;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);

  db.pragma('journal_mode = DELETE');
  db.pragma('cache_size = -2000');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');

  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      base_url TEXT,
      priority INTEGER DEFAULT 0,
      rpm_limit INTEGER DEFAULT 15,
      rpd_limit INTEGER DEFAULT 1500,
      weight INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      error_count INTEGER DEFAULT 0,
      request_count INTEGER DEFAULT 0,
      last_used INTEGER DEFAULT 0,
      cooldown_until INTEGER DEFAULT 0,
      cooldown_reason TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS key_usage (
      id TEXT PRIMARY KEY,
      rpd_used INTEGER DEFAULT 0,
      rpm_used INTEGER DEFAULT 0,
      reset_at INTEGER DEFAULT 0,
      rpm_reset_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key_id TEXT,
      status INTEGER,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      rtk_saved_bytes INTEGER DEFAULT 0,
      error TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS cb_state (
      key TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      fail_count INTEGER DEFAULT 0,
      cooldown_until INTEGER DEFAULT 0,
      backoff_seconds INTEGER DEFAULT 1,
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS proxies (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      weight INTEGER DEFAULT 1,
      type TEXT DEFAULT 'http',
      healthy INTEGER DEFAULT 1,
      last_check INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0,
      cooldown_until INTEGER DEFAULT 0
    );

    -- Phase A: channel (upstream account) + synced models catalog.
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      base_url TEXT,
      api_key TEXT,
      auth_mode TEXT DEFAULT 'api_key',     -- api_key | oauth | none
      models_endpoint TEXT,                 -- override (custom sync)
      auto_sync INTEGER DEFAULT 0,          -- sync on startup
      sync_ttl_ms INTEGER DEFAULT 3600000,  -- cache TTL for synced models
      last_sync_at INTEGER DEFAULT 0,
      last_sync_count INTEGER DEFAULT 0,
      last_sync_error TEXT,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS channel_models (
      channel_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      name TEXT,
      context INTEGER,
      capabilities TEXT,                    -- comma-separated
      owned_by TEXT,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (channel_id, model_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cm_channel ON channel_models(channel_id);
    CREATE INDEX IF NOT EXISTS idx_ul_ts ON usage_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_ul_provider ON usage_log(provider_id);
    CREATE INDEX IF NOT EXISTS idx_ul_model ON usage_log(model);
    CREATE INDEX IF NOT EXISTS idx_ul_created ON usage_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_providers_status ON providers(status);

    -- Phase 2.2: 日聚合表(按 date + provider_id + model 聚合,快速查询仪表盘)
    CREATE TABLE IF NOT EXISTS usage_daily (
      date TEXT NOT NULL,                    -- YYYY-MM-DD (UTC)
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key_id TEXT,
      request_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0,
      real_input_tokens INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (date, provider_id, model, api_key_id)
    );
  `);

  // Phase 2.2: Migration —— 给 usage_log 添加缓存三桶列(已存在则跳过)
  {
    const cols = db.pragma('table_info(usage_log)');
    const colNames = new Set(cols.map(c => c.name));
    const newCols = [
      ['cache_read_tokens', 'INTEGER DEFAULT 0'],
      ['cache_creation_tokens', 'INTEGER DEFAULT 0'],
      ['real_input_tokens', 'INTEGER DEFAULT 0'],
    ];
    for (const [name, type] of newCols) {
      if (!colNames.has(name)) {
        db.exec(`ALTER TABLE usage_log ADD COLUMN ${name} ${type}`);
      }
    }
  }

  statements = {
    insertProvider: db.prepare(`
      INSERT OR IGNORE INTO providers (id, type, api_key, model, base_url, priority, rpm_limit, rpd_limit, weight)
      VALUES (@id, @type, @api_key, @model, @base_url, @priority, @rpm_limit, @rpd_limit, @weight)
    `),
    updateProvider: db.prepare(`
      UPDATE providers
      SET type = @type, api_key = @api_key, model = @model, base_url = @base_url,
          priority = @priority, rpm_limit = @rpm_limit, rpd_limit = @rpd_limit, weight = @weight,
          updated_at = strftime('%s','now') * 1000
      WHERE id = @id
    `),
    upsertUsageLog: db.prepare(`
      INSERT INTO usage_log
        (provider_id, model, api_key_id, status,
         prompt_tokens, completion_tokens, total_tokens,
         cache_read_tokens, cache_creation_tokens, real_input_tokens,
         latency_ms, rtk_saved_bytes, error)
      VALUES
        (@provider_id, @model, @api_key_id, @status,
         @prompt_tokens, @completion_tokens, @total_tokens,
         @cache_read_tokens, @cache_creation_tokens, @real_input_tokens,
         @latency_ms, @rtk_saved_bytes, @error)
    `),
    // Phase 2.2: 日聚合 upsert(累加)
    upsertDailyUsage: db.prepare(`
      INSERT INTO usage_daily
        (date, provider_id, model, api_key_id,
         request_count, success_count, error_count,
         prompt_tokens, completion_tokens, total_tokens,
         cache_read_tokens, cache_creation_tokens, real_input_tokens)
      VALUES
        (@date, @provider_id, @model, @api_key_id,
         @request_count, @success_count, @error_count,
         @prompt_tokens, @completion_tokens, @total_tokens,
         @cache_read_tokens, @cache_creation_tokens, @real_input_tokens)
      ON CONFLICT(date, provider_id, model, api_key_id) DO UPDATE SET
        request_count = request_count + excluded.request_count,
        success_count = success_count + excluded.success_count,
        error_count = error_count + excluded.error_count,
        prompt_tokens = prompt_tokens + excluded.prompt_tokens,
        completion_tokens = completion_tokens + excluded.completion_tokens,
        total_tokens = total_tokens + excluded.total_tokens,
        cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
        cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
        real_input_tokens = real_input_tokens + excluded.real_input_tokens,
        updated_at = strftime('%s','now')
    `),
    getDailyUsage: db.prepare(`
      SELECT * FROM usage_daily WHERE date >= ? AND date <= ?
      ORDER BY date DESC, total_tokens DESC
    `),
    getDailyUsageByProvider: db.prepare(`
      SELECT * FROM usage_daily WHERE provider_id = ? AND date >= ? AND date <= ?
      ORDER BY date DESC
    `),
    v1upsertUsage: db.prepare(`
      INSERT INTO usage_log (provider_id, model, prompt_tokens, completion_tokens, latency_ms, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now') * 1000)
    `),
    incrementRequest: db.prepare(`
      UPDATE providers
      SET request_count = request_count + 1, last_used = strftime('%s','now') * 1000
      WHERE id = ?
    `),
    incrementError: db.prepare(`
      UPDATE providers
      SET error_count = error_count + 1, request_count = request_count + 1, updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `),
    setCooldown: db.prepare(`
      UPDATE providers
      SET cooldown_until = ?, cooldown_reason = ?, status = 'cooldown', updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `),
    clearCooldown: db.prepare(`
      UPDATE providers
      SET cooldown_until = 0, cooldown_reason = NULL, status = 'active', error_count = 0
      WHERE id = ? AND cooldown_until <= strftime('%s','now') * 1000
    `),
    setActive: db.prepare(`UPDATE providers SET status = 'active' WHERE id = ?`),
    getProvider: db.prepare(`SELECT * FROM providers WHERE id = ?`),
    getAllProviders: db.prepare(`SELECT * FROM providers ORDER BY priority DESC, last_used ASC`),
    getActiveProviders: db.prepare(`SELECT * FROM providers WHERE status = 'active' OR (status = 'cooldown' AND cooldown_until <= strftime('%s','now') * 1000) ORDER BY priority DESC, last_used ASC`),
    getCooldownProviders: db.prepare(`SELECT * FROM providers WHERE status = 'cooldown' AND cooldown_until > strftime('%s','now') * 1000`),
    getRequestCountLastMinute: db.prepare(`SELECT COUNT(*) as count FROM usage_log WHERE provider_id = ? AND created_at > strftime('%s','now') * 1000 - 60000`),
    getRequestCountToday: db.prepare(`SELECT COUNT(*) as count FROM usage_log WHERE provider_id = ? AND created_at > strftime('%s','now') * 1000 - 86400000`),
    getRecentErrorCount: db.prepare(`SELECT COUNT(*) as count FROM usage_log WHERE provider_id = ? AND status != 200 AND created_at > strftime('%s','now') * 1000 - 60000`),
    cbGet: db.prepare(`SELECT * FROM cb_state WHERE key = ?`),
    cbUpsert: db.prepare(`
      INSERT INTO cb_state (key, level, fail_count, cooldown_until, backoff_seconds, updated_at)
      VALUES (@key, @level, @fail_count, @cooldown_until, @backoff_seconds, @now)
      ON CONFLICT(key) DO UPDATE SET
        level = excluded.level,
        fail_count = excluded.fail_count,
        cooldown_until = excluded.cooldown_until,
        backoff_seconds = excluded.backoff_seconds,
        updated_at = excluded.updated_at
    `),
    cbReset: db.prepare(`UPDATE cb_state SET fail_count=0, cooldown_until=0, backoff_seconds=1 WHERE key=?`),
    cbGetAll: db.prepare(`SELECT * FROM cb_state ORDER BY updated_at DESC`),
    pruneLogs: db.prepare(`DELETE FROM usage_log WHERE timestamp < ?`),
    getSummaryStats: db.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status=200 THEN 1 ELSE 0 END) AS success,
        SUM(prompt_tokens) AS prompt_tokens,
        SUM(completion_tokens) AS completion_tokens,
        ROUND(AVG(latency_ms)) AS avg_latency_ms,
        SUM(rtk_saved_bytes) AS rtk_saved_bytes
      FROM usage_log WHERE timestamp >= ?
    `),
    getProviderStats: db.prepare(`
      SELECT
        provider_id,
        model,
        COUNT(*) AS requests,
        SUM(CASE WHEN status=200 THEN 1 ELSE 0 END) AS success,
        ROUND(AVG(latency_ms)) AS avg_latency_ms,
        SUM(prompt_tokens + completion_tokens) AS total_tokens
      FROM usage_log WHERE timestamp >= ?
      GROUP BY provider_id, model
      ORDER BY requests DESC
    `),
    getUsageTrend: db.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:00:00', timestamp, 'unixepoch') AS hour,
        COUNT(*) AS requests,
        SUM(prompt_tokens + completion_tokens) AS tokens
      FROM usage_log WHERE timestamp >= ?
      GROUP BY hour ORDER BY hour
    `),
    keyUsageGet: db.prepare(`SELECT * FROM key_usage WHERE id = ?`),
    keyUsageUpsert: db.prepare(`
      INSERT INTO key_usage (id, rpd_used, rpm_used, reset_at, rpm_reset_at, updated_at)
      VALUES (@id, @rpd_used, @rpm_used, @reset_at, @rpm_reset_at, @now)
      ON CONFLICT(id) DO UPDATE SET
        rpd_used = excluded.rpd_used,
        rpm_used = excluded.rpm_used,
        reset_at = excluded.reset_at,
        rpm_reset_at = excluded.rpm_reset_at,
        updated_at = excluded.updated_at
    `),
    keyUsageIncrementRPM: db.prepare(`
      UPDATE key_usage SET rpm_used = rpm_used + 1, updated_at = strftime('%s','now') WHERE id = ?
    `),
    keyUsageIncrementRPD: db.prepare(`
      UPDATE key_usage SET rpd_used = rpd_used + 1, updated_at = strftime('%s','now') WHERE id = ?
    `),
    // Phase A: channel + synced models catalog
    channelUpsert: db.prepare(`
      INSERT INTO channels (id, type, base_url, api_key, auth_mode, models_endpoint, auto_sync, sync_ttl_ms, enabled)
      VALUES (@id, @type, @base_url, @api_key, @auth_mode, @models_endpoint, @auto_sync, @sync_ttl_ms, @enabled)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        base_url = excluded.base_url,
        api_key = excluded.api_key,
        auth_mode = excluded.auth_mode,
        models_endpoint = excluded.models_endpoint,
        auto_sync = excluded.auto_sync,
        sync_ttl_ms = excluded.sync_ttl_ms,
        enabled = excluded.enabled,
        updated_at = strftime('%s','now') * 1000
    `),
    channelDelete: db.prepare(`DELETE FROM channels WHERE id = ?`),
    channelGet: db.prepare(`SELECT * FROM channels WHERE id = ?`),
    channelGetAll: db.prepare(`SELECT * FROM channels ORDER BY created_at ASC`),
    channelMarkSync: db.prepare(`
      UPDATE channels
      SET last_sync_at = @ts, last_sync_count = @count, last_sync_error = @error, updated_at = strftime('%s','now') * 1000
      WHERE id = @id
    `),
    channelClearModels: db.prepare(`DELETE FROM channel_models WHERE channel_id = ?`),
    channelInsertModel: db.prepare(`
      INSERT OR REPLACE INTO channel_models (channel_id, model_id, name, context, capabilities, owned_by, fetched_at)
      VALUES (@channel_id, @model_id, @name, @context, @capabilities, @owned_by, @fetched_at)
    `),
    channelModels: db.prepare(`SELECT * FROM channel_models WHERE channel_id = ? ORDER BY model_id`),
    getModelStats: db.prepare(`
      SELECT
        model,
        COUNT(*) AS requests,
        SUM(CASE WHEN status=200 THEN 1 ELSE 0 END) AS success,
        ROUND(AVG(latency_ms)) AS avg_latency_ms,
        SUM(prompt_tokens + completion_tokens) AS total_tokens
      FROM usage_log WHERE timestamp >= ?
      GROUP BY model
      ORDER BY requests DESC
    `),
    getRecentErrors: db.prepare(`
      SELECT provider_id, model, status, error, created_at
      FROM usage_log
      WHERE status != 200 AND timestamp >= ?
      ORDER BY created_at DESC LIMIT 100
    `),
    getRtkStats: db.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(rtk_saved_bytes) AS total_saved_bytes,
        SUM(CASE WHEN rtk_saved_bytes > 0 THEN 1 ELSE 0 END) AS compressed_requests
      FROM usage_log WHERE timestamp >= ?
    `),
    getGroupTokenUsage: db.prepare(`
      SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS used
      FROM usage_log
      WHERE provider_id LIKE ? ESCAPE '\\'
    `),
  };

  dbInstance = db;

  pruneOldLogs(30);

  return db;
}

export function getDB() {
  return getNanoDB();
}

export function getRawDB() {
  if (!dbInstance) initDB();
  return dbInstance;
}

export function closeDB() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    statements = null;
  }
}

class NanoDB {
  constructor() {
    if (!dbInstance) initDB();
    this.db = dbInstance;
    this.stmt = statements;
  }

  ensureProvider(id, type, apiKey, model, baseUrl = null, priority = 0, rpmLimit = 15, rpdLimit = 1500, weight = 1) {
    const existing = this.stmt.getProvider.get(id);
    if (!existing) {
      this.stmt.insertProvider.run({
        id, type, api_key: apiKey, model, base_url: baseUrl,
        priority, rpm_limit: rpmLimit, rpd_limit: rpdLimit, weight
      });
    } else {
      this.stmt.updateProvider.run({
        id, type, api_key: apiKey, model, base_url: baseUrl,
        priority, rpm_limit: rpmLimit, rpd_limit: rpdLimit, weight
      });
    }
    return this.stmt.getProvider.get(id);
  }

  saveRequest(providerId, model, tokensIn = 0, tokensOut = 0, latencyMs = 0, error = null) {
    const status = error ? 500 : 200;
    this.stmt.upsertUsageLog.run({
      provider_id: providerId,
      model: model,
      api_key_id: null,
      status: status,
      prompt_tokens: tokensIn,
      completion_tokens: tokensOut,
      total_tokens: tokensIn + tokensOut,
      latency_ms: latencyMs,
      rtk_saved_bytes: 0,
      error: error
    });
    if (error) {
      this.stmt.incrementError.run(providerId);
    } else {
      this.stmt.incrementRequest.run(providerId);
      const provider = this.stmt.getProvider.get(providerId);
      if (provider && provider.status === 'cooldown') {
        this.stmt.clearCooldown.run(providerId);
      }
    }
  }

  logRequest(entry) {
    const promptTokens = entry.prompt_tokens || 0;
    const completionTokens = entry.completion_tokens || 0;
    const cacheRead = entry.cache_read_tokens || 0;
    const cacheCreation = entry.cache_creation_tokens || 0;
    this.stmt.upsertUsageLog.run({
      provider_id: entry.provider_id || '',
      model: entry.model || '',
      api_key_id: entry.api_key_id || null,
      status: entry.status || 0,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: entry.total_tokens || (promptTokens + completionTokens),
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreation,
      real_input_tokens: entry.real_input_tokens || Math.max(0, promptTokens - cacheRead - cacheCreation),
      latency_ms: entry.latency_ms || 0,
      rtk_saved_bytes: entry.rtk_saved_bytes || 0,
      error: entry.error || null,
    });

    // Phase 2.2: 同步写入日聚合表
    const date = new Date().toISOString().slice(0, 10);
    const isSuccess = (entry.status || 0) >= 200 && (entry.status || 0) < 300;
    this.stmt.upsertDailyUsage.run({
      date,
      provider_id: entry.provider_id || '',
      model: entry.model || '',
      api_key_id: entry.api_key_id || null,
      request_count: 1,
      success_count: isSuccess ? 1 : 0,
      error_count: isSuccess ? 0 : 1,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: entry.total_tokens || (promptTokens + completionTokens),
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreation,
      real_input_tokens: entry.real_input_tokens || Math.max(0, promptTokens - cacheRead - cacheCreation),
    });
  }

  getNextRPDResetMs() {
    const now = new Date();
    const utcTomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return utcTomorrow.getTime();
  }

  // 查询某 Provider 分组累计已用 token 总量（按 provider_id 前缀 `${groupId}__` 聚合）
  getGroupTokenUsage(groupId) {
    if (!groupId) return 0;
    // 转义 LIKE 通配符，避免 groupId 含 % 或 _ 时误匹配
    const escaped = String(groupId).replace(/[\\%_]/g, m => '\\' + m);
    const row = this.stmt.getGroupTokenUsage.get(`${escaped}__%`);
    return row ? (row.used || 0) : 0;
  }

  getNextRPMResetMs() {
    return Date.now() + 60000;
  }

  ensureKeyUsage(id) {
    let usage = this.stmt.keyUsageGet.get(id);
    const now = Math.floor(Date.now() / 1000);
    if (!usage) {
      const resetAt = Math.floor(this.getNextRPDResetMs() / 1000);
      const rpmResetAt = Math.floor(this.getNextRPMResetMs() / 1000);
      this.stmt.keyUsageUpsert.run({
        id, rpd_used: 0, rpm_used: 0, reset_at: resetAt, rpm_reset_at: rpmResetAt, now
      });
      usage = this.stmt.keyUsageGet.get(id);
    } else {
      if (usage.reset_at < now) {
        usage.rpd_used = 0;
        usage.reset_at = Math.floor(this.getNextRPDResetMs() / 1000);
      }
      if (usage.rpm_reset_at < now) {
        usage.rpm_used = 0;
        usage.rpm_reset_at = Math.floor(this.getNextRPMResetMs() / 1000);
      }
      this.stmt.keyUsageUpsert.run({
        id,
        rpd_used: usage.rpd_used,
        rpm_used: usage.rpm_used,
        reset_at: usage.reset_at,
        rpm_reset_at: usage.rpm_reset_at,
        now
      });
    }
    return usage;
  }

  checkAndIncrementQuota(providerId, rpmLimit = 15, rpdLimit = 1500) {
    const key = `key:${providerId}`;
    const usage = this.ensureKeyUsage(key);
    const now = Math.floor(Date.now() / 1000);

    let resetAt = usage.reset_at * 1000;
    let rpmResetAt = usage.rpm_reset_at * 1000;

    if (usage.rpm_reset_at < now) {
      usage.rpm_used = 0;
      rpmResetAt = this.getNextRPMResetMs();
    }
    if (usage.reset_at < now) {
      usage.rpd_used = 0;
      resetAt = this.getNextRPDResetMs();
    }

    const rpmExceeded = usage.rpm_used >= rpmLimit;
    const rpdExceeded = usage.rpd_used >= rpdLimit;

    if (rpmExceeded || rpdExceeded) {
      return {
        allowed: false,
        rpm_used: usage.rpm_used,
        rpd_used: usage.rpd_used,
        rpm_exceeded: rpmExceeded,
        rpd_exceeded: rpdExceeded,
        rpm_reset_at: rpmResetAt,
        rpd_reset_at: resetAt
      };
    }

    this.stmt.keyUsageIncrementRPM.run(key);
    this.stmt.keyUsageIncrementRPD.run(key);

    return {
      allowed: true,
      rpm_used: usage.rpm_used + 1,
      rpd_used: usage.rpd_used + 1,
      rpm_exceeded: false,
      rpd_exceeded: false,
      rpm_reset_at: rpmResetAt,
      rpd_reset_at: resetAt
    };
  }

  isCBKeyActive(key) {
    const state = this.stmt.cbGet.get(key);
    if (!state) return { active: false };
    const now = Math.floor(Date.now() / 1000);
    if (state.cooldown_until <= now) {
      return { active: false, state };
    }
    return {
      active: true,
      remaining_s: state.cooldown_until - now,
      fail_count: state.fail_count,
      backoff: state.backoff_seconds,
      state
    };
  }

  isProviderAvailable(providerId) {
    const providerKey = `provider:${providerId}`;
    const cb = this.isCBKeyActive(providerKey);
    if (cb.active) return false;

    const provider = this.stmt.getProvider.get(providerId);
    if (!provider) return false;

    const inCooldown = provider.status === 'cooldown' && provider.cooldown_until > Date.now();
    if (inCooldown) return false;
    if (provider.status === 'cooldown') {
      this.stmt.clearCooldown.run(providerId);
    }
    return true;
  }

  isKeyAvailable(providerId) {
    const key = `key:${providerId}`;
    const cb = this.isCBKeyActive(key);
    return !cb.active;
  }

  isModelAvailable(providerId, model) {
    const modelKey = `model:${providerId}:${model}`;
    const cb = this.isCBKeyActive(modelKey);
    return !cb.active;
  }

  recordFailure(key, level, backoffInitial = 1, backoffMax = 240, backoffMultiplier = 2) {
    const now = Math.floor(Date.now() / 1000);
    const existing = this.stmt.cbGet.get(key);
    const fail_count = (existing?.fail_count || 0) + 1;
    const backoff = Math.min(backoffMax, Math.max(backoffInitial, (existing?.backoff_seconds || backoffInitial) * backoffMultiplier));
    const cooldownUntil = now + backoff;
    this.stmt.cbUpsert.run({
      key, level,
      fail_count: fail_count,
      cooldown_until: cooldownUntil,
      backoff_seconds: backoff,
      now
    });
    return { fail_count, backoff, cooldownUntil };
  }

  recordPermanentFailure(key, level, cooldownSeconds = 86400 * 30) {
    const now = Math.floor(Date.now() / 1000);
    this.stmt.cbUpsert.run({
      key, level,
      fail_count: 999,
      cooldown_until: now + cooldownSeconds,
      backoff_seconds: cooldownSeconds,
      now
    });
  }

  recordSuccess(key) {
    this.stmt.cbReset.run(key);
  }

  setCooldown(providerId, seconds, reason = '') {
    const until = Date.now() + seconds * 1000;
    this.stmt.setCooldown.run(until, reason, providerId);
  }

  getCooldownProviders() {
    const providers = this.stmt.getCooldownProviders.all();
    const now = Date.now();
    return providers.map(p => ({
      ...p,
      remaining_ms: Math.max(0, p.cooldown_until - now)
    }));
  }

  getProviderStats(param) {
    if (typeof param === 'string') {
      const provider = this.stmt.getProvider.get(param);
      if (!provider) return null;
      const rpm = this.stmt.getRequestCountLastMinute.get(param);
      const rpd = this.stmt.getRequestCountToday.get(param);
      const recentErrors = this.stmt.getRecentErrorCount.get(param);
      return {
        ...provider,
        rpm_current: rpm ? rpm.count : 0,
        rpd_current: rpd ? rpd.count : 0,
        recent_errors: recentErrors ? recentErrors.count : 0,
        is_available: this.isProviderAvailable(param)
      };
    }
    const sinceSeconds = Math.floor(param / 1000);
    return this.stmt.getProviderStats.all(sinceSeconds);
  }

  getAllProviderStats() {
    const providers = this.stmt.getAllProviders.all();
    return providers.map(p => this.getProviderStats(p.id));
  }

  getAvailableProviders() {
    const now = Date.now();
    const providers = this.stmt.getActiveProviders.all();
    for (const p of providers) {
      const canClear = p.status === 'cooldown' && p.cooldown_until <= now;
      if (canClear) {
        this.stmt.clearCooldown.run(p.id);
        p.status = 'active';
      }
    }
    return this.stmt.getActiveProviders.all();
  }

  getTotalUsage(minutes = 60) {
    const since = Math.floor(Date.now() / 1000) - minutes * 60;
    return this.stmt.getSummaryStats.get(since);
  }

  getCBState(key) {
    return this.stmt.cbGet.get(key) || null;
  }

  setCBState(key, level, fields) {
    const now = Math.floor(Date.now() / 1000);
    this.stmt.cbUpsert.run({
      key,
      level,
      fail_count: fields.fail_count ?? 0,
      cooldown_until: fields.cooldown_until ?? 0,
      backoff_seconds: fields.backoff_seconds ?? 1,
      now,
    });
  }

  resetCBState(key) {
    this.stmt.cbReset.run(key);
  }

  getAllCBState() {
    const now = Math.floor(Date.now() / 1000);
    return this.stmt.cbGetAll.all().map(r => ({
      ...r,
      active: r.cooldown_until > now,
      remaining_s: Math.max(0, r.cooldown_until - now),
    }));
  }

  getAllCBStates() {
    return this.getAllCBState();
  }

  resetAllCBStates() {
    this.stmt.cbGetAll.all().forEach(r => this.stmt.cbReset.run(r.key));
  }

  getSummary(sinceSeconds = 86400) {
    const since = Math.floor(Date.now() / 1000) - sinceSeconds;
    return this.stmt.getSummaryStats.get(since);
  }

  getSummaryStats(sinceMs) {
    const sinceSeconds = Math.floor(sinceMs / 1000);
    return this.stmt.getSummaryStats.get(sinceSeconds);
  }

  getProviderBreakdown(sinceSeconds = 86400) {
    const since = Math.floor(Date.now() / 1000) - sinceSeconds;
    return this.stmt.getProviderStats.all(since);
  }

  getModelBreakdown(sinceSeconds = 86400) {
    const since = Math.floor(Date.now() / 1000) - sinceSeconds;
    return this.stmt.getModelStats.all(since);
  }

  getRecentErrorsList(hours = 24) {
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    return this.stmt.getRecentErrors.all(since);
  }

  getRtkStats(sinceSeconds = 86400) {
    const since = Math.floor(Date.now() / 1000) - sinceSeconds;
    return this.stmt.getRtkStats.get(since);
  }

  getUsageTrend(param) {
    let sinceSeconds;
    const isMs = typeof param === 'number' && param > 10000000000;
    if (isMs) {
      sinceSeconds = Math.floor(param / 1000);
    } else {
      const hours = param || 24;
      sinceSeconds = Math.floor(Date.now() / 1000) - hours * 3600;
    }
    return this.stmt.getUsageTrend.all(sinceSeconds);
  }

  // ── Phase A: channel catalog ──────────────────────────────────────────
  upsertChannel(ch) {
    this.stmt.channelUpsert.run({
      id: ch.id,
      type: ch.type,
      base_url: ch.base_url || null,
      api_key: ch.api_key || null,
      auth_mode: ch.auth_mode || 'api_key',
      models_endpoint: ch.models_endpoint || null,
      auto_sync: ch.auto_sync ? 1 : 0,
      sync_ttl_ms: ch.sync_ttl_ms || 3600000,
      enabled: ch.enabled === false ? 0 : 1,
    });
    return this.stmt.channelGet.get(ch.id);
  }

  deleteChannel(id) {
    this.stmt.channelClearModels.run(id);
    return this.stmt.channelDelete.run(id);
  }

  getChannel(id) { return this.stmt.channelGet.get(id); }

  getAllChannels() {
    return this.stmt.channelGetAll.all().map(c => ({
      ...c,
      auto_sync: !!c.auto_sync,
      enabled: !!c.enabled,
    }));
  }

  /** Persist a freshly synced model list for a channel (atomic replace). */
  saveSyncedModels(channelId, models) {
    const tx = this.db.transaction((rows) => {
      this.stmt.channelClearModels.run(channelId);
      const fetchedAt = Date.now();
      for (const m of rows) {
        this.stmt.channelInsertModel.run({
          channel_id: channelId,
          model_id: m.id,
          name: m.name || m.id,
          context: m.context || null,
          capabilities: Array.isArray(m.capabilities) ? m.capabilities.join(',') : null,
          owned_by: m.owned_by || null,
          fetched_at: fetchedAt,
        });
      }
    });
    tx(models || []);
  }

  getSyncedModels(channelId) {
    return this.stmt.channelModels.all(channelId).map(r => ({
      id: r.model_id,
      name: r.name,
      context: r.context,
      capabilities: r.capabilities ? r.capabilities.split(',').filter(Boolean) : [],
      owned_by: r.owned_by,
      fetched_at: r.fetched_at,
    }));
  }

  markSync(id, count, error = null) {
    this.stmt.channelMarkSync.run({ id, ts: Date.now(), count, error });
  }

  close() {
    closeDB();
  }
}

let nanoDbInstance = null;

export function getNanoDB() {
  if (!nanoDbInstance) {
    initDB();
    nanoDbInstance = new NanoDB();
  }
  return nanoDbInstance;
}

export function logRequest(entry) {
  getNanoDB().logRequest(entry);
}

export function getCBState(key) {
  return getNanoDB().getCBState(key);
}

export function setCBState(key, level, fields) {
  getNanoDB().setCBState(key, level, fields);
}

export function resetCBState(key) {
  getNanoDB().resetCBState(key);
}

export function getAllCBState() {
  return getNanoDB().getAllCBState();
}

export function getAllCBStates() {
  return getNanoDB().getAllCBStates();
}

export function resetAllCBStates() {
  return getNanoDB().resetAllCBStates();
}

export function getSummaryStats(sinceMs) {
  return getNanoDB().getSummaryStats(sinceMs);
}

export function pruneOldLogs(daysToKeep = 30) {
  if (!statements) return;
  const cutoff = Math.floor(Date.now() / 1000) - daysToKeep * 86400;
  statements.pruneLogs.run(cutoff);
}

export function getSummary(sinceSeconds = 86400) {
  return getNanoDB().getSummary(sinceSeconds);
}

export function getProviderBreakdown(sinceSeconds = 86400) {
  return getNanoDB().getProviderBreakdown(sinceSeconds);
}

export function getModelBreakdown(sinceSeconds = 86400) {
  return getNanoDB().getModelBreakdown(sinceSeconds);
}

export function getRecentErrorsList(hours = 24) {
  return getNanoDB().getRecentErrorsList(hours);
}

export function getRtkStats(sinceSeconds = 86400) {
  return getNanoDB().getRtkStats(sinceSeconds);
}

export function getUsageTrend(hours = 24) {
  return getNanoDB().getUsageTrend(hours);
}

export function resetDBInstance() {
  nanoDbInstance = null;
}

export function checkAndIncrementQuota(providerId, rpmLimit, rpdLimit) {
  return getNanoDB().checkAndIncrementQuota(providerId, rpmLimit, rpdLimit);
}

export function isCBKeyActive(key) {
  return getNanoDB().isCBKeyActive(key);
}

export function isProviderAvailable(providerId) {
  return getNanoDB().isProviderAvailable(providerId);
}

export function isKeyAvailable(providerId) {
  return getNanoDB().isKeyAvailable(providerId);
}

export function isModelAvailable(providerId, model) {
  return getNanoDB().isModelAvailable(providerId, model);
}

export function recordFailure(key, level, backoffInitial, backoffMax, backoffMultiplier) {
  return getNanoDB().recordFailure(key, level, backoffInitial, backoffMax, backoffMultiplier);
}

export function recordPermanentFailure(key, level, cooldownSeconds) {
  return getNanoDB().recordPermanentFailure(key, level, cooldownSeconds);
}

export function recordSuccess(key) {
  return getNanoDB().recordSuccess(key);
}

export function getNextRPDResetMs() {
  return getNanoDB().getNextRPDResetMs();
}

export function getNextRPMResetMs() {
  return getNanoDB().getNextRPMResetMs();
}
