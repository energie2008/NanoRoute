/**
 * Phase B: Model Presets — structured quota & capability catalog.
 *
 * Replaces the old string-matching getDefaultRPD/getDefaultRPM in config.js.
 * A model synced from upstream (Phase A) is matched against this catalog to
 * auto-fill rpd/rpm/context/capabilities so the user never hand-configures them.
 *
 * Match order:
 *   1. exact id
 *   2. prefix patterns (e.g. "gemini-2.5-flash-*")
 *   3. token-based regex rules (e.g. /flash-lite$/)
 *   4. defaults per family (gemini/openai/anthropic/...)
 *
 * Kept as a single plain object — no deps, lazily importable.
 */

export const MODEL_PRESETS = {
  // ── Google Gemini ──────────────────────────────────────────────
  // 2.5 系列原生支持 thinking(reasoning) + function calling
  'gemini-2.5-pro':         { rpd: 50,  rpm: 10, context: 2097152, caps: ['chat','vision','pdf','function_calling','reasoning'], family: 'gemini' },
  'gemini-2.5-flash':       { rpd: 250, rpm: 15, context: 1048576, caps: ['chat','vision','function_calling','reasoning'],       family: 'gemini' },
  'gemini-2.5-flash-lite':  { rpd: 500, rpm: 15, context: 1048576, caps: ['chat','function_calling'],                              family: 'gemini' },
  'gemini-2.5-flash-tts':   { rpd: 250, rpm: 15, context: 1048576, caps: ['chat'],                                                family: 'gemini' },
  'gemini-2.0-flash':       { rpd: 250, rpm: 15, context: 1048576, caps: ['chat','vision','function_calling'],                   family: 'gemini' },
  'gemini-2.0-flash-exp':   { rpd: 1500, rpm: 15, context: 1048576, caps: ['chat','vision','function_calling'],                  family: 'gemini' },
  'gemini-2.0-flash-lite':  { rpd: 500, rpm: 15, context: 1048576, caps: ['chat','function_calling'],                            family: 'gemini' },
  'gemini-1.5-pro':         { rpd: 50,  rpm: 10, context: 2097152, caps: ['chat','vision','pdf','function_calling'],             family: 'gemini' },
  'gemini-1.5-flash':       { rpd: 250, rpm: 15, context: 1048576, caps: ['chat','vision','function_calling'],                   family: 'gemini' },
  'gemini-1.5-flash-8b':    { rpd: 500, rpm: 15, context: 1048576, caps: ['chat','function_calling'],                            family: 'gemini' },

  // ── Anthropic Claude ───────────────────────────────────────────
  // Claude 3.5+ 全部支持 tool use;sonnet-4-5/opus-4-5 支持 extended thinking
  'claude-opus-4-1':        { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf','function_calling'],                       family: 'anthropic' },
  'claude-opus-4-5':        { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf','function_calling','reasoning'],          family: 'anthropic' },
  'claude-sonnet-4':        { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf','function_calling'],                       family: 'anthropic' },
  'claude-sonnet-4-5':      { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf','function_calling','reasoning'],          family: 'anthropic' },
  'claude-haiku-3-5':       { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','function_calling'],                             family: 'anthropic' },
  'claude-3-5-sonnet':      { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf','function_calling'],                       family: 'anthropic' },
  'claude-3-5-haiku':       { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','function_calling'],                             family: 'anthropic' },
  'claude-3-opus':          { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf','function_calling'],                       family: 'anthropic' },

  // ── OpenAI ─────────────────────────────────────────────────────
  'gpt-4o':                 { rpd: null, rpm: null, context: 128000, caps: ['chat','vision','function_calling'],     family: 'openai' },
  'gpt-4o-mini':            { rpd: null, rpm: null, context: 128000, caps: ['chat','vision','function_calling'],     family: 'openai' },
  'gpt-4-turbo':            { rpd: null, rpm: null, context: 128000, caps: ['chat','vision','function_calling'],     family: 'openai' },
  'gpt-4':                  { rpd: null, rpm: null, context: 8192,   caps: ['chat','function_calling'],              family: 'openai' },
  'gpt-3.5-turbo':          { rpd: null, rpm: null, context: 16385,  caps: ['chat','function_calling'],              family: 'openai' },
  'o1':                     { rpd: null, rpm: null, context: 200000, caps: ['chat','function_calling','reasoning'],  family: 'openai' },
  'o1-mini':                { rpd: null, rpm: null, context: 128000, caps: ['chat','reasoning'],                     family: 'openai' },
  'o3-mini':                { rpd: null, rpm: null, context: 200000, caps: ['chat','function_calling','reasoning'],  family: 'openai' },

  // ── DeepSeek ───────────────────────────────────────────────────
  'deepseek-chat':          { rpd: null, rpm: null, context: 64000,  caps: ['chat','function_calling'],              family: 'openai' },
  'deepseek-reasoner':      { rpd: null, rpm: null, context: 64000,  caps: ['chat','function_calling','reasoning'],  family: 'openai' },

  // ── Qwen ───────────────────────────────────────────────────────
  'qwen-max':               { rpd: null, rpm: null, context: 32000,  caps: ['chat','vision','function_calling'],     family: 'openai' },
  'qwen-plus':              { rpd: null, rpm: null, context: 131072, caps: ['chat','vision','function_calling'],     family: 'openai' },
  'qwen-turbo':             { rpd: null, rpm: null, context: 1000000,caps: ['chat','function_calling'],              family: 'openai' },

  // ── Zhipu GLM ──────────────────────────────────────────────────
  'glm-4':                  { rpd: null, rpm: null, context: 131072, caps: ['chat','vision','function_calling'],     family: 'openai' },
  'glm-4-plus':             { rpd: null, rpm: null, context: 131072, caps: ['chat','vision','function_calling'],     family: 'openai' },
  'glm-4-flash':            { rpd: null, rpm: null, context: 131072, caps: ['chat','function_calling'],              family: 'openai' },

  // ── Moonshot Kimi ──────────────────────────────────────────────
  'moonshot-v1-8k':         { rpd: null, rpm: null, context: 8192,   caps: ['chat','function_calling'],              family: 'openai' },
  'moonshot-v1-32k':        { rpd: null, rpm: null, context: 32768,  caps: ['chat','function_calling'],              family: 'openai' },
  'moonshot-v1-128k':       { rpd: null, rpm: null, context: 131072, caps: ['chat','function_calling'],              family: 'openai' },
};

/**
 * Token-based fallback rules (evaluated when no exact/prefix match).
 * Each rule: { test: RegExp, preset: {...} }
 */
export const PRESET_RULES = [
  // ── Embedding 系列(最特殊,放最前)
  { test: /embed/i,           preset: { rpd: null, rpm: null, caps: ['embedding'],                              family: 'openai' } },

  // ── Vendor 默认规则(放在 /flash/i 之前,避免 deepseek-v4-flash 等误匹配到 gemini)
  // DeepSeek reasoning(R1/Reasoner 支持 thinking;V4/Chat/Coder 不支持)
  { test: /deepseek-?r|reasoner/i, preset: { rpd: null, rpm: null, caps: ['chat','function_calling','reasoning'], family: 'openai' } },
  // DeepSeek 默认(V4/Chat/Coder 等)
  { test: /deepseek/i, preset: { rpd: null, rpm: null, caps: ['chat','function_calling'], family: 'openai' } },

  // ── Gemini:flash-lite 优先(低配版,通常不支持 thinking)
  { test: /flash-?lite/i,     preset: { rpd: 500,  rpm: 15, caps: ['chat','function_calling'],                       family: 'gemini' } },
  // Gemini 2.5+ 全系支持 thinking(覆盖 2.5/3.0/3.1/3.5/4.x 等未来版本)
  { test: /gemini-?(2\.[5-9]|[3-9]\.\d)/i, preset: { rpd: 250, rpm: 15, caps: ['chat','vision','function_calling','reasoning'], family: 'gemini' } },
  // Gemini pro(任何版本)
  { test: /gemini.*pro/i,     preset: { rpd: 50,   rpm: 10, caps: ['chat','vision','pdf','function_calling'],        family: 'gemini' } },
  // Gemini flash(任何版本,2.0 及以下)
  { test: /flash/i,           preset: { rpd: 250,  rpm: 15, caps: ['chat','vision','function_calling'],              family: 'gemini' } },
  // Gemini 默认(任何 gemini-*)
  { test: /gemini/i,          preset: { rpd: 250,  rpm: 15, caps: ['chat','vision','function_calling'],              family: 'gemini' } },

  // ── Claude:3.7/4.5+/4.8/sonnet-5/opus-5/fable-5 支持 extended thinking
  // 4[._-]?[5-9] 匹配 4.5/4.6/4.7/4.8/4.9/4-5 等;fable-?5 匹配 Fable 5
  { test: /claude.*(3[._-]?7|4[._-]?[5-9]|sonnet-?5|opus-?5|fable-?5)/i, preset: { rpd: null, rpm: null, caps: ['chat','vision','pdf','function_calling','reasoning'], family: 'anthropic' } },
  { test: /sonnet/i,          preset: { rpd: null, rpm: null, caps: ['chat','vision','pdf','function_calling'], family: 'anthropic' } },
  { test: /opus/i,            preset: { rpd: null, rpm: null, caps: ['chat','vision','pdf','function_calling'], family: 'anthropic' } },
  { test: /haiku/i,           preset: { rpd: null, rpm: null, caps: ['chat','vision','function_calling'],       family: 'anthropic' } },
  // Claude 默认(任何 claude-* 模型,兜底)
  { test: /claude/i,          preset: { rpd: null, rpm: null, caps: ['chat','vision','pdf','function_calling'], family: 'anthropic' } },

  // ── OpenAI reasoning 系列(o1/o3/o4+)
  { test: /\bo[1-9]\b/i,      preset: { rpd: null, rpm: null, caps: ['chat','function_calling','reasoning'], family: 'openai' } },
  // OpenAI GPT-4o+/GPT-5+
  { test: /gpt-?(4o|5)/i,     preset: { rpd: null, rpm: null, caps: ['chat','vision','function_calling'], family: 'openai' } },

  // ── GLM 4.5+/5.x 支持 thinking
  { test: /glm-?(4\.[5-9]|[5-9])/i, preset: { rpd: null, rpm: null, caps: ['chat','vision','function_calling','reasoning'], family: 'openai' } },

  // ── Qwen3 系列支持 thinking(enable_thinking 参数);Qwen2.5-Coder 不支持
  { test: /qwen-?3/i, preset: { rpd: null, rpm: null, caps: ['chat','vision','function_calling','reasoning'], family: 'openai' } },

  // ── Llama 4 支持 thinking(Llama 3.x 不支持)
  { test: /llama-?4/i, preset: { rpd: null, rpm: null, caps: ['chat','function_calling','reasoning'], family: 'openai' } },

  // ── Grok 3 支持 thinking(Grok 2 不支持)
  { test: /grok-?3/i, preset: { rpd: null, rpm: null, caps: ['chat','function_calling','reasoning'], family: 'openai' } },

  // ── Kimi K2/K1.5 支持 thinking;silent 版本不带 thinking(优先匹配)
  { test: /kimi.*silent|k-?1[._-]?5-?silent/i, preset: { rpd: null, rpm: null, caps: ['chat','function_calling'], family: 'openai' } },
  { test: /kimi.*k-?2|k-?1[._-]?5/i, preset: { rpd: null, rpm: null, caps: ['chat','function_calling','reasoning'], family: 'openai' } },

  // ── QwQ / 其他 thinking 模型
  { test: /qwq|thinking|reason/i, preset: { rpd: null, rpm: null, caps: ['chat','function_calling','reasoning'], family: 'openai' } },
];

/** Per-family defaults when nothing else matches. */
export const FAMILY_DEFAULTS = {
  gemini:    { rpd: null, rpm: 10, caps: ['chat','vision','function_calling'],        context: 1048576 },
  anthropic: { rpd: null, rpm: null, caps: ['chat','vision','pdf','function_calling'], context: 200000 },
  openai:    { rpd: null, rpm: null, caps: ['chat','function_calling'],               context: 128000 },
  custom:    { rpd: null, rpm: null, caps: ['chat','function_calling'],               context: null },
};

/**
 * Resolve a preset for a model id. Returns a normalized object always:
 *   { rpd, rpm, context, capabilities, family, source }
 * Never throws — fail-open returns family default or minimal defaults.
 */
export function resolvePreset(modelId, familyHint) {
  const id = String(modelId || '').toLowerCase();

  // 1. exact match
  if (MODEL_PRESETS[id]) {
    return normalize(enhanceWithRules(MODEL_PRESETS[id], id), 'exact');
  }

  // 2. prefix / substring match (e.g. "claude-3-5-sonnet-20241022" → "claude-3-5-sonnet")
  for (const [key, p] of Object.entries(MODEL_PRESETS)) {
    if (id.startsWith(key) || id.includes(key)) {
      return normalize(enhanceWithRules(p, id), 'prefix');
    }
  }

  // 3. regex rules
  for (const rule of PRESET_RULES) {
    if (rule.test.test(id)) {
      return normalize(rule.preset, 'rule');
    }
  }

  // 4. family default
  const fam = detectFamily(id, familyHint);
  const def = FAMILY_DEFAULTS[fam] || FAMILY_DEFAULTS.openai;
  return normalize({ ...def, family: fam }, 'default');
}

/**
 * 当 exact/prefix 匹配命中的 preset 缺少 reasoning 能力时,
 * 用 PRESET_RULES 中**第一个匹配**的规则决定是否补 reasoning。
 * 规则已按优先级排序(flash-lite 优先于 gemini 2.5+),
 * 所以第一个匹配的规则能正确反映该模型是否支持 thinking。
 * 覆盖新版本如 glm-4.7(prefix 命中 glm-4 但应支持 thinking)。
 */
function enhanceWithRules(preset, modelId) {
  if (!preset || (Array.isArray(preset.caps) && preset.caps.includes('reasoning'))) {
    return preset;
  }
  const id = String(modelId || '').toLowerCase();
  for (const rule of PRESET_RULES) {
    if (rule.test.test(id)) {
      // 第一个匹配的规则决定是否补 reasoning
      if (rule.preset?.caps?.includes('reasoning')) {
        return {
          ...preset,
          caps: Array.from(new Set([...(preset.caps || ['chat']), 'reasoning'])),
        };
      }
      // 第一个匹配的规则不带 reasoning(如 flash-lite),说明该模型不支持 thinking
      return preset;
    }
  }
  return preset;
}

function detectFamily(id, hint) {
  if (hint && FAMILY_DEFAULTS[hint]) return hint;
  if (id.includes('gemini') || id.includes('claude') || id.includes('anthropic')) {
    return id.includes('gemini') ? 'gemini' : 'anthropic';
  }
  return 'openai';
}

function normalize(p, source) {
  return {
    rpd: p.rpd ?? null,
    rpm: p.rpm ?? null,
    context: p.context ?? null,
    capabilities: Array.isArray(p.caps) ? p.caps : ['chat'],
    family: p.family || 'openai',
    source,
  };
}

/** Convenience: get just the rpd (null = unlimited). */
export function presetRPD(modelId, familyHint) {
  return resolvePreset(modelId, familyHint).rpd;
}

/** Convenience: get just the rpm (null = unlimited). */
export function presetRPM(modelId, familyHint) {
  return resolvePreset(modelId, familyHint).rpm;
}
