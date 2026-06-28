import {
  checkAndIncrementQuota,
  isCBKeyActive,
  isProviderAvailable,
  isKeyAvailable,
  isModelAvailable,
  recordFailure,
  recordPermanentFailure,
  recordSuccess,
  getNextRPDResetMs,
} from './db.js';

export const ERROR_TYPES = {
  AUTH_ERROR: 'auth_error',
  RATE_LIMIT: 'rate_limit',
  QUOTA_EXCEEDED: 'quota_exceeded',
  TRANSIENT: 'transient',
  BAD_REQUEST: 'bad_request',
  SERVER_ERROR: 'server_error',
  NETWORK_ERROR: 'network_error',
};

class CircuitBreaker {
  constructor(db, config = {}) {
    this.db = db;
    this.config = {
      enabled: config.enabled ?? true,
      key_cooldown: config.key_cooldown ?? true,
      backoff_initial: config.backoff_initial ?? 1,
      backoff_max: config.backoff_max ?? 240,
      backoff_multiplier: config.backoff_multiplier ?? 2,
      model_lockout: config.model_lockout ?? true,
      provider_breaker: config.provider_breaker ?? true,
      breaker_threshold: config.breaker_threshold ?? 5,
      breaker_recover: config.breaker_recover ?? 60,
    };
  }

  classifyError(status, errorText = '') {
    const text = String(errorText || '').toLowerCase();

    if (text.includes('api key') || text.includes('invalid key') || text.includes('unauthorized') ||
        text.includes('authentication') || text.includes('auth error') || text.includes('key not valid') ||
        text.includes('permission denied') || text.includes('forbidden') ||
        status === 401 || status === 403) {
      return ERROR_TYPES.AUTH_ERROR;
    }

    if (text.includes('quota') || text.includes('billing') || text.includes('exceeded') || text.includes('daily limit')) {
      return ERROR_TYPES.QUOTA_EXCEEDED;
    }

    if (status === 429 || text.includes('429') || text.includes('rate limit') || text.includes('too many requests')) {
      return ERROR_TYPES.RATE_LIMIT;
    }

    if (status === 400) {
      return ERROR_TYPES.BAD_REQUEST;
    }

    if (status === 502 || status === 503 || status === 504 ||
        text.includes('econnreset') || text.includes('etimedout') ||
        text.includes('econnrefused') || text.includes('socket hang up')) {
      return ERROR_TYPES.TRANSIENT;
    }

    if (status >= 500) {
      return ERROR_TYPES.SERVER_ERROR;
    }

    if (text.includes('network') || text.includes('proxy') || text.includes('timeout')) {
      return ERROR_TYPES.NETWORK_ERROR;
    }

    return ERROR_TYPES.TRANSIENT;
  }

  checkProviderAvailable(providerId) {
    if (!this.config.enabled || !this.config.provider_breaker) return { available: true };
    const cb = isCBKeyActive(`provider:${providerId}`);
    if (cb.active) {
      return {
        available: false,
        reason: 'provider_circuit_open',
        remaining_s: cb.remaining_s
      };
    }
    return { available: true };
  }

  checkKeyAvailable(providerId) {
    if (!this.config.enabled || !this.config.key_cooldown) return { available: true };
    const cb = isCBKeyActive(`key:${providerId}`);
    if (cb.active) {
      return {
        available: false,
        reason: 'key_cooldown',
        remaining_s: cb.remaining_s
      };
    }
    return { available: true };
  }

  checkModelAvailable(providerId, model) {
    if (!this.config.enabled || !this.config.model_lockout) return { available: true };
    const cb = isCBKeyActive(`model:${providerId}:${model}`);
    if (cb.active) {
      return {
        available: false,
        reason: 'model_lockout',
        remaining_s: cb.remaining_s
      };
    }
    return { available: true };
  }

  isAvailable(providerId, model = null) {
    const provider = this.checkProviderAvailable(providerId);
    if (!provider.available) return provider;

    const key = this.checkKeyAvailable(providerId);
    if (!key.available) return key;

    if (model) {
      const modelCheck = this.checkModelAvailable(providerId, model);
      if (!modelCheck.available) return modelCheck;
    }

    if (!isProviderAvailable(providerId)) {
      return { available: false, reason: 'provider_cooldown' };
    }

    return { available: true };
  }

  checkQuota(providerId, rpmLimit = null, rpdLimit = null) {
    if (!rpmLimit && !rpdLimit) {
      return {
        allowed: true,
        rpm_used: 0,
        rpd_used: 0,
        unlimited: true
      };
    }
    const effectiveRpm = rpmLimit || 999999;
    const effectiveRpd = rpdLimit || 999999;
    const result = checkAndIncrementQuota(providerId, effectiveRpm, effectiveRpd);
    if (!result.allowed) {
      return {
        allowed: false,
        reason: result.rpm_exceeded ? 'rpm_limit' : 'rpd_limit',
        rpm_used: result.rpm_used,
        rpd_used: result.rpd_used,
        rpm_reset_at: result.rpm_reset_at,
        rpd_reset_at: result.rpd_reset_at
      };
    }
    return {
      allowed: true,
      rpm_used: result.rpm_used,
      rpd_used: result.rpd_used,
      rpd_reset_at: result.rpd_reset_at,
      unlimited: !rpmLimit && !rpdLimit
    };
  }

  recordSuccess(providerId, model = null) {
    if (!this.config.enabled) return;
    recordSuccess(`key:${providerId}`);
    if (model) {
      recordSuccess(`model:${providerId}:${model}`);
    }
    recordSuccess(`provider:${providerId}`);
  }

  recordError(providerId, model, errorType, status = 0) {
    if (!this.config.enabled) return { cooldown: 0, providerTripped: false };

    let cooldownSeconds = this.config.backoff_initial;
    let lockModel = false;
    let permanentKey = false;
    let providerTripped = false;

    switch (errorType) {
      case ERROR_TYPES.AUTH_ERROR:
        cooldownSeconds = 86400 * 30;
        permanentKey = true;
        break;

      case ERROR_TYPES.QUOTA_EXCEEDED:
        lockModel = true;
        cooldownSeconds = Math.ceil((getNextRPDResetMs() - Date.now()) / 1000);
        cooldownSeconds = Math.max(60, Math.min(cooldownSeconds, 86400));
        break;

      case ERROR_TYPES.RATE_LIMIT:
        cooldownSeconds = 60;
        break;

      case ERROR_TYPES.TRANSIENT:
        cooldownSeconds = Math.max(2, this.config.backoff_initial);
        break;

      case ERROR_TYPES.NETWORK_ERROR:
        cooldownSeconds = 10;
        break;

      case ERROR_TYPES.SERVER_ERROR:
        cooldownSeconds = 30;
        break;

      case ERROR_TYPES.BAD_REQUEST:
      default:
        return { cooldown: 0, providerTripped: false };
    }

    if (permanentKey) {
      recordPermanentFailure(`key:${providerId}`, 'key', cooldownSeconds);
    } else {
      const keyResult = recordFailure(
        `key:${providerId}`, 'key',
        this.config.backoff_initial, this.config.backoff_max, this.config.backoff_multiplier
      );
      cooldownSeconds = keyResult.backoff;

      if (lockModel && model) {
        recordPermanentFailure(`model:${providerId}:${model}`, 'model', cooldownSeconds);
      }

      if (this.config.provider_breaker && keyResult.fail_count >= this.config.breaker_threshold) {
        recordFailure(`provider:${providerId}`, 'provider', this.config.breaker_recover, this.config.breaker_recover, 1);
        providerTripped = true;
      }
    }

    return {
      cooldown: cooldownSeconds,
      providerTripped,
      errorType
    };
  }

  getProviderStatus(providerId, model = null) {
    const keyCB = isCBKeyActive(`key:${providerId}`);
    const providerCB = isCBKeyActive(`provider:${providerId}`);
    const modelCB = model ? isCBKeyActive(`model:${providerId}:${model}`) : null;

    return {
      provider_circuit_open: providerCB.active,
      provider_remaining_s: providerCB.active ? providerCB.remaining_s : 0,
      key_cooldown: keyCB.active,
      key_remaining_s: keyCB.active ? keyCB.remaining_s : 0,
      key_fail_count: keyCB.state?.fail_count || 0,
      model_lockout: modelCB?.active || false,
      model_remaining_s: modelCB?.active ? modelCB.remaining_s : 0,
    };
  }

  resetKey(providerId) {
    recordSuccess(`key:${providerId}`);
  }

  resetProvider(providerId) {
    recordSuccess(`provider:${providerId}`);
    recordSuccess(`key:${providerId}`);
  }

  resetModel(providerId, model) {
    recordSuccess(`model:${providerId}:${model}`);
  }
}

let limiterInstance = null;

export function getLimiter(db, config = {}) {
  if (!limiterInstance) {
    limiterInstance = new CircuitBreaker(db, config);
  }
  return limiterInstance;
}

export function resetLimiter() {
  limiterInstance = null;
}

export function updateLimiterConfig(config) {
  if (limiterInstance) {
    limiterInstance.config = { ...limiterInstance.config, ...config };
  }
}
