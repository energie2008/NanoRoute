/**
 * Anthropic upstream model sync.
 * Endpoint: GET /v1/models (requires anthropic-version header)
 * Response: { data: [{ id, display_name, type, created_at }, ...] }
 *
 * Falls back to a curated preset list if the upstream call fails (Anthropic's
 * /models endpoint availability varies by account), so the user still gets a
 * usable set without hard-coding in YAML.
 */

import { request } from 'undici';
import { normalizeBase, joinUrl } from './openai.js';

// Minimal fallback catalog (kept tiny; full presets live in Phase B).
const FALLBACK = [
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', capabilities: ['chat', 'vision', 'pdf'] },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', capabilities: ['chat', 'vision', 'pdf'] },
  { id: 'claude-haiku-3-5', name: 'Claude Haiku 3.5', capabilities: ['chat'] },
];

export async function syncAnthropic(channel, opts = {}) {
  const base = normalizeBase(channel.base_url) || 'https://api.anthropic.com';
  const endpoint = channel.models_endpoint || '/v1/models';
  const url = joinUrl(base, endpoint);

  const headers = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  const key = channel.api_key || channel.token;
  if (key) headers['x-api-key'] = key;

  try {
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
      // Fail-open: fall back to curated list rather than erroring.
      return FALLBACK.map(m => ({ ...m, owned_by: 'anthropic' }));
    }

    const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
    if (list.length === 0) return FALLBACK.map(m => ({ ...m, owned_by: 'anthropic' }));

    return list
      .filter(m => m && (m.id || m.name))
      .map(m => ({
        id: m.id || m.name,
        name: m.display_name || m.name || m.id,
        capabilities: ['chat', 'vision', 'pdf'],
        owned_by: 'anthropic',
      }));
  } catch {
    return FALLBACK.map(m => ({ ...m, owned_by: 'anthropic' }));
  }
}
