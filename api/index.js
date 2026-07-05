import { ConfigAPI } from './config.js';
import { SyncAPI } from './sync.js';
import { getDB, getModelBreakdown, getRecentErrorsList, getRtkStats } from '../state/db.js';
import { parseBody, sendJSON, sendError } from '../utils/http.js';
import { getPoolStatus, getDispatcher } from '../proxy/pool.js';
import { Router } from '../router/index.js';
import { listPresets } from '../state/provider-presets.js';
import {
  getDailyUsage, getDailyUsageByProvider, getUsageSummary,
  getUsageByProvider, getUsageByModel, getCacheHitRate
} from '../state/usage-store.js';

const _sendJSON = (res, data, status = 200) => {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

const _sendError = (res, status, msg) => _sendJSON(res, { ok: false, error: msg }, status);

const rss = () => Math.round(process.memoryUsage().rss / 1024 / 1024);

export class AdminAPI {
  constructor(config, routerRef) {
    this._config = config;
    this._routerRef = routerRef;

    this._cfgAPI = new ConfigAPI(
      () => this._config,
      (newCfg) => {
        this._config = newCfg;
        this._routerRef.router = new Router(newCfg);
        console.log(`[AdminAPI] ✓ Hot-reloaded: ${newCfg.providers ? newCfg.providers.length : 0} providers, ~${rss()}MB RSS`);
      }
    );
    this._syncAPI = new SyncAPI();
  }

  async handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;
    const ctx = { sendJSON: _sendJSON, sendError: _sendError };

    let body = null;
    if (method !== 'GET') {
      try { body = await parseBody(req); } catch { body = {}; }
    }

    const handled = await this._cfgAPI.handle(req, res, path, body, ctx);
    if (handled) return;

    // Phase A: channel catalog + upstream model sync (lazy)
    const syncHandled = await this._syncAPI.handle(req, res, path, body, ctx);
    if (syncHandled) return;

    if (method === 'GET' && path === '/api/stats') {
      try {
        const db = getDB();
        const router = this._routerRef.router;
        const since = Date.now() - 86400 * 1000;
        const dbSummary = db.getSummaryStats(since);
        const providerRows = db.getProviderStats(since);
        const cbRows = db.getAllCBStates();
        const now = Date.now();

        const runtimeStats = router?.getStats?.() || {};
        const runtime = runtimeStats.runtime || {};
        const rtProviderStats = runtimeStats.provider_stats || {};

        const providers = (this._config.providers || []).map(p => {
          const dbStats = providerRows.find(r => r.provider_id === p.id) || {};
          const cbState = cbRows.find(r => r.provider_id === p.id);
          const rtStats = rtProviderStats[p.id] || {};
          return {
            id: p.id,
            type: p.type,
            model: p.model,
            priority: p.priority,
            status: cbState && cbState.cooldown_until > now ? 'cooldown' : (p.enabled !== false ? 'ok' : 'off'),
            requests: rtStats.requests || dbStats.total_requests || 0,
            success: rtStats.success || dbStats.success_count || 0,
            failed: rtStats.failed || 0,
            success_rate: (rtStats.requests > 0)
              ? (rtStats.success / rtStats.requests)
              : (dbStats.total_requests > 0 ? (dbStats.success_count / dbStats.total_requests) : 1),
            avg_latency: rtStats.avgLatency || dbStats.avg_latency || 0,
            total_tokens: rtStats.totalTokens || 0,
            rpd_used: dbStats.total_requests || 0,
            rpd_limit: p.rpd_limit,
            rpm_used: rtStats.rpmUsed || 0,
            rpm_limit: p.rpm_limit,
            last_request_at: rtStats.lastRequestAt || 0,
          };
        });

        const cbState = cbRows.filter(r => r.cooldown_until > now).map(r => ({
          type: r.model ? 'model' : 'key',
          target: r.model || r.key || r.provider_id,
          locked: false,
          failures: r.fail_count,
          remaining: Math.max(0, Math.ceil((r.cooldown_until - now) / 1000)),
        }));

        const trend = [];
        const nowTs = Date.now();
        for (let i = 29; i >= 0; i--) {
          trend.push({ ts: nowTs - i * 2000, total: 0, success: 0, error: 0 });
        }
        if (router?._requestLog) {
          const cutoff = nowTs - 60000;
          for (const entry of router._requestLog) {
            if (entry.ts < cutoff) continue;
            const idx = Math.floor((nowTs - entry.ts) / 2000);
            const pos = 29 - idx;
            if (pos >= 0 && pos < trend.length) {
              trend[pos].total++;
              if (entry.status === 200) {
                trend[pos].success++;
              } else {
                trend[pos].error++;
              }
            }
          }
          let cumulative = 0;
          for (let i = trend.length - 1; i >= 0; i--) {
            cumulative += trend[i].total;
            trend[i].total = cumulative;
          }
        }

        _sendJSON(res, {
          ok: true,
          total_requests: runtime.total_requests || dbSummary.total_requests || 0,
          requests_last_minute: runtime.requests_last_minute || 0,
          requests_last_hour: runtime.requests_last_hour || 0,
          success_count: runtime.success_count || dbSummary.success_count || 0,
          success_rate: runtime.success_rate || (dbSummary.total_requests > 0 ? (dbSummary.success_count / dbSummary.total_requests) : 1),
          avg_latency: runtime.avg_latency || dbSummary.avg_latency || 0,
          total_tokens: runtime.total_tokens || 0,
          uptime: runtime.uptime || process.uptime(),
          memory_rss: process.memoryUsage().rss,
          providers,
          cb_state: cbState,
          trend,
          rtk: runtimeStats.rtk || {},
        });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/logs') {
      try {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
        const router = this._routerRef.router;
        const logs = router?.getRequestLog?.(limit) || (router?._requestLog || []).slice(-limit).reverse();
        const formattedLogs = logs.map(e => ({
          ts: e.ts,
          time: new Date(e.ts).toLocaleTimeString(),
          model: e.model,
          resolved_model: e.resolved_model,
          status: e.status,
          provider: e.provider,
          latency: e.latency,
          tokens: e.tokens,
          tokens_in: e.tokens_in,
          tokens_out: e.tokens_out,
          stream: e.stream,
          error: e.error || null,
        }));
        _sendJSON(res, { ok: true, logs: formattedLogs });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/status') {
      const r = this._config.routing;
      const router = this._routerRef.router;
      _sendJSON(res, {
        ok: true,
        version: '0.2.0',
        uptime_s: Math.floor(process.uptime()),
        memory: { rss: rss(), heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) },
        providers: this._config.providers ? this._config.providers.length : 0,
        strategy: r ? (r.default_strategy || 'priority') : 'priority',
        proxy_pool: getPoolStatus(),
        rtk: {
          enabled: (this._config.rtk?.enabled !== false),
          caveman: (this._config.rtk?.caveman !== false),
          saved_bytes: router?._rtkStats?.savedBytes || 0,
          hits: router?._rtkStats?.hits || 0,
        },
      });
      return;
    }

    if (method === 'GET' && path === '/api/proxy/pool') {
      _sendJSON(res, { ok: true, pool: getPoolStatus() });
      return;
    }

    if (method === 'GET' && path === '/api/stats/summary') {
      try {
        const db = getDB();
        const since = Date.now() - 86400 * 1000;
        const row = db.getSummaryStats(since);
        _sendJSON(res, { ok: true, period: '24h', summary: row });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/stats/providers') {
      try {
        const db = getDB();
        const since = Date.now() - 86400 * 1000;
        const rows = db.getProviderStats(since);
        _sendJSON(res, { ok: true, providers: rows });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/stats/usage') {
      try {
        const params = url.searchParams;
        const period = params.get('period') || 'day';
        const hours = period === 'month' ? 720 : period === 'week' ? 168 : 24;
        const since = Date.now() - hours * 3600 * 1000;
        const db = getDB();
        const rows = db.getUsageTrend(since);
        _sendJSON(res, { ok: true, period, rows });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/stats/cb') {
      try {
        const db = getDB();
        const now = Date.now();
        const rows = db.getAllCBStates();
        const enriched = rows.map(r => ({
          key: r.key,
          provider_id: r.provider_id,
          model: r.model,
          fail_count: r.fail_count,
          cooldown_until: r.cooldown_until,
          active: r.cooldown_until > now,
          remaining_s: Math.max(0, Math.ceil((r.cooldown_until - now) / 1000)),
        }));
        _sendJSON(res, { ok: true, states: enriched });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'POST' && path === '/api/cb/reset') {
      try {
        const db = getDB();
        if (body && body.all) {
          db.resetAllCBStates();
          _sendJSON(res, { ok: true, message: 'All CB states reset' });
        } else if (body && body.key) {
          db.resetCBState(body.key);
          _sendJSON(res, { ok: true, message: `Reset CB state for ${body.key}` });
        } else if (body && body.target) {
          db.resetCBState(body.target);
          _sendJSON(res, { ok: true, message: `Reset CB state for ${body.target}` });
        } else {
          db.resetAllCBStates();
          _sendJSON(res, { ok: true, message: 'All CB states reset' });
        }
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'POST' && path === '/api/cb/reset-all') {
      try {
        getDB().resetAllCBStates();
        _sendJSON(res, { ok: true, message: 'All CB states reset' });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/stats/models') {
      try {
        const rows = getModelBreakdown();
        _sendJSON(res, { ok: true, models: rows });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/stats/rtk') {
      try {
        const stats = getRtkStats();
        const router = this._routerRef.router;
        _sendJSON(res, {
          ok: true,
          total_requests: stats.total_requests || 0,
          total_saved_bytes: stats.total_saved_bytes || 0,
          compressed_requests: stats.compressed_requests || 0,
          compression_ratio: stats.total_requests > 0
            ? Math.round((stats.compressed_requests / stats.total_requests) * 100)
            : 0,
          runtime_saved_bytes: router?._rtkStats?.savedBytes || 0,
          runtime_hits: router?._rtkStats?.hits || 0,
        });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/stats/errors') {
      try {
        const hours = parseInt(url.searchParams.get('hours') || '24');
        const rows = getRecentErrorsList(hours);
        _sendJSON(res, { ok: true, errors: rows });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    // ── Phase 3.2: Provider Presets 目录(添加 provider 时选择) ──
    if (method === 'GET' && path === '/api/provider-presets') {
      try {
        _sendJSON(res, { ok: true, presets: listPresets() });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    // ── Phase 2.2: 双表用量统计查询 API ──
    if (method === 'GET' && path === '/api/usage/daily') {
      try {
        const days = parseInt(url.searchParams.get('days') || '7');
        const providerId = url.searchParams.get('provider_id');
        const rows = providerId
          ? getDailyUsageByProvider(providerId, days)
          : getDailyUsage(days);
        _sendJSON(res, { ok: true, rows });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/usage/summary') {
      try {
        const days = parseInt(url.searchParams.get('days') || '7');
        _sendJSON(res, { ok: true, summary: getUsageSummary(days) });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/usage/by-provider') {
      try {
        const days = parseInt(url.searchParams.get('days') || '7');
        _sendJSON(res, { ok: true, rows: getUsageByProvider(days) });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/usage/by-model') {
      try {
        const days = parseInt(url.searchParams.get('days') || '7');
        _sendJSON(res, { ok: true, rows: getUsageByModel(days) });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'GET' && path === '/api/usage/cache-hit-rate') {
      try {
        const days = parseInt(url.searchParams.get('days') || '7');
        _sendJSON(res, { ok: true, ...getCacheHitRate(days) });
      } catch (err) {
        _sendError(res, 500, err.message);
      }
      return;
    }

    if (method === 'POST' && path === '/api/probe') {
      try {
        const { type, api_key, model, base_url, proxy } = body || {};
        if (!type || !api_key || !model) {
          _sendJSON(res, { ok: false, error: '缺少必填参数: type, api_key, model' });
          return;
        }

        const start = Date.now();
        const result = await probeProvider({ type, api_key, model, base_url, proxy });
        _sendJSON(res, {
          ok: true,
          latency_ms: Date.now() - start,
          model: result.model || model,
          tokens: result.usage?.total_tokens || null,
        });
      } catch (err) {
        _sendJSON(res, {
          ok: false,
          latency_ms: Date.now() - (body?._start || Date.now()),
          error: err.message,
          status: err.status || 0,
        });
      }
      return;
    }

    if (method === 'POST' && path === '/api/models/fetch') {
      try {
        const { type, api_key, base_url, proxy } = body || {};
        if (!type || !api_key) {
          _sendJSON(res, { ok: false, error: '缺少必填参数: type, api_key' });
          return;
        }
        const models = await fetchProviderModels({ type, api_key, base_url, proxy });
        _sendJSON(res, { ok: true, models });
      } catch (err) {
        _sendJSON(res, { ok: false, error: err.message, status: err.status || 0 });
      }
      return;
    }

    _sendError(res, 404, 'API route not found');
  }
}

async function fetchWithDispatcher(url, options = {}) {
  const dispatcher = getDispatcher();
  return fetch(url, { ...options, dispatcher });
}

async function fetchProviderModels({ type, api_key, base_url, proxy }) {
  const t = (type || '').toLowerCase();
  const isGemini = t.includes('gemini');
  const isAnthropic = t.includes('anthropic') || t.includes('claude');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    if (isGemini) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(api_key)}`;
      const response = await fetchWithDispatcher(url, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
      return (data.models || []).map(m => ({
        id: m.name?.replace('models/', '') || m.name,
        name: m.displayName || m.name?.replace('models/', ''),
        supportedMethods: m.supportedGenerationMethods || []
      })).filter(m => m.supportedMethods.some(s => s.includes('generateContent')));
    } else if (isAnthropic) {
      return [{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' }, { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' }, { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }, { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }];
    } else {
      const base = base_url || 'https://api.openai.com/v1';
      const url = `${base.replace(/\/+$/, '')}/models`;
      const response = await fetchWithDispatcher(url, {
        headers: { 'Authorization': `Bearer ${api_key}` },
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
      return (data.data || []).map(m => ({ id: m.id, name: m.id, owned_by: m.owned_by }));
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('连接超时 (10s)');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function probeProvider({ type, api_key, model, base_url, proxy }) {
  let url, headers = { 'Content-Type': 'application/json' }, body;
  const t = (type || '').toLowerCase();
  const isGemini = t.includes('gemini');
  const isAnthropic = t.includes('anthropic') || t.includes('claude');

  if (isGemini) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(api_key)}`;
    body = JSON.stringify({
      contents: [{ parts: [{ text: 'hi' }] }],
      generationConfig: { maxOutputTokens: 1 }
    });
  } else if (isAnthropic) {
    const anthBase = base_url || 'https://api.anthropic.com/v1';
    url = `${anthBase.replace(/\/+$/, '')}/messages`;
    headers['x-api-key'] = api_key;
    headers['anthropic-version'] = '2023-06-01';
    body = JSON.stringify({
      model, max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }]
    });
  } else {
    const defaultBase = 'https://api.openai.com/v1';
    const base = base_url || defaultBase;
    url = `${base.replace(/\/+$/, '')}/chat/completions`;
    headers['Authorization'] = `Bearer ${api_key}`;
    body = JSON.stringify({
      model, max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }]
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetchWithDispatcher(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!response.ok) {
      const errMsg = data.error?.message || data.message || data.msg || data.error?.code || `HTTP ${response.status}`;
      const err = new Error(errMsg);
      err.status = response.status;
      throw err;
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('连接超时 (8s)');
      timeoutErr.status = 0;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
