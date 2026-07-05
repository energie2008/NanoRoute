/**
 * Phase 2.2: Usage Store —— 双表用量统计查询层
 *
 * 写入路径:db.logRequest() 同时写 usage_log(明细) + usage_daily(日聚合)
 * 查询路径:本模块提供面向仪表盘的聚合查询 API
 *
 * usage_daily 主键:(date, provider_id, model, api_key_id)
 *   - date: YYYY-MM-DD (UTC)
 *   - 按天聚合,查询 30 天仅需扫描 30*N 行,远快于扫 usage_log
 */
import { getRawDB } from './db.js';

function _db() {
  const db = getRawDB();
  if (!db) throw new Error('DB not initialized');
  return db;
}

function _utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * 查询日聚合(全局,按时间范围)
 * @param {number} days - 查询最近 N 天
 * @returns {Array} 每行一个 (date, provider_id, model) 组合
 */
export function getDailyUsage(days = 7) {
  const db = _db();
  const today = _utcDate();
  const from = _utcDate(new Date(Date.now() - days * 86400000));
  return db.prepare(`
    SELECT date, provider_id, model,
           SUM(request_count) as request_count,
           SUM(success_count) as success_count,
           SUM(error_count) as error_count,
           SUM(prompt_tokens) as prompt_tokens,
           SUM(completion_tokens) as completion_tokens,
           SUM(total_tokens) as total_tokens,
           SUM(cache_read_tokens) as cache_read_tokens,
           SUM(cache_creation_tokens) as cache_creation_tokens,
           SUM(real_input_tokens) as real_input_tokens
    FROM usage_daily
    WHERE date >= ? AND date <= ?
    GROUP BY date, provider_id, model
    ORDER BY date DESC, total_tokens DESC
  `).all(from, today);
}

/**
 * 查询某 provider 的日聚合
 */
export function getDailyUsageByProvider(providerId, days = 7) {
  const db = _db();
  const today = _utcDate();
  const from = _utcDate(new Date(Date.now() - days * 86400000));
  return db.prepare(`
    SELECT date, model,
           SUM(request_count) as request_count,
           SUM(success_count) as success_count,
           SUM(error_count) as error_count,
           SUM(prompt_tokens) as prompt_tokens,
           SUM(completion_tokens) as completion_tokens,
           SUM(total_tokens) as total_tokens,
           SUM(cache_read_tokens) as cache_read_tokens,
           SUM(cache_creation_tokens) as cache_creation_tokens
    FROM usage_daily
    WHERE provider_id = ? AND date >= ? AND date <= ?
    GROUP BY date, model
    ORDER BY date DESC, total_tokens DESC
  `).all(providerId, from, today);
}

/**
 * 全局汇总(最近 N 天)
 */
export function getUsageSummary(days = 7) {
  const db = _db();
  const from = _utcDate(new Date(Date.now() - days * 86400000));
  return db.prepare(`
    SELECT
      SUM(request_count) as request_count,
      SUM(success_count) as success_count,
      SUM(error_count) as error_count,
      SUM(prompt_tokens) as prompt_tokens,
      SUM(completion_tokens) as completion_tokens,
      SUM(total_tokens) as total_tokens,
      SUM(cache_read_tokens) as cache_read_tokens,
      SUM(cache_creation_tokens) as cache_creation_tokens,
      SUM(real_input_tokens) as real_input_tokens
    FROM usage_daily
    WHERE date >= ?
  `).get(from);
}

/**
 * 按 provider 汇总(最近 N 天)
 */
export function getUsageByProvider(days = 7) {
  const db = _db();
  const from = _utcDate(new Date(Date.now() - days * 86400000));
  return db.prepare(`
    SELECT provider_id,
           SUM(request_count) as request_count,
           SUM(success_count) as success_count,
           SUM(error_count) as error_count,
           SUM(prompt_tokens) as prompt_tokens,
           SUM(completion_tokens) as completion_tokens,
           SUM(total_tokens) as total_tokens,
           SUM(cache_read_tokens) as cache_read_tokens,
           SUM(cache_creation_tokens) as cache_creation_tokens
    FROM usage_daily
    WHERE date >= ?
    GROUP BY provider_id
    ORDER BY total_tokens DESC
  `).all(from);
}

/**
 * 按 model 汇总(最近 N 天)
 */
export function getUsageByModel(days = 7) {
  const db = _db();
  const from = _utcDate(new Date(Date.now() - days * 86400000));
  return db.prepare(`
    SELECT model,
           SUM(request_count) as request_count,
           SUM(success_count) as success_count,
           SUM(prompt_tokens) as prompt_tokens,
           SUM(completion_tokens) as completion_tokens,
           SUM(total_tokens) as total_tokens,
           SUM(cache_read_tokens) as cache_read_tokens,
           SUM(cache_creation_tokens) as cache_creation_tokens
    FROM usage_daily
    WHERE date >= ?
    GROUP BY model
    ORDER BY total_tokens DESC
  `).all(from);
}

/**
 * 缓存命中率(最近 N 天)
 * cache_hit_rate = cache_read_tokens / (cache_read_tokens + real_input_tokens)
 */
export function getCacheHitRate(days = 7) {
  const db = _db();
  const from = _utcDate(new Date(Date.now() - days * 86400000));
  const row = db.prepare(`
    SELECT
      SUM(cache_read_tokens) as cache_read,
      SUM(cache_creation_tokens) as cache_creation,
      SUM(real_input_tokens) as real_input
    FROM usage_daily
    WHERE date >= ?
  `).get(from);
  const cacheRead = row?.cache_read || 0;
  const realInput = row?.real_input || 0;
  const total = cacheRead + realInput;
  return {
    cache_read_tokens: cacheRead,
    cache_creation_tokens: row?.cache_creation || 0,
    real_input_tokens: realInput,
    cache_hit_rate: total > 0 ? cacheRead / total : 0,
  };
}
