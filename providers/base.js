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
    // Phase 1.4: 模型能力声明(用于文本模型剥图等判断)
    this._caps = Array.isArray(config.capabilities) ? config.capabilities : null;
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

  /**
   * Phase 2.1: 归一化 usage(缓存三桶守恒)
   *
   * 上游 usage 字段不一致:
   *   - Anthropic: input_tokens / cache_read_input_tokens / cache_creation_input_tokens / output_tokens
   *   - OpenAI: prompt_tokens(含缓存) / completion_tokens
   *   - Gemini: promptTokenCount / candidatesTokenCount / cachedContentTokenCount
   *
   * 归一化为统一格式:
   *   { prompt_tokens, completion_tokens, total_tokens,
   *     cache_read_tokens, cache_creation_tokens, real_input_tokens }
   *
   * 守恒公式: input + cache_read + cache_creation == prompt_tokens
   */
  _normalizeUsage(usage, providerType) {
    if (!usage || typeof usage !== 'object') {
      return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
               cache_read_tokens: 0, cache_creation_tokens: 0, real_input_tokens: 0 };
    }

    let promptTokens = 0;
    let completionTokens = 0;
    let cacheRead = 0;
    let cacheCreation = 0;

    if (providerType === 'anthropic' || usage.input_tokens !== undefined) {
      // Anthropic 风格
      promptTokens = usage.input_tokens || 0;
      completionTokens = usage.output_tokens || 0;
      cacheRead = usage.cache_read_input_tokens || 0;
      cacheCreation = usage.cache_creation_input_tokens || 0;
    } else if (providerType === 'gemini' || usage.promptTokenCount !== undefined) {
      // Gemini 风格
      promptTokens = usage.promptTokenCount || 0;
      completionTokens = usage.candidatesTokenCount || 0;
      cacheRead = usage.cachedContentTokenCount || 0;
      cacheCreation = 0;
    } else {
      // OpenAI 风格(prompt_tokens 含缓存命中)
      promptTokens = usage.prompt_tokens || 0;
      completionTokens = usage.completion_tokens || 0;
      cacheRead = usage.prompt_tokens_details?.cached_tokens || 0;
      cacheCreation = 0;
    }

    // 守恒公式:real_input = prompt - cache_read - cache_creation(防下溢)
    const realInput = Math.max(0, promptTokens - cacheRead - cacheCreation);
    const total = promptTokens + completionTokens;

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: usage.total_tokens || total,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreation,
      real_input_tokens: realInput,
    };
  }
}
