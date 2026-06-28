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
  'gemini-2.5-pro':         { rpd: 50,  rpm: 10, context: 2097152, caps: ['chat','vision','pdf'], family: 'gemini' },
  'gemini-2.5-flash':       { rpd: 250, rpm: 15, context: 1048576, caps: ['chat','vision'],       family: 'gemini' },
  'gemini-2.5-flash-lite':  { rpd: 500, rpm: 15, context: 1048576, caps: ['chat'],                family: 'gemini' },
  'gemini-2.5-flash-tts':   { rpd: 250, rpm: 15, context: 1048576, caps: ['chat'],                family: 'gemini' },
  'gemini-2.0-flash':       { rpd: 250, rpm: 15, context: 1048576, caps: ['chat','vision'],       family: 'gemini' },
  'gemini-2.0-flash-exp':   { rpd: 1500, rpm: 15, context: 1048576, caps: ['chat','vision'],      family: 'gemini' },
  'gemini-2.0-flash-lite':  { rpd: 500, rpm: 15, context: 1048576, caps: ['chat'],                family: 'gemini' },
  'gemini-1.5-pro':         { rpd: 50,  rpm: 10, context: 2097152, caps: ['chat','vision','pdf'], family: 'gemini' },
  'gemini-1.5-flash':       { rpd: 250, rpm: 15, context: 1048576, caps: ['chat','vision'],       family: 'gemini' },
  'gemini-1.5-flash-8b':    { rpd: 500, rpm: 15, context: 1048576, caps: ['chat'],                family: 'gemini' },

  // ── Anthropic Claude ───────────────────────────────────────────
  'claude-opus-4-1':        { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf'], family: 'anthropic' },
  'claude-opus-4-5':        { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf'], family: 'anthropic' },
  'claude-sonnet-4':        { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf'], family: 'anthropic' },
  'claude-sonnet-4-5':      { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf'], family: 'anthropic' },
  'claude-haiku-3-5':       { rpd: null, rpm: null, context: 200000, caps: ['chat','vision'],      family: 'anthropic' },
  'claude-3-5-sonnet':      { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf'], family: 'anthropic' },
  'claude-3-5-haiku':       { rpd: null, rpm: null, context: 200000, caps: ['chat','vision'],      family: 'anthropic' },
  'claude-3-opus':          { rpd: null, rpm: null, context: 200000, caps: ['chat','vision','pdf'], family: 'anthropic' },

  // ── OpenAI ─────────────────────────────────────────────────────
  'gpt-4o':                 { rpd: null, rpm: null, context: 128000, caps: ['chat','vision'],      family: 'openai' },
  'gpt-4o-mini':            { rpd: null, rpm: null, context: 128000, caps: ['chat','vision'],      family: 'openai' },
  'gpt-4-turbo':            { rpd: null, rpm: null, context: 128000, caps: ['chat','vision'],      family: 'openai' },
  'gpt-4':                  { rpd: null, rpm: null, context: 8192,   caps: ['chat'],               family: 'openai' },
  'gpt-3.5-turbo':          { rpd: null, rpm: null, context: 16385,  caps: ['chat'],               family: 'openai' },
  'o1':                     { rpd: null, rpm: null, context: 200000, caps: ['chat'],               family: 'openai' },
  'o1-mini':                { rpd: null, rpm: null, context: 128000, caps: ['chat'],               family: 'openai' },
  'o3-mini':                { rpd: null, rpm: null, context: 200000, caps: ['chat'],               family: 'openai' },

  // ── DeepSeek ───────────────────────────────────────────────────
  'deepseek-chat':          { rpd: null, rpm: null, context: 64000,  caps: ['chat'],               family: 'openai' },
  'deepseek-reasoner':      { rpd: null, rpm: null, context: 64000,  caps: ['chat'],               family: 'openai' },

  // ── Qwen ───────────────────────────────────────────────────────
  'qwen-max':               { rpd: null, rpm: null, context: 32000,  caps: ['chat','vision'],      family: 'openai' },
  'qwen-plus':              { rpd: null, rpm: null, context: 131072, caps: ['chat','vision'],      family: 'openai' },
  'qwen-turbo':             { rpd: null, rpm: null, context: 1000000,caps: ['chat'],               family: 'openai' },

  // ── Zhipu GLM ──────────────────────────────────────────────────
  'glm-4':                  { rpd: null, rpm: null, context: 131072, caps: ['chat','vision'],      family: 'openai' },
  'glm-4-plus':             { rpd: null, rpm: null, context: 131072, caps: ['chat','vision'],      family: 'openai' },
  'glm-4-flash':            { rpd: null, rpm: null, context: 131072, caps: ['chat'],               family: 'openai' },

  // ── Moonshot Kimi ──────────────────────────────────────────────
  'moonshot-v1-8k':         { rpd: null, rpm: null, context: 8192,   caps: ['chat'],               family: 'openai' },
  'moonshot-v1-32k':        { rpd: null, rpm: null, context: 32768,  caps: ['chat'],               family: 'openai' },
  'moonshot-v1-128k':       { rpd: null, rpm: null, context: 131072, caps: ['chat'],               family: 'openai' },
};

/**
 * Token-based fallback rules (evaluated when no exact/prefix match).
 * Each rule: { test: RegExp, preset: {...} }
 */
export const PRESET_RULES = [
  { test: /flash-?lite/i,     preset: { rpd: 500,  rpm: 15, caps: ['chat'],                family: 'gemini' } },
  { test: /flash/i,           preset: { rpd: 250,  rpm: 15, caps: ['chat','vision'],       family: 'gemini' } },
  { test: /gemini-?\d.*pro/i, preset: { rpd: 50,   rpm: 10, caps: ['chat','vision','pdf'], family: 'gemini' } },
  { test: /sonnet/i,          preset: { rpd: null, rpm: null, caps: ['chat','vision','pdf'], family: 'anthropic' } },
  { test: /opus/i,            preset: { rpd: null, rpm: null, caps: ['chat','vision','pdf'], family: 'anthropic' } },
  { test: /haiku/i,           preset: { rpd: null, rpm: null, caps: ['chat','vision'],       family: 'anthropic' } },
  { test: /embed/i,           preset: { rpd: null, rpm: null, caps: ['embedding'],           family: 'openai' } },
];

/** Per-family defaults when nothing else matches. */
export const FAMILY_DEFAULTS = {
  gemini:    { rpd: null, rpm: 10, caps: ['chat','vision'],       context: 1048576 },
  anthropic: { rpd: null, rpm: null, caps: ['chat','vision','pdf'], context: 200000 },
  openai:    { rpd: null, rpm: null, caps: ['chat'],              context: 128000 },
  custom:    { rpd: null, rpm: null, caps: ['chat'],              context: null },
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
    return normalize(MODEL_PRESETS[id], 'exact');
  }

  // 2. prefix / substring match (e.g. "claude-3-5-sonnet-20241022" → "claude-3-5-sonnet")
  for (const [key, p] of Object.entries(MODEL_PRESETS)) {
    if (id.startsWith(key) || id.includes(key)) {
      return normalize(p, 'prefix');
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
