/**
 * Google Gemini upstream model sync.
 * Endpoint: GET /v1beta/models?key=KEY
 * Response: { models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: [...] }] }
 */

import { request } from 'undici';
import { normalizeBase, joinUrl, guessContext } from './openai.js';

export async function syncGemini(channel, opts = {}) {
  const base = normalizeBase(channel.base_url) || 'https://generativelanguage.googleapis.com';
  const endpoint = channel.models_endpoint || '/v1beta/models';
  const url = joinUrl(base, endpoint);

  // Gemini authenticates via ?key= query param or x-goog-api-key header.
  const query = [];
  const headers = { 'Content-Type': 'application/json' };
  const key = channel.api_key || channel.token;
  if (key) headers['x-goog-api-key'] = key;

  const finalUrl = query.length ? `${url}?${query.join('&')}` : url;

  const { statusCode, body } = await request(finalUrl, {
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
    const msg = data?.error?.message || `HTTP ${statusCode}`;
    const err = new Error(`Gemini sync failed: ${msg}`);
    err.status = statusCode;
    throw err;
  }

  const list = Array.isArray(data?.models) ? data.models : [];
  return list
    .filter(m => m && (m.name || m.id))
    .map(m => {
      const id = String(m.name || m.id).replace(/^models\//, '');
      const methods = m.supportedGenerationMethods || [];
      const caps = new Set(['chat']);
      if (methods.includes('generateContent')) caps.add('chat');
      if (methods.includes('embedContent')) caps.add('embedding');
      const s = id.toLowerCase();
      if (s.includes('pro') || s.includes('flash') || s.includes('gemini')) caps.add('vision');
      return {
        id,
        name: m.displayName || id,
        context: m.inputTokenLimit || guessContext(id),
        output: m.outputTokenLimit,
        capabilities: Array.from(caps),
        owned_by: 'google',
      };
    })
    .filter(m => m.capabilities.includes('chat')); // skip pure-embedding for chat routing
}
