/**
 * Phase 3.2: 内置 Provider Presets 目录
 *
 * 列出常见 LLM provider 的预设配置(vendor / type / base_url / 代表模型 / 注册页),
 * Dashboard 添加 provider 时可从本目录选择,自动填入 base_url 和推荐模型,
 * 用户只需填入 API key 即可完成配置。
 *
 * 所有非 gemini/anthropic 的 provider 都走 openai 兼容协议(OpenAIProvider)。
 */

export const PROVIDER_PRESETS = [
  // ── Google Gemini ──────────────────────────────────────────────
  {
    vendor: 'gemini',
    displayName: 'Google Gemini',
    type: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    website: 'https://aistudio.google.com/apikey',
  },

  // ── Anthropic Claude ───────────────────────────────────────────
  {
    vendor: 'claude',
    displayName: 'Anthropic Claude',
    type: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-3-5', 'claude-3-5-sonnet'],
    website: 'https://console.anthropic.com/settings/keys',
  },

  // ── OpenAI ─────────────────────────────────────────────────────
  {
    vendor: 'openai',
    displayName: 'OpenAI',
    type: 'openai',
    defaultBaseUrl: 'https://api.openai.com',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1'],
    website: 'https://platform.openai.com/api-keys',
  },

  // ── DeepSeek ───────────────────────────────────────────────────
  {
    vendor: 'deepseek',
    displayName: 'DeepSeek',
    type: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    website: 'https://platform.deepseek.com/api_keys',
  },

  // ── 智谱 GLM ───────────────────────────────────────────────────
  {
    vendor: 'glm',
    displayName: '智谱 GLM',
    type: 'openai',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5', 'glm-4-plus', 'glm-4-flash'],
    website: 'https://open.bigmodel.cn/usercenter/apikeys',
  },

  // ── Moonshot Kimi ──────────────────────────────────────────────
  {
    vendor: 'kimi',
    displayName: 'Moonshot Kimi',
    type: 'openai',
    defaultBaseUrl: 'https://api.moonshot.cn',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-latest'],
    website: 'https://platform.moonshot.cn/console/api-keys',
  },

  // ── 通义千问 Qwen ──────────────────────────────────────────────
  {
    vendor: 'qwen',
    displayName: '通义千问 Qwen',
    type: 'openai',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen3-coder-plus'],
    website: 'https://dashscope.console.aliyun.com/apiKey',
  },

  // ── Nvidia ─────────────────────────────────────────────────────
  {
    vendor: 'nvidia',
    displayName: 'NVIDIA NIM',
    type: 'openai',
    defaultBaseUrl: 'https://integrate.api.nvidia.com',
    models: ['nvidia/llama-3.1-nemotron-70b-instruct', 'deepseek-ai/deepseek-r1'],
    website: 'https://build.nvidia.com/',
  },

  // ── 小米 MiMo ──────────────────────────────────────────────────
  {
    vendor: 'mimo',
    displayName: '小米 MiMo',
    type: 'openai',
    defaultBaseUrl: 'https://api.mimo.xiaomi.com',
    models: ['mimo-7b', 'mimo-coder'],
    website: 'https://mimo.xiaomi.com/',
  },

  // ── 火山 Agentplan ─────────────────────────────────────────────
  {
    vendor: 'volc-agentplan',
    displayName: '火山 Agentplan',
    type: 'openai',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-pro', 'doubao-lite', 'deepseek-r1'],
    website: 'https://console.volcengine.com/ark/',
  },

  // ── 胜算云 ─────────────────────────────────────────────────────
  {
    vendor: 'shengsuan',
    displayName: '胜算云',
    type: 'openai',
    defaultBaseUrl: 'https://api.shengsuan.cn',
    models: ['shengsuan-pro', 'shengsuan-lite'],
    website: 'https://www.shengsuan.cn/',
  },

  // ── SubRouter ──────────────────────────────────────────────────
  {
    vendor: 'subrouter',
    displayName: 'SubRouter',
    type: 'openai',
    defaultBaseUrl: 'https://api.subrouter.com',
    models: ['gpt-4o', 'claude-3-5-sonnet', 'gemini-2.5-flash'],
    website: 'https://subrouter.com/',
  },

  // ── 小黄云 ─────────────────────────────────────────────────────
  {
    vendor: 'xhy',
    displayName: '小黄云',
    type: 'openai',
    defaultBaseUrl: 'https://api.xiaohuangyun.com',
    models: ['gpt-4o', 'claude-3-5-sonnet', 'deepseek-chat'],
    website: 'https://xiaohuangyun.com/',
  },

  // ── SiliconFlow ────────────────────────────────────────────────
  {
    vendor: 'siliconflow',
    displayName: 'SiliconFlow 硅基流动',
    type: 'openai',
    defaultBaseUrl: 'https://api.siliconflow.cn',
    models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct'],
    website: 'https://cloud.siliconflow.cn/account/ak',
  },

  // ── OpenRouter ─────────────────────────────────────────────────
  {
    vendor: 'openrouter',
    displayName: 'OpenRouter',
    type: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api',
    models: ['anthropic/claude-3.5-sonnet', 'google/gemini-2.5-flash', 'openai/gpt-4o'],
    website: 'https://openrouter.ai/keys',
  },
];

/**
 * 根据 vendor 短名查找预设
 */
export function findPreset(vendor) {
  return PROVIDER_PRESETS.find(p => p.vendor === vendor);
}

/**
 * 获取所有预设(精简版,用于 Dashboard 下拉选择)
 */
export function listPresets() {
  return PROVIDER_PRESETS.map(p => ({
    vendor: p.vendor,
    displayName: p.displayName,
    type: p.type,
    defaultBaseUrl: p.defaultBaseUrl,
    models: p.models,
    website: p.website,
  }));
}
