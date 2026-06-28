/**
 * Model Sync Engine — Phase A
 *
 * Pull the real model list from an upstream channel (OneAPI-style FetchUpstreamModels,
 * inspired by CLIProxyAPI's one-click "fill BaseURL+Key → fetch models").
 *
 * Design rules (kept lightweight, fail-open):
 *  - Pure ESM, no new deps (uses Node's global fetch).
 *  - Per-vendor adapters live in this folder; dispatched by channel.type.
 *  - Results are normalized to: { id, name?, context?, capabilities?, input_price?, output_price? }
 *  - On any error, throw — the caller (API layer) decides fallback (fail-open, never crash request).
 */

import { syncOpenAI } from './openai.js';
import { syncGemini } from './gemini.js';
import { syncAnthropic } from './anthropic.js';
import { syncCustom } from './custom.js';
import { resolvePreset } from '../../state/model-presets.js';

const SYNC_FETCHERS = {
  openai: syncOpenAI,
  gemini: syncGemini,
  'google-gemini': syncGemini,
  anthropic: syncAnthropic,
  claude: syncAnthropic,
  nvidia: syncOpenAI,
  mimo: syncAnthropic,
  'volc-agentplan': syncOpenAI,
  shengsuan: syncOpenAI,
  subrouter: syncOpenAI,
  custom: syncCustom,
};

/** Default per-type endpoints, used when channel.models_endpoint is unset. */
export const DEFAULT_ENDPOINTS = {
  openai: '/v1/models',
  gemini: '/v1beta/models',
  'google-gemini': '/v1beta/models',
  anthropic: '/v1/models',
  claude: '/v1/models',
  nvidia: '/v1/models',
  mimo: '/v1/models',
  'volc-agentplan': '/v1/models',
  shengsuan: '/v1/models',
  subrouter: '/v1/models',
};

/**
 * Resolve which vendor type to use from a raw type string.
 * Mirrors config.js getProviderType but keeps original semantics.
 */
export function resolveSyncType(type) {
  const t = String(type || '').toLowerCase();
  if (!t) return 'openai';
  if (t.includes('gemini')) return 'gemini';
  if (t.includes('anthropic') || t.includes('claude') || t === 'mimo') return 'anthropic';
  if (t === 'custom') return 'custom';
  if (SYNC_FETCHERS[t]) return t;
  // OpenAI-compatible vendors (nvidia/shengsuan/subrouter/volc-agentplan/qwen/zhipu/deepseek/moonshot/doubao...) all speak /v1/models
  return 'openai';
}

/**
 * Fetch the upstream model list for a channel.
 * @param {object} channel { id, type, api_key|token, base_url, models_endpoint?, proxy? }
 * @param {object} [opts] { signal }
 * @returns {Promise<Array<{id:string,name?:string,context?:number,capabilities?:string[],owned_by?:string}>>}
 */
export async function syncUpstream(channel, opts = {}) {
  const syncType = resolveSyncType(channel.type);
  const fetcher = SYNC_FETCHERS[syncType] || syncOpenAI;
  const models = await fetcher(channel, opts);
  // De-dup by id, keep stable order, and enrich with presets (Phase B).
  const seen = new Set();
  const out = [];
  for (const m of models) {
    if (!m || !m.id) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(enrichWithPreset(m, syncType));
  }
  return out;
}

/**
 * Phase B: merge a synced model's metadata with the preset catalog.
 * Preset values fill gaps but never override real upstream data.
 */
function enrichWithPreset(model, syncType) {
  const family = syncType === 'gemini' ? 'gemini'
    : syncType === 'anthropic' ? 'anthropic'
    : 'openai';
  let preset;
  try {
    preset = resolvePreset(model.id, family);
  } catch {
    preset = null;
  }
  if (!preset) return model;
  const caps = (model.capabilities && model.capabilities.length)
    ? Array.from(new Set([...model.capabilities, ...preset.capabilities]))
    : preset.capabilities;
  return {
    id: model.id,
    name: model.name || model.id,
    context: model.context ?? preset.context ?? undefined,
    capabilities: caps,
    owned_by: model.owned_by || preset.family,
    // quota hints for the router (Phase B integration)
    rpd: preset.rpd,
    rpm: preset.rpm,
    family: preset.family,
    source: preset.source,
  };
}

/** List of sync-capable types (for UI). */
export function listSyncTypes() {
  return Object.keys(SYNC_FETCHERS);
}
