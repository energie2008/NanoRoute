/**
 * Custom upstream model sync.
 * For vendors exposing a non-standard /models endpoint that still returns
 * { data: [...] } or { models: [...] } or a bare array.
 */

import { request } from 'undici';
import { normalizeBase, joinUrl, guessContext, guessCapabilities } from './openai.js';

export async function syncCustom(channel, opts = {}) {
  if (!channel.models_endpoint) {
    throw new Error('custom sync requires channel.models_endpoint');
  }
  const base = normalizeBase(channel.base_url) || '';
  const url = joinUrl(base, channel.models_endpoint);

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
    const err = new Error(`Custom sync failed: HTTP ${statusCode}`);
    err.status = statusCode;
    throw err;
  }

  const list = Array.isArray(data) ? data
    : Array.isArray(data?.data) ? data.data
    : Array.isArray(data?.models) ? data.models
    : [];

  return list
    .filter(m => m && (m.id || m.name))
    .map(m => ({
      id: m.id || m.name,
      name: m.name || m.id,
      context: m.context || guessContext(m.id || m.name),
      capabilities: m.capabilities || guessCapabilities(m.id || m.name),
      owned_by: m.owned_by || undefined,
    }));
}
