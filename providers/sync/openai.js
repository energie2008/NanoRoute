/**
 * OpenAI-compatible upstream model sync.
 *
 * Works for: OpenAI, DeepSeek, Moonshot, Zhipu, Qwen (compatible-mode),
 * Doubao, Mistral, xAI, and any vendor exposing GET /v1/models.
 *
 * Response shape: { object: "list", data: [{ id, owned_by, created }, ...] }
 */

import { request } from 'undici';

export async function syncOpenAI(channel, opts = {}) {
  const base = normalizeBase(channel.base_url) || 'https://api.openai.com';
  const endpoint = channel.models_endpoint || '/v1/models';
  const url = joinUrl(base, endpoint);

  const headers = { 'Content-Type': 'application/json' };
  const cred = channel.api_key || channel.token;
  if (cred) headers['Authorization'] = `Bearer ${cred}`;

  const { statusCode, body } = await request(url, {
    method: 'GET',
    headers,
    headersTimeout: 12000,
    bodyTimeout: 20000,
    signal: opts.signal,
  });

  const text = await body.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  if (statusCode >= 400) {
    const msg = data?.error?.message || data?.message || `HTTP ${statusCode}`;
    const err = new Error(`OpenAI sync failed: ${msg}`);
    err.status = statusCode;
    throw err;
  }

  const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
  return list
    .filter(m => m && (m.id || m.name))
    .map(m => ({
      id: m.id || m.name,
      name: m.name || m.id,
      owned_by: m.owned_by || m.owned_by || undefined,
      created: m.created || undefined,
      context: guessContext(m.id || m.name),
      capabilities: guessCapabilities(m.id || m.name),
    }));
}

export function normalizeBase(base) {
  if (!base) return null;
  return String(base).replace(/\/+$/, '');
}

export function joinUrl(base, endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;
  return base + endpoint;
}

/** Heuristic context window from a model id (best-effort, refined by presets later). */
export function guessContext(id) {
  const s = String(id || '').toLowerCase();
  if (/\d{4,}k/.test(s)) {
    const m = s.match(/(\d{3,6})k/);
    if (m) return parseInt(m[1], 10) * 1024;
  }
  if (s.includes('1m') || s.includes('1048')) return 1048576;
  if (s.includes('2m') || s.includes('2097')) return 2097152;
  if (s.includes('200k') || s.includes('200000')) return 200000;
  if (s.includes('128k') || s.includes('128000')) return 128000;
  return undefined;
}

/** Heuristic capabilities from a model id. */
export function guessCapabilities(id) {
  const s = String(id || '').toLowerCase();
  const caps = ['chat'];
  if (s.includes('vision') || s.includes('4o') || s.includes('gpt-4') ||
      s.includes('gemini') || s.includes('claude-3') || s.includes('claude-4') ||
      s.includes('sonnet') || s.includes('opus') || s.includes('qwen-vl') ||
      s.includes('glm-4') || s.includes('vl')) {
    caps.push('vision');
  }
  if (s.includes('embedding')) {
    return ['embedding'];
  }
  return caps;
}
