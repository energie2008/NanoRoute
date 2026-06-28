/**
 * Phase A: Channel & model-sync API.
 *
 * Endpoints:
 *   GET    /api/channels                    list channels (api_key masked)
 *   POST   /api/channels                    create a channel { id, type, base_url, api_key, models_endpoint?, auto_sync? }
 *   PUT    /api/channels/:id                update channel
 *   DELETE /api/channels/:id                remove channel + its synced models
 *   GET    /api/channels/:id/models         read cached synced models
 *   POST   /api/channels/:id/sync           trigger upstream fetch (on-demand)
 *   POST   /api/channels/sync-all           sync every channel (startup-safe)
 *   GET    /api/sync/types                  list supported sync vendor types
 */

import { getNanoDB } from '../state/db.js';
import { syncUpstream, resolveSyncType, listSyncTypes, DEFAULT_ENDPOINTS } from '../providers/sync/index.js';

function maskKey(k) {
  if (!k) return null;
  const s = String(k);
  if (s.length <= 8) return '••••';
  return s.slice(0, 4) + '••••' + s.slice(-4);
}

function sanitizeChannel(c) {
  return {
    ...c,
    api_key: maskKey(c.api_key),
    has_key: !!c.api_key,
  };
}

export class SyncAPI {
  constructor() {
    this.db = getNanoDB();
  }

  async handle(req, res, path, body, ctx) {
    const { sendJSON, sendError } = ctx;

    // GET /api/channels
    if (req.method === 'GET' && path === '/api/channels') {
      const rows = this.db.getAllChannels().map(sanitizeChannel);
      sendJSON(res, { ok: true, channels: rows });
      return true;
    }

    // GET /api/sync/types
    if (req.method === 'GET' && path === '/api/sync/types') {
      sendJSON(res, { ok: true, types: listSyncTypes(), defaults: DEFAULT_ENDPOINTS });
      return true;
    }

    // POST /api/channels (create)
    if (req.method === 'POST' && path === '/api/channels') {
      const ch = body || {};
      if (!ch.id) return sendError(res, 400, 'id is required'), true;
      if (!ch.type) return sendError(res, 400, 'type is required'), true;
      if (this.db.getChannel(ch.id)) return sendError(res, 409, `channel ${ch.id} already exists`), true;
      try {
        const created = this.db.upsertChannel(ch);
        sendJSON(res, { ok: true, channel: sanitizeChannel(created) });
      } catch (err) {
        sendError(res, 500, err.message);
      }
      return true;
    }

    // POST /api/channels/sync-all (must be checked before :id routes)
    if (req.method === 'POST' && path === '/api/channels/sync-all') {
      const channels = this.db.getAllChannels();
      const results = [];
      for (const c of channels) {
        try {
          const count = await this._doSync(c);
          results.push({ id: c.id, ok: true, count });
        } catch (err) {
          results.push({ id: c.id, ok: false, error: err.message });
        }
      }
      sendJSON(res, { ok: true, results });
      return true;
    }

    // Routes with :id segment
    const m = path.match(/^\/api\/channels\/([^/]+)(?:\/(models|sync))?$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const sub = m[2];

      if (req.method === 'GET' && sub === 'models') return this._getModels(sendJSON, sendError, res, id), true;
      if (req.method === 'POST' && sub === 'sync') return await this._postSync(sendJSON, sendError, res, id), true;
      if (req.method === 'PUT' && !sub) return this._putChannel(sendJSON, sendError, res, id, body), true;
      if (req.method === 'DELETE' && !sub) return this._deleteChannel(sendJSON, sendError, res, id), true;
    }

    return false;
  }

  async _doSync(channel) {
    const full = this.db.getChannel(channel.id); // includes api_key
    if (!full) throw new Error('channel not found');
    if (!full.enabled) throw new Error('channel disabled');
    const models = await syncUpstream({
      id: full.id,
      type: full.type,
      api_key: full.api_key,
      base_url: full.base_url,
      models_endpoint: full.models_endpoint,
    });
    this.db.saveSyncedModels(full.id, models);
    this.db.markSync(full.id, models.length, null);
    return models.length;
  }

  async _postSync(sendJSON, sendError, res, id) {
    const channel = this.db.getChannel(id);
    if (!channel) return sendError(res, 404, `channel ${id} not found`);
    try {
      const count = await this._doSync(channel);
      const models = this.db.getSyncedModels(id);
      sendJSON(res, { ok: true, id, count, models, synced_at: Date.now() });
    } catch (err) {
      this.db.markSync(id, 0, err.message);
      sendError(res, 502, err.message);
    }
  }

  _getModels(sendJSON, sendError, res, id) {
    const channel = this.db.getChannel(id);
    if (!channel) return sendError(res, 404, `channel ${id} not found`);
    const models = this.db.getSyncedModels(id);
    const stale = channel.last_sync_at
      ? (Date.now() - channel.last_sync_at) > (channel.sync_ttl_ms || 3600000)
      : true;
    sendJSON(res, { ok: true, id, stale, count: models.length, models, last_sync_at: channel.last_sync_at });
  }

  _putChannel(sendJSON, sendError, res, id, body) {
    const existing = this.db.getChannel(id);
    if (!existing) return sendError(res, 404, `channel ${id} not found`);
    const merged = { ...existing, ...body, id };
    // If api_key came masked/empty, keep the existing one.
    if (!body.api_key) merged.api_key = existing.api_key;
    try {
      const updated = this.db.upsertChannel(merged);
      sendJSON(res, { ok: true, channel: sanitizeChannel(updated) });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  }

  _deleteChannel(sendJSON, sendError, res, id) {
    const existing = this.db.getChannel(id);
    if (!existing) return sendError(res, 404, `channel ${id} not found`);
    this.db.deleteChannel(id);
    sendJSON(res, { ok: true, deleted: id });
  }
}
