CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL,
  base_url TEXT,
  priority INTEGER DEFAULT 0,
  rpm_limit INTEGER DEFAULT 15,
  rpd_limit INTEGER DEFAULT 1500,
  status TEXT DEFAULT 'active',
  error_count INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  last_used INTEGER DEFAULT 0,
  cooldown_until INTEGER DEFAULT 0,
  cooldown_reason TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_log(provider_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_providers_status ON providers(status);
