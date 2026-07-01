import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { resolvePreset } from './state/model-presets.js';

let cachedConfig = null;
let configPath = './config.yml';

const VALID_STRATEGIES = ['priority', 'round-robin', 'weighted', 'least-used', 'p2c', 'reset-aware'];

const defaultConfig = {
  port: 20128,
  log_level: 'info',
  admin_password: '123456',
  // 客户端访问 /v1/* 接口所需的 API Key 列表（空数组 = 不鉴权）
  api_keys: [],
  proxy: null,
  proxies: [],
  proxy_strategy: 'round-robin',
  routing: {
    default_strategy: 'priority',
    sticky_limit: 1,
    combo_sticky_limit: 1,
    fallback_on: [429, 500, 502, 503, 504],
    request_timeout_ms: 60000,
    retry_transient: true,
    circuit_breaker: {
      enabled: true,
      key_cooldown: true,
      backoff_initial: 1,
      backoff_max: 240,
      backoff_multiplier: 2,
      model_lockout: true,
      provider_breaker: true,
      breaker_threshold: 5,
      breaker_recover: 60,
    },
  },
  rtk: {
    enabled: true,
    caveman: true,
    max_bytes: 8192,
    min_compress_size: 512,
    filter_git: true,
    filter_build: true,
    filter_logs: true,
  },
  providers: [],
  provider_groups: [],
  combos: [],
  aliases: {}
};

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    const isObj = val !== null && typeof val === 'object';
    const isArr = Array.isArray(val);
    if (isObj && !isArr) {
      const base = target[key] || {};
      result[key] = deepMerge(base, val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function validateConfig(config) {
  const errors = [];

  if (config.port !== undefined) {
    const p = Number(config.port);
    const validPort = Number.isInteger(p) && p >= 1 && p <= 65535;
    if (!validPort) {
      errors.push('port 必须是 1-65535 的整数');
    }
  }

  const r = config.routing || {};
  if (r.default_strategy) {
    const validStrategy = VALID_STRATEGIES.includes(r.default_strategy);
    if (!validStrategy) {
      errors.push(`routing.default_strategy 无效，可选: ${VALID_STRATEGIES.join(' | ')}`);
    }
  }
  if (r.sticky_limit !== undefined) {
    const val = Number(r.sticky_limit);
    if (val < 0) {
      errors.push('routing.sticky_limit 必须 >= 0');
    }
  }
  if (r.request_timeout_ms !== undefined) {
    const val = Number(r.request_timeout_ms);
    if (val < 1000) {
      errors.push('routing.request_timeout_ms 必须 >= 1000');
    }
  }

  const cb = r.circuit_breaker;
  if (cb) {
    if (cb.backoff_initial !== undefined) {
      const val = Number(cb.backoff_initial);
      if (val < 1) errors.push('routing.circuit_breaker.backoff_initial 必须 >= 1');
    }
    if (cb.backoff_max !== undefined) {
      const val = Number(cb.backoff_max);
      if (val < 1) errors.push('routing.circuit_breaker.backoff_max 必须 >= 1');
    }
    if (cb.breaker_threshold !== undefined) {
      const val = Number(cb.breaker_threshold);
      if (val < 1) errors.push('routing.circuit_breaker.breaker_threshold 必须 >= 1');
    }
  }

  const hasGroups = Array.isArray(config.provider_groups) && config.provider_groups.length > 0;
  const hasFlatProviders = Array.isArray(config.providers) && config.providers.length > 0;
  
  if (!hasGroups && !hasFlatProviders) {
    errors.push('providers 或 provider_groups 不能为空');
  }

  const ids = new Set();
  const providerList = config.providers || [];
  
  if (hasGroups) {
    config.provider_groups.forEach((g, gi) => {
      const gpfx = `provider_groups[${gi}]`;
      if (!g.id) {
        errors.push(`${gpfx}.id 必填`);
      } else if (ids.has(g.id)) {
        errors.push(`${gpfx}.id "${g.id}" 重复`);
      } else {
        ids.add(g.id);
      }
      if (!g.type) errors.push(`${gpfx}.type 必填`);
      if (!g.model) errors.push(`${gpfx}.model 必填`);
      if (g.rpd_limit !== undefined && g.rpd_limit !== null) {
        const val = Number(g.rpd_limit);
        if (val < 1) errors.push(`${gpfx}.rpd_limit 必须 >= 1`);
      }
      if (g.rpm_limit !== undefined && g.rpm_limit !== null) {
        const val = Number(g.rpm_limit);
        if (val < 1) errors.push(`${gpfx}.rpm_limit 必须 >= 1`);
      }
      if (g.max_concurrency !== undefined && g.max_concurrency !== null) {
        const val = Number(g.max_concurrency);
        if (val < 1) errors.push(`${gpfx}.max_concurrency 必须 >= 1`);
      }
      if (g.token_limit !== undefined && g.token_limit !== null && g.token_limit !== '') {
        const val = Number(g.token_limit);
        if (!Number.isFinite(val) || val < 0) errors.push(`${gpfx}.token_limit 必须 >= 0`);
      }
      
      const groupKeys = g.keys || [];
      if (!Array.isArray(groupKeys) || groupKeys.length === 0) {
        errors.push(`${gpfx}.keys 至少需要一个 API Key`);
      } else {
        groupKeys.forEach((k, ki) => {
          const kid = k.id || `key${ki+1}`;
          const flatId = `${g.id}__${kid}`;
          if (ids.has(flatId)) {
            errors.push(`${gpfx}.keys[${ki}].id "${kid}" 生成的ID重复`);
          } else {
            ids.add(flatId);
          }
          if (!k.api_key) errors.push(`${gpfx}.keys[${ki}].api_key 必填`);
        });
      }
    });
  }

  providerList.forEach((p, i) => {
    const pfx = `providers[${i}]`;
    if (!p.id) {
      errors.push(`${pfx}.id 必填`);
    } else if (ids.has(p.id)) {
      errors.push(`${pfx}.id "${p.id}" 重复`);
    } else {
      ids.add(p.id);
    }

    if (!p.type) {
      errors.push(`${pfx}.type 必填`);
    }
    const hasKey = p.api_key || p.token;
    if (!hasKey) {
      errors.push(`${pfx}.api_key 必填`);
    }
    if (!p.model) {
      errors.push(`${pfx}.model 必填`);
    }

    const prio = Number(p.priority || p.weight || 1);
    const prioValid = !isNaN(prio) && prio >= 1 && prio <= 10;
    if (!prioValid) {
      errors.push(`${pfx}.priority 必须是 1-10 的整数`);
    }
    if (p.rpd_limit !== undefined && p.rpd_limit !== null) {
      const val = Number(p.rpd_limit);
      if (val < 1) errors.push(`${pfx}.rpd_limit 必须 >= 1`);
    }
    if (p.rpm_limit !== undefined && p.rpm_limit !== null) {
      const val = Number(p.rpm_limit);
      if (val < 1) errors.push(`${pfx}.rpm_limit 必须 >= 1`);
    }
    if (p.weight !== undefined) {
      const val = Number(p.weight);
      if (val < 1) errors.push(`${pfx}.weight 必须 >= 1`);
    }
  });

  const combos = config.combos || [];
  const groupIds = new Set();
  if (Array.isArray(config.provider_groups)) {
    config.provider_groups.forEach(g => groupIds.add(g.id));
  }
  
  combos.forEach((c, i) => {
    if (!c.id) errors.push(`combos[${i}].id 必填`);
    
    if (Array.isArray(c.members) && c.members.length > 0) {
      c.members.forEach((m, mi) => {
        const gid = m.group || m.model || m;
        if (typeof gid === 'string') {
          if (groupIds.has(gid)) return;
          if (ids.has(gid)) return;
        }
        errors.push(`combos[${i}].members[${mi}] 引用了不存在的 group/provider: "${gid}"`);
      });
    } else if (Array.isArray(c.models) && c.models.length > 0) {
      c.models.forEach(mid => {
        if (!ids.has(mid) && !groupIds.has(mid)) {
          errors.push(`combos[${i}] 引用了不存在的 provider/group: "${mid}"`);
        }
      });
    } else {
      errors.push(`combos[${i}] 需要至少一个成员 (members 或 models 数组)`);
    }
  });

  if (config.aliases) {
    const type = typeof config.aliases;
    if (type !== 'object') {
      errors.push('aliases 必须是对象');
    }
  }

  if (config.proxy !== null && config.proxy !== undefined) {
    const type = typeof config.proxy;
    if (type !== 'string') {
      errors.push('proxy 必须是字符串或 null');
    }
  }

  if (config.proxies) {
    const isArr = Array.isArray(config.proxies);
    if (!isArr) {
      errors.push('proxies 必须是数组');
    }
  }

  return errors;
}

function expandGroups(cfg) {
  if (!Array.isArray(cfg.providers)) cfg.providers = [];
  if (!Array.isArray(cfg.provider_groups) || cfg.provider_groups.length === 0) {
    return normalizeCombos(cfg);
  }
  
  const globalProxy = cfg.proxy;
  const flatProviders = [];
  const groupMap = new Map();
  
  for (const group of cfg.provider_groups) {
    const vendorType = group.type;
    const providerType = getProviderType(vendorType);
    const groupProxy = group.proxy !== undefined ? group.proxy : globalProxy;
    
    const rpdVal = group.rpd_limit != null ? Number(group.rpd_limit) : null;
    const rpmVal = group.rpm_limit != null ? Number(group.rpm_limit) : null;
    const groupRpd = (rpdVal && rpdVal >= 1) ? rpdVal : getDefaultRPD(group.model, vendorType);
    const groupRpm = (rpmVal && rpmVal >= 1) ? rpmVal : getDefaultRPM(group.model, vendorType);
    const groupMaxConcurrency = group.max_concurrency ? Number(group.max_concurrency) : null;
    const groupTokenLimit = (g => {
      const v = Number(g);
      return (g !== null && g !== undefined && g !== '' && Number.isFinite(v) && v > 0) ? v : null;
    })(group.token_limit);

    const groupProviders = [];
    const keys = group.keys || [];
    keys.forEach((key, ki) => {
      const keyId = key.id || `key${ki+1}`;
      const p = {
        id: `${group.id}__${keyId}`,
        type: providerType,
        vendor_type: vendorType,
        api_key: key.api_key,
        model: group.model,
        base_url: group.base_url,
        priority: Number(group.priority) || 2,
        weight: Number(group.weight) || 1,
        rpd_limit: groupRpd,
        rpm_limit: groupRpm,
        proxy: groupProxy,
        max_concurrency: groupMaxConcurrency,
        token_limit: groupTokenLimit,
        enabled: key.enabled !== false,
        capabilities: group.capabilities || [],
        _group_id: group.id
      };
      flatProviders.push(p);
      groupProviders.push(p);
    });

    groupMap.set(group.id, {
      id: group.id,
      type: vendorType,
      model: group.model,
      priority: Number(group.priority) || 2,
      token_limit: groupTokenLimit,
      label: group.label || '',
      providers: groupProviders
    });
  }
  
  cfg._groupMap = groupMap;
  const oldProviders = cfg.providers || [];
  cfg.providers = [...normalizeProviders(oldProviders), ...flatProviders];
  
  return normalizeCombos(cfg);
}

function normalizeCombos(cfg) {
  if (!Array.isArray(cfg.combos) || cfg.combos.length === 0) {
    return cfg;
  }
  
  const groupMap = cfg._groupMap || new Map();
  const providerMap = new Map();
  (cfg.providers || []).forEach(p => providerMap.set(p.id, p));
  
  cfg.combos = cfg.combos.map(combo => {
    if (Array.isArray(combo.members) && combo.members.length > 0) {
      const members = combo.members.map(m => {
        if (typeof m === 'string') return { group: m, weight: 1 };
        return { group: m.group || m.model, weight: m.weight || 1 };
      });
      return {
        id: combo.id,
        strategy: combo.strategy || 'fallback',
        members
      };
    }
    
    if (Array.isArray(combo.models)) {
      const members = combo.models.map(mid => {
        if (groupMap.has(mid) || providerMap.has(mid)) {
          return { group: mid, weight: 1 };
        }
        const matchedGroup = Array.from(groupMap.values()).find(g => g.model === mid);
        if (matchedGroup) return { group: matchedGroup.id, weight: 1 };
        return { group: mid, weight: 1 };
      }).filter(m => m.group);
      
      return {
        id: combo.id,
        strategy: combo.strategy || 'fallback',
        members
      };
    }
    
    return combo;
  });
  
  return cfg;
}

function normalizeProviders(providers) {
  return providers.map(p => {
    const vendorType = p.type;
    const providerType = getProviderType(vendorType);
    
    const rpdVal = p.rpd_limit != null ? Number(p.rpd_limit) : null;
    const rpmVal = p.rpm_limit != null ? Number(p.rpm_limit) : null;
    
    return {
      id: p.id,
      type: providerType,
      vendor_type: vendorType,
      api_key: p.api_key || p.token,
      model: p.model,
      base_url: p.base_url,
      group: p.group || 'default',
      priority: Number(p.priority) || Number(p.weight) || 1,
      weight: Number(p.weight) || 1,
      rpd_limit: (rpdVal && rpdVal >= 1) ? rpdVal : getDefaultRPD(p.model, vendorType),
      rpm_limit: (rpmVal && rpmVal >= 1) ? rpmVal : getDefaultRPM(p.model, vendorType),
      enabled: p.enabled !== false,
      capabilities: p.capabilities || []
    };
  });
}

function getProviderType(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('gemini') || t === 'google-gemini') return 'gemini';
  if (t.includes('anthropic') || t.includes('claude')) return 'anthropic';
  return 'openai';
}

function getDefaultRPD(model, type) {
  // Phase B: delegate to the structured preset catalog.
  if (!model) return null;
  return resolvePreset(model, type).rpd;
}

function getDefaultRPM(model, type) {
  // Phase B: delegate to the structured preset catalog.
  if (!model) return null;
  return resolvePreset(model, type).rpm;
}

export function loadConfig(path = './config.yml') {
  configPath = path;
  try {
    const content = readFileSync(path, 'utf-8');
    const rawConfig = yaml.load(content) || {};

    const errors = validateConfig(rawConfig);
    if (errors.length > 0) {
      throw new Error('配置校验失败:\n  - ' + errors.join('\n  - '));
    }

    let normalized = deepMerge(defaultConfig, rawConfig);
    normalized = expandGroups(normalized);
    
    cachedConfig = normalized;
    return normalized;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`配置文件未找到: ${path}`);
      console.error('请参考 config.example.yml 创建 config.yml');
    } else {
      console.error('配置解析错误:', err.message);
    }
    throw err;
  }
}

export function getConfig() {
  if (!cachedConfig) {
    return loadConfig(configPath);
  }
  return cachedConfig;
}

export function reloadConfig(path = configPath) {
  cachedConfig = null;
  return loadConfig(path);
}

export function configToYaml(cfg) {
  const L = [];
  const line = s => L.push(s);

  line(`port: ${cfg.port || 20128}`);
  line(`log_level: ${cfg.log_level || 'info'}`);
  line('');

  // 管理后台密码
  if (cfg.admin_password) {
    line(`admin_password: "${cfg.admin_password}"`);
    line('');
  }

  // 客户端 API Key（访问 /v1/* 接口鉴权，空列表 = 不鉴权）
  const apiKeys = Array.isArray(cfg.api_keys) ? cfg.api_keys : [];
  if (apiKeys.length > 0) {
    line('api_keys:');
    apiKeys.forEach(k => line(`  - "${k}"`));
    line('');
  }

  if (cfg.proxy) {
    line('# HTTP代理配置（通过v2ray/clash等访问外网）');
    line(`proxy: "${cfg.proxy}"`);
    line('');
  } else if (cfg.proxy === null) {
    line('# HTTP代理配置（null = 直连，不使用代理）');
    line('proxy: null');
    line('');
  }

  const proxiesValid = Array.isArray(cfg.proxies) && cfg.proxies.length > 0;
  if (proxiesValid) {
    line('# 代理池配置（多个代理自动轮换）');
    line('proxies:');
    cfg.proxies.forEach(p => {
      line(`  - url: "${p.url}"`);
      if (p.weight) line(`    weight: ${p.weight}`);
      if (p.type) line(`    type: ${p.type}`);
    });
    line(`proxy_strategy: ${cfg.proxy_strategy || 'round-robin'}`);
    line('');
  }

  const r = cfg.routing || {};
  line('routing:');
  line(`  default_strategy: ${r.default_strategy || 'priority'}`);
  line(`  sticky_limit: ${r.sticky_limit ?? 1}`);
  const fb = Array.isArray(r.fallback_on) ? r.fallback_on : [429, 500, 502, 503, 504];
  line(`  fallback_on: [${fb.join(', ')}]`);
  line(`  request_timeout_ms: ${r.request_timeout_ms || 60000}`);
  line(`  retry_transient: ${r.retry_transient !== false}`);

  const cb = r.circuit_breaker || {};
  const cbHasKeys = Object.keys(cb).length > 0;
  if (cbHasKeys) {
    line('  circuit_breaker:');
    line(`    enabled: ${cb.enabled !== false}`);
    line(`    key_cooldown: ${cb.key_cooldown !== false}`);
    line(`    backoff_initial: ${cb.backoff_initial || 1}`);
    line(`    backoff_max: ${cb.backoff_max || 240}`);
    line(`    backoff_multiplier: ${cb.backoff_multiplier || 2}`);
    line(`    model_lockout: ${cb.model_lockout !== false}`);
    line(`    provider_breaker: ${cb.provider_breaker !== false}`);
    line(`    breaker_threshold: ${cb.breaker_threshold || 5}`);
    line(`    breaker_recover: ${cb.breaker_recover || 60}`);
  }
  line('');

  const rtk = cfg.rtk || {};
  const rtkHasKeys = Object.keys(rtk).length > 0;
  if (rtkHasKeys) {
    line('rtk:');
    line(`  enabled: ${rtk.enabled !== false}`);
    line(`  caveman: ${!!rtk.caveman}`);
    line(`  max_bytes: ${rtk.max_bytes || 8192}`);
    line(`  min_compress_size: ${rtk.min_compress_size || 512}`);
    line(`  filter_git: ${rtk.filter_git !== false}`);
    line(`  filter_build: ${rtk.filter_build !== false}`);
    line(`  filter_logs: ${rtk.filter_logs !== false}`);
    line('');
  }

  const hasGroups = Array.isArray(cfg.provider_groups) && cfg.provider_groups.length > 0;
  
  if (hasGroups) {
    line('# Provider Groups: 按模型分组管理多个API Key，支持组级代理、限流、并发控制');
    line('provider_groups:');
    line('');
    
    const sortedGroups = [...cfg.provider_groups].sort((a, b) => (b.priority || 1) - (a.priority || 1));
    
    sortedGroups.forEach(g => {
      line(`  # ===== ${g.id}: ${g.model} =====`);
      line(`  - id: ${g.id}`);
      line(`    type: ${g.type}`);
      line(`    model: ${g.model}`);
      if (g.label) line(`    label: "${g.label}"`);
      line(`    priority: ${g.priority || 2}`);
      if (g.weight && g.weight !== 1) line(`    weight: ${g.weight}`);
      if (g.rpd_limit) line(`    rpd_limit: ${g.rpd_limit}`);
      if (g.rpm_limit) line(`    rpm_limit: ${g.rpm_limit}`);
      if (g.max_concurrency) line(`    max_concurrency: ${g.max_concurrency}`);
      if (g.token_limit) line(`    token_limit: ${g.token_limit}`);
      if (g.base_url) line(`    base_url: "${g.base_url}"`);
      if (g.proxy === null) {
        line('    proxy: null  # 直连，不使用代理');
      } else if (g.proxy) {
        line(`    proxy: "${g.proxy}"`);
      }
      const capsValid = Array.isArray(g.capabilities) && g.capabilities.length > 0;
      if (capsValid) line(`    capabilities: [${g.capabilities.join(', ')}]`);
      line('    keys:');
      (g.keys || []).forEach((k, ki) => {
        const kid = k.id || `key${ki+1}`;
        line(`      - id: ${kid}`);
        line(`        api_key: "${k.api_key}"`);
        if (k.enabled === false) line('        enabled: false');
      });
      line('');
    });
  } else {
    line('providers:');

    const byPrio = {};
    const providers = cfg.providers || [];
    providers.forEach(p => {
      const k = String(p.priority || 1);
      if (!byPrio[k]) byPrio[k] = [];
      byPrio[k].push(p);
    });
    const prioLabel = { '4': '最高优先级', '3': '高优先级', '2': '中优先级', '1': '兜底' };
    const prioKeys = Object.keys(byPrio).sort((a, b) => Number(b) - Number(a));
    prioKeys.forEach(prio => {
      const group = byPrio[prio];
      const model = group[0] ? group[0].model : '';
      line(`# ===== Priority ${prio}: ${model} (${prioLabel[prio] || ''}) =====`);
      group.forEach(p => {
        line(`- id: ${p.id}`);
        line(`  type: ${p.vendor_type || p.type}`);
        line(`  api_key: "${p.api_key}"`);
        line(`  model: ${p.model}`);
        line(`  priority: ${p.priority}`);
        if (p.rpd_limit) line(`  rpd_limit: ${p.rpd_limit}`);
        if (p.rpm_limit) line(`  rpm_limit: ${p.rpm_limit}`);
        if (p.weight && p.weight !== 1) line(`  weight: ${p.weight}`);
        if (p.base_url) line(`  base_url: "${p.base_url}"`);
        const capsValid = Array.isArray(p.capabilities) && p.capabilities.length > 0;
        if (capsValid) line(`  capabilities: [${p.capabilities.join(', ')}]`);
        line('');
      });
    });
  }

  const combosValid = Array.isArray(cfg.combos) && cfg.combos.length > 0;
  if (combosValid) {
    line('# Combo: 跨厂商跨模型聚合路由，引用Provider Group实现多模型协同');
    line('combos:');
    cfg.combos.forEach(c => {
      line(`- id: ${c.id}`);
      line(`  strategy: ${c.strategy || 'fallback'}`);
      line('  members:');
      const members = c.members || [];
      members.forEach(m => {
        line(`    - group: ${m.group}`);
        if (m.weight && m.weight !== 1) line(`      weight: ${m.weight}`);
      });
      line('');
    });
  }

  const aliasesValid = cfg.aliases && Object.keys(cfg.aliases).length > 0;
  if (aliasesValid) {
    line('# 常用模型别名');
    line('aliases:');
    Object.entries(cfg.aliases).forEach(([k, v]) => line(`  ${k}: ${v}`));
  }

  return L.join('\n');
}

export { validateConfig, expandGroups };
