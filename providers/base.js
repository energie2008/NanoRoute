import { request, Agent, ProxyAgent } from 'undici';
import { getDispatcher, reportProxyFailure, getGlobalProxy } from '../proxy/pool.js';

const _agentCache = new Map();

export class BaseProvider {
  constructor(config) {
    this.id = config.id;
    this.type = config.type;
    this.apiKey = config.api_key;
    this.model = config.model;
    this.baseUrl = config.base_url || this.getDefaultBaseUrl();
    this.timeout = config.timeout || 60000;
    this.maxRetries = config.max_retries || 0;
    this.priority = config.priority || 1;
    this.weight = config.weight || 1;
    this.proxy = config.proxy;
  }

  getDefaultBaseUrl() {
    throw new Error('Subclass must implement getDefaultBaseUrl');
  }

  async chatCompletion(messages, options = {}) {
    throw new Error('Subclass must implement chatCompletion');
  }

  async chatCompletionStream(messages, options = {}) {
    throw new Error('Subclass must implement chatCompletionStream');
  }

  _getDispatcher() {
    if (this.proxy === null) {
      return new Agent();
    }
    if (typeof this.proxy === 'string' && this.proxy.length > 0) {
      if (!_agentCache.has(this.proxy)) {
        _agentCache.set(this.proxy, new ProxyAgent(this.proxy));
      }
      return _agentCache.get(this.proxy);
    }
    try {
      return getDispatcher();
    } catch {
      return new Agent();
    }
  }

  _getActiveProxyUrl() {
    if (this.proxy === null) return null;
    if (typeof this.proxy === 'string' && this.proxy.length > 0) return this.proxy;
    return getGlobalProxy();
  }

  async _request(path, options = {}) {
    const url = new URL(path, this.baseUrl);
    const { method = 'GET', headers = {}, body, timeout = this.timeout } = options;

    const requestOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      bodyTimeout: timeout,
      headersTimeout: Math.min(timeout, 10000),
      dispatcher: this._getDispatcher(),
    };

    try {
      const response = await request(url, requestOptions);
      return response;
    } catch (err) {
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
        const activeProxy = this._getActiveProxyUrl();
        if (activeProxy && typeof activeProxy === 'string') {
          reportProxyFailure(activeProxy);
        }
      }
      throw err;
    }
  }

  async _streamRequest(path, options = {}) {
    const url = new URL(path, this.baseUrl);
    const { method = 'GET', headers = {}, body, timeout = this.timeout, signal } = options;

    const requestOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      bodyTimeout: timeout,
      headersTimeout: Math.min(timeout, 10000),
      signal,
      dispatcher: this._getDispatcher(),
    };

    try {
      const response = await request(url, requestOptions);
      return response;
    } catch (err) {
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
        const activeProxy = this._getActiveProxyUrl();
        if (activeProxy && typeof activeProxy === 'string') {
          reportProxyFailure(activeProxy);
        }
      }
      throw err;
    }
  }

  _parseSSEChunk(chunk) {
    const lines = chunk.split('\n');
    const events = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed === 'data: [DONE]') {
        events.push({ done: true });
        continue;
      }
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        try {
          events.push({ data: JSON.parse(data) });
        } catch {
        }
      }
    }
    return events;
  }

  async _readJSON(response) {
    const text = await response.body.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: { message: text } };
    }
  }

  _createError(statusCode, body) {
    const error = new Error(body?.error?.message || `HTTP ${statusCode}`);
    error.status = statusCode;
    error.body = body;
    return error;
  }

  classifyError(status, errorText) {
    if (status === 401 || status === 403) {
      return { type: 'auth_error', fallbackable: false, cooldown: 300 };
    }
    if (status === 429) {
      const text = (errorText || '').toLowerCase();
      if (text.includes('quota') || text.includes('exceeded') || text.includes('daily')) {
        return { type: 'quota_exceeded', fallbackable: true, cooldown: 3600, lockModel: true };
      }
      return { type: 'rate_limit', fallbackable: true, cooldown: 60 };
    }
    if (status === 400) {
      return { type: 'bad_request', fallbackable: false, cooldown: 0 };
    }
    if (status === 502 || status === 503 || status === 504) {
      return { type: 'transient', fallbackable: true, cooldown: 2, retryable: true };
    }
    if (status >= 500) {
      return { type: 'server_error', fallbackable: true, cooldown: 30 };
    }
    return { type: 'unknown', fallbackable: true, cooldown: 10 };
  }

  isFallbackable(err) {
    const classification = this.classifyError(err.status, err.message);
    return classification.fallbackable;
  }
}
