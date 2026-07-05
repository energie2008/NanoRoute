import { Resolver } from './resolver.js';
import { createStrategy } from './strategy/index.js';
import { loadProvider, getCachedProviders } from '../providers/registry.js';
import { getDB, logRequest } from '../state/db.js';
import { getLimiter, ERROR_TYPES } from '../state/limiter.js';
import { acquireConcurrency, releaseConcurrency } from '../state/concurrency.js';
import { sendError } from '../utils/http.js';
import { resolvePreset } from '../state/model-presets.js';
import { getRectifier } from './rectifier.js';
import { publishEvent } from '../state/events.js';

let _FusionHandlerClass = null;
let _rtkLoaded = false;
let _compressMessages = null;
let _injectCavemanPrompt = null;

async function _lazyLoadRTK() {
  if (_rtkLoaded) return;
  const rtk = await import('../rtk/index.js');
  _compressMessages = rtk.compressMessages;
  _injectCavemanPrompt = rtk.injectCavemanPrompt;
  _rtkLoaded = true;
}

async function _lazyLoadFusion() {
  if (_FusionHandlerClass) return _FusionHandlerClass;
  const mod = await import('../fusion/index.js');
  _FusionHandlerClass = mod.FusionHandler;
  return _FusionHandlerClass;
}

export class Router {
  constructor(config) {
    this.config = config;
    this.resolver = new Resolver(config);
    this.strategy = createStrategy(config.routing?.default_strategy || 'priority');
    this.db = getDB();
    this.limiter = getLimiter(this.db, config.routing?.circuit_breaker || {});
    this.providerCache = new Map();
    this._fusion = null;
    this._rtkStats = { savedBytes: 0, hits: 0 };
    this._requestLog = [];
    this._providerStats = new Map();
    this._statsLock = false;

    this._ensureProvidersInDB();
  }

  async _getFusion() {
    if (!this._fusion) {
      const FusionHandler = await _lazyLoadFusion();
      this._fusion = new FusionHandler(this);
    }
    return this._fusion;
  }

  _getMemberTargets(resolveResult) {
    return resolveResult.memberGroups?.map(g => g.targets).flat() || [];
  }

  _addRequestLog(entry) {
    this._requestLog.push(entry);
    if (this._requestLog.length > 1000) {
      this._requestLog.shift();
    }
  }

  _updateProviderStats(providerId, latency, success, tokens = 0) {
    const stats = this._providerStats.get(providerId) || {
      requests: 0,
      success: 0,
      failed: 0,
      totalLatency: 0,
      avgLatency: 0,
      totalTokens: 0,
      rpmUsed: 0,
      lastMinute: 0,
      lastRequestAt: 0,
    };
    stats.requests++;
    if (success) {
      stats.success++;
      stats.totalTokens += tokens;
    } else {
      stats.failed++;
    }
    stats.totalLatency += latency;
    stats.avgLatency = Math.round(stats.totalLatency / stats.requests);
    stats.lastRequestAt = Date.now();

    const now = Date.now();
    const minute = Math.floor(now / 60000);
    if (stats.lastMinute !== minute) {
      stats.rpmUsed = 1;
      stats.lastMinute = minute;
    } else {
      stats.rpmUsed++;
    }
    this._providerStats.set(providerId, stats);
  }

  _ensureProvidersInDB() {
    for (const p of this.config.providers) {
      if (p.enabled) {
        this.db.ensureProvider(
          p.id,
          p.type,
          p.api_key,
          p.model,
          p.base_url || null,
          p.priority || 0,
          p.rpm_limit || null,
          p.rpd_limit || null,
          p.weight || 1
        );
      }
    }
  }

  async _getProviderInstance(providerConfig) {
    if (this.providerCache.has(providerConfig.id)) {
      return this.providerCache.get(providerConfig.id);
    }
    const ProviderClass = await loadProvider(providerConfig.type);
    const instance = new ProviderClass(providerConfig);
    this.providerCache.set(providerConfig.id, instance);
    return instance;
  }

  _getStickyKey(req) {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const auth = req.headers['authorization'] || '';
    return `${ip}:${auth.slice(0, 16)}`;
  }

  _detectRequiredCapabilities(messages) {
    const caps = { vision: false };
    if (!messages || !Array.isArray(messages)) return caps;

    for (const msg of messages) {
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === 'object') {
            if (part.type === 'image_url' || part.type === 'image') {
              caps.vision = true;
            }
            if (part.type === 'document_url' || part.type === 'file' || part.type === 'input_audio') {
              caps.vision = true;
            }
          }
        }
      }
    }
    return caps;
  }

  _providerSupportsCaps(target, requiredCaps) {
    if (!requiredCaps || !requiredCaps.vision) return true;

    const explicitCaps = Array.isArray(target.capabilities) ? target.capabilities : [];
    if (explicitCaps.includes('vision')) return true;

    const preset = resolvePreset(target.model, target.vendor_type);
    if (Array.isArray(preset?.capabilities) && preset.capabilities.includes('vision')) return true;

    return false;
  }

  _filterAvailableTargets(targets, model, requiredCaps = { vision: false }) {
    const available = [];
    // 单次过滤内按 group 缓存 token 用量，避免同组多 Key 重复查库
    const groupTokenCache = new Map();
    for (const target of targets) {
      if (!this._providerSupportsCaps(target, requiredCaps)) {
        continue;
      }

      const cbCheck = this.limiter.isAvailable(target.id, model);
      if (!cbCheck.available) {
        continue;
      }

      // Token 总额配额检查（按 Provider 分组聚合累计用量）
      if (target.token_limit && target._group_id) {
        let used = groupTokenCache.get(target._group_id);
        if (used === undefined) {
          try { used = this.db.getGroupTokenUsage(target._group_id); }
          catch { used = 0; }
          groupTokenCache.set(target._group_id, used);
        }
        target.token_used = used;
        if (used >= target.token_limit) {
          // 触发模型级锁定，等价于配额耗尽
          this.limiter.recordError(target.id, model, ERROR_TYPES.QUOTA_EXCEEDED);
          continue;
        }
      }

      const quotaCheck = this.limiter.checkQuota(target.id, target.rpm_limit || null, target.rpd_limit || null);
      if (!quotaCheck.allowed) {
        if (quotaCheck.reason === 'rpd_limit') {
          this.limiter.recordError(target.id, model, ERROR_TYPES.QUOTA_EXCEEDED);
        }
        continue;
      }

      target.rpm_used = quotaCheck.rpm_used;
      target.rpd_used = quotaCheck.rpd_used;
      target.resetAt = quotaCheck.rpm_reset_at;
      available.push(target);
    }
    return available;
  }

  async _tryProvider(target, req, res, parsedRequest, startTime, isStream, groupIdx, providerIdx, totalGroups) {
    const { model, options } = parsedRequest;
    // Phase 1.5: 整流器可修改 messages/options 后重试一次,用 local* 变量承载
    let localMessages = parsedRequest.messages;
    let localOptions = options;
    let rectified = false;
    const retryTransient = this.config.routing?.retry_transient ?? true;

    if (target._group_id && target.max_concurrency) {
      if (!acquireConcurrency(target._group_id, target.max_concurrency)) {
        return { success: false, error: new Error('Concurrency limit reached') };
      }
    }

    const provider = await this._getProviderInstance(target);
    let attempt = 0;

    while (attempt < (retryTransient ? 2 : 1)) {
      attempt++;
      try {
        this.strategy.recordUse(target.id);

        if (isStream) {
          const streamRes = await provider.chatCompletionStream(localMessages, { ...localOptions, model: target.model });
          return {
            success: true,
            isStream: true,
            stream: streamRes,
            target,
            provider
          };
        } else {
          const result = await provider.chatCompletion(localMessages, { ...localOptions, model: target.model });
          if (target._group_id) releaseConcurrency(target._group_id);
          return {
            success: true,
            isStream: false,
            result,
            target,
            provider
          };
        }
      } catch (err) {
        // ── Phase 1.5: 反应式整流器
        // 检测 signature/budget/media 等错误模式,自动修复请求体并重试一次(不计入 transient retry)
        if (!rectified) {
          const rectifier = getRectifier();
          const fakeBody = { messages: localMessages, ...localOptions };
          const fix = rectifier.tryRectify(err.message || '', fakeBody);
          if (fix.rectified) {
            rectified = true;
            if (fix.body.messages) localMessages = fix.body.messages;
            localOptions = { ...localOptions };
            if (fix.body.thinking !== undefined) localOptions.thinking = fix.body.thinking;
            if (fix.body.max_tokens !== undefined) localOptions.max_tokens = fix.body.max_tokens;
            if (fix.body.tools !== undefined) localOptions.tools = fix.body.tools;
            // 重置 attempt,允许整流后的请求再走一次完整 retry 流程
            attempt = 0;
            continue;
          }
        }

        if (target._group_id && attempt >= (retryTransient ? 2 : 1)) {
          releaseConcurrency(target._group_id);
        }

        const errClass = this.limiter.classifyError(err.status || 0, err.message);
        const canRetry = retryTransient && errClass === ERROR_TYPES.TRANSIENT && attempt < 2;
        if (canRetry) {
          continue;
        }

        this.limiter.recordError(target.id, target.model, errClass, err.status);
        const latency = Date.now() - startTime;
        logRequest({
          provider_id: target.id,
          model: target.model,
          status: err.status || 502,
          latency_ms: latency,
          error: err.message
        });
        this._addRequestLog({
          ts: Date.now(),
          model: parsedRequest.model,
          resolved_model: target.model,
          status: err.status || 502,
          provider: target.id,
          latency: latency,
          tokens: 0,
          stream: isStream,
          error: err.message,
          bridge: parsedRequest._bridge
        });
        this._updateProviderStats(target.id, latency, false, 0);

        // Phase 2.3: 发布请求错误事件
        publishEvent('request_error', {
          provider_id: target.id, model: target.model,
          status: err.status || 502, error: err.message,
          error_type: errClass, latency_ms: latency,
        });

        if (errClass === ERROR_TYPES.BAD_REQUEST) {
          return { success: false, error: err, fatal: true };
        }
        return { success: false, error: err };
      }
    }
    return { success: false, error: new Error('Max retries exceeded') };
  }

  _handleSuccessResponse(res, result, parsedRequest, startTime, isFastest = false) {
    const { target } = result;
    const model = parsedRequest.model;

    if (result.isStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      let finished = false;
      // Phase 2.2: 从流末 usage chunk 提取 usage(choices=[] 且带 usage 字段)
      let streamUsage = null;

      const releaseConcurrencyOnce = () => {
        if (target._group_id) releaseConcurrency(target._group_id);
      };

      result.stream.on('data', (chunk) => {
        if (!res.writableEnded) res.write(chunk);
        // 解析 SSE chunk,提取 usage(不消费 chunk,仅旁路解析)
        try {
          const text = chunk.toString();
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.usage && (!data.choices || data.choices.length === 0)) {
                streamUsage = data.usage;
              }
            } catch {}
          }
        } catch {}
      });

      result.stream.on('end', () => {
        if (finished) return;
        finished = true;
        releaseConcurrencyOnce();
        const latency = Date.now() - startTime;
        // Phase 2.2: 用流末提取的 usage 记录完整 token 用量
        const tokensIn = streamUsage?.prompt_tokens || 0;
        const tokensOut = streamUsage?.completion_tokens || 0;
        const totalTokens = streamUsage?.total_tokens || (tokensIn + tokensOut);
        const cacheRead = streamUsage?.cache_read_tokens || 0;
        const cacheCreation = streamUsage?.cache_creation_tokens || 0;
        const realInput = streamUsage?.real_input_tokens || 0;
        this.limiter.recordSuccess(target.id, target.model);
        logRequest({
          provider_id: target.id,
          model: target.model,
          status: 200,
          prompt_tokens: tokensIn,
          completion_tokens: tokensOut,
          total_tokens: totalTokens,
          cache_read_tokens: cacheRead,
          cache_creation_tokens: cacheCreation,
          real_input_tokens: realInput,
          latency_ms: latency,
          error: null
        });
        this._addRequestLog({
          ts: Date.now(),
          model: model,
          resolved_model: target.model,
          status: 200,
          provider: target.id,
          latency: latency,
          tokens: totalTokens,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          stream: true,
          bridge: parsedRequest._bridge
        });
        this._updateProviderStats(target.id, latency, true, totalTokens);
        if (!res.writableEnded) res.end();

        // Phase 2.3: 发布实时事件
        publishEvent('request_complete', {
          provider_id: target.id, model: target.model, stream: true,
          prompt_tokens: tokensIn, completion_tokens: tokensOut, total_tokens: totalTokens,
          cache_read_tokens: cacheRead, cache_creation_tokens: cacheCreation,
          latency_ms: latency,
        });
      });

      result.stream.on('error', (err) => {
        if (finished) return;
        finished = true;
        releaseConcurrencyOnce();
        const latency = Date.now() - startTime;
        this.limiter.recordError(target.id, target.model, ERROR_TYPES.TRANSIENT, err.status);
        logRequest({
          provider_id: target.id,
          model: target.model,
          status: err.status || 502,
          latency_ms: latency,
          error: err.message
        });
        this._addRequestLog({
          ts: Date.now(),
          model: model,
          resolved_model: target.model,
          status: err.status || 502,
          provider: target.id,
          latency: latency,
          tokens: 0,
          stream: true,
          error: err.message,
          bridge: parsedRequest._bridge
        });
        this._updateProviderStats(target.id, latency, false, 0);
        if (!res.writableEnded && !isFastest) {
          sendError(res, 502, `Provider stream error: ${err.message}`);
        }
      });
    } else {
      const latency = Date.now() - startTime;
      // Phase 2.2: 提取归一化 usage 的完整字段(含缓存三桶)
      const usage = result.result.usage || {};
      const tokensIn = usage.prompt_tokens || 0;
      const tokensOut = usage.completion_tokens || 0;
      const totalTokens = usage.total_tokens || (tokensIn + tokensOut);
      const cacheRead = usage.cache_read_tokens || 0;
      const cacheCreation = usage.cache_creation_tokens || 0;
      const realInput = usage.real_input_tokens || 0;
      this.limiter.recordSuccess(target.id, target.model);
      logRequest({
        provider_id: target.id,
        model: target.model,
        status: 200,
        prompt_tokens: tokensIn,
        completion_tokens: tokensOut,
        total_tokens: totalTokens,
        cache_read_tokens: cacheRead,
        cache_creation_tokens: cacheCreation,
        real_input_tokens: realInput,
        latency_ms: latency,
        error: null
      });
      this._addRequestLog({
        ts: Date.now(),
        model: model,
        resolved_model: target.model,
        status: 200,
        provider: target.id,
        latency: latency,
        tokens: totalTokens,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        stream: false,
        bridge: parsedRequest._bridge
      });
      this._updateProviderStats(target.id, latency, true, totalTokens);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.result));

      // Phase 2.3: 发布实时事件
      publishEvent('request_complete', {
        provider_id: target.id, model: target.model, stream: false,
        prompt_tokens: tokensIn, completion_tokens: tokensOut, total_tokens: totalTokens,
        cache_read_tokens: cacheRead, cache_creation_tokens: cacheCreation,
        latency_ms: latency,
      });
    }
  }

  async handleRequest(req, res, parsedRequest) {
    const { model, messages, stream, options } = parsedRequest;
    let resolveResult;

    try {
      resolveResult = this.resolver.resolve(model);
    } catch (err) {
      sendError(res, 404, err.message);
      return;
    }

    parsedRequest._bridge = {
      from: resolveResult._bridged_from || null,
      to: resolveResult._bridged_to || null
    };

    const rtkConfig = this.config.rtk || {};
    if (rtkConfig.enabled !== false) {
      try {
        await _lazyLoadRTK();
        const compressResult = _compressMessages(parsedRequest, rtkConfig);
        if (compressResult.stats) {
          this._rtkStats.savedBytes += compressResult.stats.savedBytes || 0;
          this._rtkStats.hits += compressResult.stats.compressedCount || 0;
        }
        if (rtkConfig.caveman !== false) {
          _injectCavemanPrompt(parsedRequest, true);
        }
      } catch {}
    }

    if (resolveResult.strategy === 'fusion') {
      try {
        const fusion = await this._getFusion();
        await fusion.handleFusion(req, res, parsedRequest, resolveResult.combo);
      } catch (err) {
        sendError(res, 500, 'Fusion error: ' + err.message);
      }
      return;
    }

    const stickyKey = this._getStickyKey(req);
    const stickyLimit = this.config.routing?.sticky_limit || 1;
    const requiredCaps = this._detectRequiredCapabilities(messages);
    const startTime = Date.now();

    if (resolveResult.strategy === 'fastest') {
      const attempts = [];
      for (const memberGroup of resolveResult.memberGroups) {
        const orderedTargets = this.strategy.orderTargets(memberGroup.targets, { stickyKey, stickyLimit });
        const availableTargets = this._filterAvailableTargets(orderedTargets, model, requiredCaps);
        if (availableTargets.length > 0) {
          attempts.push(this._tryProvider(availableTargets[0], req, res, parsedRequest, startTime, stream, 0, 0, 1));
        }
      }

      if (attempts.length === 0) {
        const cooldowns = this.db.getCooldownProviders();
        const cbStates = this.db.getAllCBState().filter(s => s.active);
        const cooldownInfo = [
          ...cooldowns.map(c => `${c.id}: ${Math.ceil(c.remaining_ms/1000)}s`),
          ...cbStates.map(s => `${s.key}: ${s.remaining_s}s`)
        ].join(', ');
        sendError(res, 429, `All providers are rate limited or in cooldown (${cooldownInfo})`);
        return;
      }

      try {
        const winner = await Promise.race(
          attempts.map(p => p.then(r => r.success ? r : Promise.reject(r.error)))
        );
        this._handleSuccessResponse(res, winner, parsedRequest, startTime, true);
      } catch (err) {
        sendError(res, 502, `All fastest providers failed: ${err.message}`);
      }
      return;
    }

    let lastError = null;
    let fatalError = null;

    for (let gi = 0; gi < resolveResult.memberGroups.length; gi++) {
      const memberGroup = resolveResult.memberGroups[gi];
      const orderedTargets = this.strategy.orderTargets(memberGroup.targets, { stickyKey, stickyLimit });
      const availableTargets = this._filterAvailableTargets(orderedTargets, model, requiredCaps);

      if (availableTargets.length === 0) continue;

      for (let ti = 0; ti < availableTargets.length; ti++) {
        const target = availableTargets[ti];
        const result = await this._tryProvider(target, req, res, parsedRequest, startTime, stream, gi, ti, resolveResult.memberGroups.length);
        
        if (result.success) {
          this._handleSuccessResponse(res, result, parsedRequest, startTime);
          return;
        }

        if (result.fatal) {
          fatalError = result.error;
          break;
        }
        lastError = result.error;
      }

      if (fatalError) break;
    }

    if (fatalError) {
      sendError(res, fatalError.status || 400, fatalError.message);
      return;
    }

    if (lastError) {
      const cooldowns = this.db.getCooldownProviders();
      const cbStates = this.db.getAllCBState().filter(s => s.active);
      if (cooldowns.length > 0 || cbStates.length > 0) {
        const cooldownInfo = [
          ...cooldowns.map(c => `${c.id}: ${Math.ceil(c.remaining_ms/1000)}s`),
          ...cbStates.map(s => `${s.key}: ${s.remaining_s}s`)
        ].join(', ');
        sendError(res, 429, `All providers are rate limited or in cooldown (${cooldownInfo})`);
        return;
      }
      sendError(res, lastError.status || 502, `All providers failed: ${lastError.message}`);
      return;
    }

    const cooldowns = this.db.getCooldownProviders();
    const cbStates = this.db.getAllCBState().filter(s => s.active);
    const cooldownInfo = [
      ...cooldowns.map(c => `${c.id}: ${Math.ceil(c.remaining_ms/1000)}s`),
      ...cbStates.map(s => `${s.key}: ${s.remaining_s}s`)
    ].join(', ');
    sendError(res, 429, `All providers are rate limited or in cooldown (${cooldownInfo})`);
  }

  async handleEmbeddings(req, res, parsedBody) {
    const { model, input, encoding_format = 'float', dimensions } = parsedBody;

    let resolveResult;
    try {
      resolveResult = this.resolver.resolve(model);
    } catch (err) {
      sendError(res, 404, err.message);
      return;
    }

    const targets = this._getMemberTargets(resolveResult);
    if (targets.length === 0) {
      sendError(res, 503, 'No available provider for embeddings');
      return;
    }

    const target = targets[0];
    const provider = await this._getProviderInstance(target);

    if (typeof provider.embeddings !== 'function') {
      sendError(res, 501, `Provider ${target.id} does not support embeddings`);
      return;
    }

    try {
      const result = await provider.embeddings(input, {
        model: target.model,
        encoding_format,
        dimensions
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      sendError(res, err.status || 502, err.message);
    }
  }

  getRequestLog(limit = 100) {
    return this._requestLog.slice(-limit).reverse();
  }

  getProviderRuntimeStats() {
    const result = {};
    for (const [id, stats] of this._providerStats) {
      result[id] = { ...stats };
    }
    return result;
  }

  getStats() {
    const allRequests = this._requestLog;
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    const requestsLastMinute = allRequests.filter(r => r.ts > oneMinuteAgo).length;
    const requestsLastHour = allRequests.filter(r => r.ts > oneHourAgo).length;
    const successCount = allRequests.filter(r => r.status === 200).length;
    const totalLatency = allRequests.reduce((sum, r) => sum + r.latency, 0);
    const avgLatency = allRequests.length > 0 ? Math.round(totalLatency / allRequests.length) : 0;
    const totalTokens = allRequests.reduce((sum, r) => sum + (r.tokens || 0), 0);

    return {
      strategy: this.config.routing.default_strategy,
      providers: this.resolver.getAllProviders().length,
      cached_adapters: getCachedProviders().length,
      cooldown_providers: this.db.getCooldownProviders(),
      circuit_breakers: this.db.getAllCBState(),
      rtk: this._rtkStats,
      runtime: {
        total_requests: allRequests.length,
        requests_last_minute: requestsLastMinute,
        requests_last_hour: requestsLastHour,
        success_count: successCount,
        success_rate: allRequests.length > 0 ? successCount / allRequests.length : 1,
        avg_latency: avgLatency,
        total_tokens: totalTokens,
        uptime: process.uptime()
      },
      provider_stats: this.getProviderRuntimeStats()
    };
  }
}
