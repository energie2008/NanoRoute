const MODEL_REGISTRY = {
  'google-gemini': [
    { value: 'gemini-3.5-pro',          label: 'Gemini 3.5 Pro',            rpd: null, rpm: 10,  capabilities: ['chat', 'vision', 'pdf'] },
    { value: 'gemini-3.5-flash',        label: 'Gemini 3.5 Flash',          rpd: 20,   rpm: 15,  capabilities: ['chat', 'vision'] },
    { value: 'gemini-3.1-flash-lite',   label: 'Gemini 3.1 Flash Lite',     rpd: 500,  rpm: 15,  capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'openai': [
    { value: 'gpt-5.6-sol',             label: 'GPT-5.6 Sol',               rpd: null, rpm: null, base_url: 'https://api.openai.com/v1', capabilities: ['chat', 'vision'] },
    { value: 'gpt-5.6-terra',           label: 'GPT-5.6 Terra',             rpd: null, rpm: null, base_url: 'https://api.openai.com/v1', capabilities: ['chat', 'vision'] },
    { value: 'gpt-5.6-luna',            label: 'GPT-5.6 Luna',              rpd: null, rpm: null, base_url: 'https://api.openai.com/v1', capabilities: ['chat', 'vision'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'anthropic': [
    { value: 'claude-fable-5',          label: 'Claude Fable 5 (最新旗舰)',  rpd: null, rpm: null, base_url: 'https://api.anthropic.com/v1', capabilities: ['chat', 'vision', 'pdf'] },
    { value: 'claude-opus-4.8',         label: 'Claude Opus 4.8',           rpd: null, rpm: null, base_url: 'https://api.anthropic.com/v1', capabilities: ['chat', 'vision'] },
    { value: 'claude-haiku-3.5',        label: 'Claude Haiku 3.5',          rpd: null, rpm: null, base_url: 'https://api.anthropic.com/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'qwen': [
    { value: 'qwen3.7-max',             label: 'Qwen 3.7 Max (通义千问)',    rpd: null, rpm: null, base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', capabilities: ['chat', 'vision'] },
    { value: 'qwen3.7-turbo',           label: 'Qwen 3.7 Turbo',            rpd: null, rpm: null, base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', capabilities: ['chat'] },
    { value: 'qwen2.5-7b-instruct',     label: 'Qwen 2.5 7B Instruct',      rpd: null, rpm: null, base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'zhipu': [
    { value: 'glm-5.2',                 label: 'GLM-5.2 (智谱AI)',          rpd: null, rpm: null, base_url: 'https://open.bigmodel.cn/api/paas/v4', capabilities: ['chat', 'vision'] },
    { value: 'glm-5.1',                 label: 'GLM-5.1',                   rpd: null, rpm: null, base_url: 'https://open.bigmodel.cn/api/paas/v4', capabilities: ['chat'] },
    { value: 'glm-4.7-flash',           label: 'GLM-4.7 Flash (免费)',       rpd: null, rpm: null, base_url: 'https://open.bigmodel.cn/api/paas/v4', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'ernie': [
    { value: 'ernie-5.0-ultra',         label: 'ERNIE 5.0 Ultra (文心一言)', rpd: null, rpm: null, base_url: 'https://qianfan.baidubce.com/v2', capabilities: ['chat', 'vision'] },
    { value: 'ernie-lite-8k',           label: 'ERNIE Lite 8K',             rpd: null, rpm: null, base_url: 'https://qianfan.baidubce.com/v2', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'doubao': [
    { value: 'doubao-seed-2.0-ultra',   label: 'Doubao Seed 2.0 Ultra (豆包)', rpd: null, rpm: null, base_url: 'https://ark.cn-beijing.volces.com/api/v3', capabilities: ['chat', 'vision'] },
    { value: 'doubao-lite-4k',          label: 'Doubao Lite 4K',            rpd: null, rpm: null, base_url: 'https://ark.cn-beijing.volces.com/api/v3', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'xai-grok': [
    { value: 'grok-3.1-ultra',          label: 'Grok 3.1 Ultra (xAI)',      rpd: null, rpm: null, base_url: 'https://api.x.ai/v1', capabilities: ['chat', 'vision'] },
    { value: 'grok-3-mini',             label: 'Grok 3 Mini',               rpd: null, rpm: null, base_url: 'https://api.x.ai/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'mistral': [
    { value: 'mistral-large-3',         label: 'Mistral Large 3',           rpd: null, rpm: null, base_url: 'https://api.mistral.ai/v1', capabilities: ['chat'] },
    { value: 'mistral-7b-instruct-v0.3', label: 'Mistral 7B Instruct',      rpd: null, rpm: null, base_url: 'https://api.mistral.ai/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'moonshot': [
    { value: 'moonshot-v1-1024k',       label: 'Moonshot v1 1024K (Kimi)',  rpd: null, rpm: null, base_url: 'https://api.moonshot.cn/v1', capabilities: ['chat'] },
    { value: 'moonshot-v1-8k',          label: 'Moonshot v1 8K',            rpd: null, rpm: null, base_url: 'https://api.moonshot.cn/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'deepseek': [
    { value: 'deepseek-v3.2-ultra',     label: 'DeepSeek V3.2 Ultra',       rpd: null, rpm: null, base_url: 'https://api.deepseek.com/v1', capabilities: ['chat'] },
    { value: 'deepseek-r1-distill-8b',  label: 'DeepSeek R1 Distill 8B',    rpd: null, rpm: null, base_url: 'https://api.deepseek.com/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'xinghuo': [
    { value: 'spark-5.0-ultra',         label: 'Spark 5.0 Ultra (讯飞星火)', rpd: null, rpm: null, base_url: 'https://spark-api.xf-yun.com/v1', capabilities: ['chat', 'vision'] },
    { value: 'spark-lite',              label: 'Spark Lite',                rpd: null, rpm: null, base_url: 'https://spark-api.xf-yun.com/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'cohere': [
    { value: 'command-r-plus-v2',       label: 'Command R+ V2 (Cohere)',    rpd: null, rpm: null, base_url: 'https://api.cohere.ai/v1', capabilities: ['chat'] },
    { value: 'command-light',           label: 'Command Light',             rpd: null, rpm: null, base_url: 'https://api.cohere.ai/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'meta-llama': [
    { value: 'llama-3.2-405b-instruct', label: 'Llama 3.2 405B (Meta)',     rpd: null, rpm: null, base_url: 'https://api.llama-api.com', capabilities: ['chat'] },
    { value: 'llama-3.1-8b-instruct',   label: 'Llama 3.1 8B Instruct',     rpd: null, rpm: null, base_url: 'https://api.llama-api.com', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'hunyuan': [
    { value: 'hunyuan-turbo-ultra',     label: 'Hunyuan Turbo Ultra (腾讯混元)', rpd: null, rpm: null, base_url: 'https://api.hunyuan.cloud.tencent.com', capabilities: ['chat', 'vision'] },
    { value: 'hunyuan-lite',            label: 'Hunyuan Lite',              rpd: null, rpm: null, base_url: 'https://api.hunyuan.cloud.tencent.com', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'lingyi': [
    { value: 'yi-3.5-200k',             label: 'Yi 3.5 200K (零一万物)',    rpd: null, rpm: null, base_url: 'https://platform.lingyiwanwu.com/v1', capabilities: ['chat'] },
    { value: 'yi-9b-lightning',         label: 'Yi 9B Lightning',           rpd: null, rpm: null, base_url: 'https://platform.lingyiwanwu.com/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'minimaxi': [
    { value: 'abab6.5s-ultra',          label: 'ABAB 6.5s Ultra (MiniMax)', rpd: null, rpm: null, base_url: 'https://api.minimaxi.chat/v1', capabilities: ['chat'] },
    { value: 'abab5.5-lite',            label: 'ABAB 5.5 Lite',             rpd: null, rpm: null, base_url: 'https://api.minimaxi.chat/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'baichuan': [
    { value: 'baichuan4-ultra',         label: 'Baichuan 4 Ultra (百川智能)', rpd: null, rpm: null, base_url: 'https://api.baichuan-ai.com/v1', capabilities: ['chat'] },
    { value: 'baichuan3-turbo-4k',      label: 'Baichuan 3 Turbo 4K',       rpd: null, rpm: null, base_url: 'https://api.baichuan-ai.com/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'siliconflow': [
    { value: 'Qwen/Qwen3.7-72B-Instruct', label: 'Qwen 3.7 72B (硅基流动)',  rpd: null, rpm: null, base_url: 'https://api.siliconflow.cn/v1', capabilities: ['chat'] },
    { value: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen 2.5 7B',             rpd: null, rpm: null, base_url: 'https://api.siliconflow.cn/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'tiangong': [
    { value: 'tiangong-4.0-ultra',      label: 'Tiangong 4.0 Ultra (天工AI)', rpd: null, rpm: null, base_url: 'https://model-platform.tiangong.cn/v1', capabilities: ['chat'] },
    { value: 'tiangong-lite',           label: 'Tiangong Lite',             rpd: null, rpm: null, base_url: 'https://model-platform.tiangong.cn/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'openrouter': [
    { value: 'openai/gpt-5.6-sol',      label: 'OpenAI GPT-5.6 Sol (OpenRouter)', rpd: null, rpm: null, base_url: 'https://openrouter.ai/api/v1', capabilities: ['chat', 'vision'] },
    { value: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B',     rpd: null, rpm: null, base_url: 'https://openrouter.ai/api/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'together': [
    { value: 'meta-llama/Llama-3.2-405B-Instruct', label: 'Llama 3.2 405B (Together)', rpd: null, rpm: null, base_url: 'https://api.together.xyz/v1', capabilities: ['chat'] },
    { value: 'mistralai/Mistral-7B-Instruct-v0.3', label: 'Mistral 7B',      rpd: null, rpm: null, base_url: 'https://api.together.xyz/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'groq': [
    { value: 'anthropic/claude-fable-5', label: 'Claude Fable 5 (Groq)',    rpd: null, rpm: null, base_url: 'https://api.groq.com/openai/v1', capabilities: ['chat'] },
    { value: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 70B',    rpd: null, rpm: null, base_url: 'https://api.groq.com/openai/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
  'wavespeed': [
    { value: 'anthropic/claude-fable-5', label: 'Claude Fable 5 (WaveSpeed)', rpd: null, rpm: null, base_url: 'https://api.wavespeed.ai/v1', capabilities: ['chat'] },
    { value: 'qwen/qwen-2.5-7b-instruct', label: 'Qwen 2.5 7B',            rpd: null, rpm: null, base_url: 'https://api.wavespeed.ai/v1', capabilities: ['chat'] },
    { value: '__custom__',              label: '自定义模型…',                rpd: null, rpm: null, base_url: null, capabilities: ['chat'] },
  ],
};

const TYPE_OPTIONS = [
  { value: 'google-gemini', label: '🌟 Google Gemini (美国)' },
  { value: 'openai',        label: '🌟 OpenAI (美国)' },
  { value: 'anthropic',     label: '🌟 Anthropic Claude (美国)' },
  { value: 'qwen',          label: '🌟 阿里通义千问 (中国)' },
  { value: 'zhipu',         label: '🌟 智谱AI GLM (中国)' },
  { value: 'ernie',         label: '百度文心千帆 (中国)' },
  { value: 'doubao',        label: '字节豆包 (中国)' },
  { value: 'xai-grok',      label: 'xAI Grok (美国)' },
  { value: 'mistral',       label: 'Mistral AI (法国)' },
  { value: 'moonshot',      label: '月之暗面 Kimi (中国)' },
  { value: 'deepseek',      label: '深度求索 DeepSeek (中国)' },
  { value: 'xinghuo',       label: '科大讯飞星火 (中国)' },
  { value: 'cohere',        label: 'Cohere (加拿大)' },
  { value: 'meta-llama',    label: 'Meta Llama (美国)' },
  { value: 'hunyuan',       label: '腾讯混元 (中国)' },
  { value: 'lingyi',        label: '零一万物 Yi (中国)' },
  { value: 'minimaxi',      label: 'MiniMax 稀宇 (中国)' },
  { value: 'baichuan',      label: '百川智能 Baichuan (中国)' },
  { value: 'siliconflow',   label: '硅基流动 SiliconFlow (聚合)' },
  { value: 'tiangong',      label: '昆仑万维天工 (中国)' },
  { value: 'openrouter',    label: 'OpenRouter (聚合-标杆)' },
  { value: 'together',      label: 'Together AI (聚合)' },
  { value: 'groq',          label: 'Groq (极速聚合)' },
  { value: 'wavespeed',     label: 'WaveSpeed AI (全球聚合)' },
];

const PRIORITY_OPTIONS = [
  { value: 4, label: '4 — 最高' },
  { value: 3, label: '3 — 高' },
  { value: 2, label: '2 — 中' },
  { value: 1, label: '1 — 兜底' },
];

const CAPABILITY_OPTIONS = [
  { value: 'chat', label: 'chat' },
  { value: 'vision', label: 'vision' },
  { value: 'pdf', label: 'pdf' },
  { value: 'search', label: 'search' },
  { value: 'function_calling', label: 'function_calling' },
];

function getModelsForType(type) {
  return MODEL_REGISTRY[type] || MODEL_REGISTRY['openai'] || [];
}

function getModelMeta(type, modelValue) {
  const models = MODEL_REGISTRY[type] || MODEL_REGISTRY['openai'] || [];
  return models.find(m => m.value === modelValue) || null;
}

function getBaseUrlForType(type) {
  const models = MODEL_REGISTRY[type];
  if (models && models.length > 0) {
    const firstReal = models.find(m => m.value !== '__custom__' && m.base_url);
    if (firstReal) return firstReal.base_url;
  }
  return null;
}

// Phase F-2: 动态模型合并支持
let _dynamicModels = {};

function setDynamicModels(typeModelsMap) {
  _dynamicModels = typeModelsMap || {};
}

function getMergedModelsForType(type) {
  const dynamic = _dynamicModels[type] || [];
  const static_ = MODEL_REGISTRY[type] || MODEL_REGISTRY['openai'] || [];

  const seen = new Set(dynamic.map(m => m.value));
  const merged = [
    ...dynamic,
    ...static_.filter(m => !seen.has(m.value) && m.value !== '__custom__'),
    static_.find(m => m.value === '__custom__')
  ].filter(Boolean);

  return merged;
}

function buildDynamicFromModelsAPI(modelsData, type) {
  if (!Array.isArray(modelsData)) return;
  const ownedByMatch = type === 'google-gemini' ? 'gemini' : type;
  _dynamicModels[type] = modelsData
    .filter(m => m.owned_by === ownedByMatch || m.nano_meta?.type === ownedByMatch)
    .map(m => ({
      value: m.id,
      label: m.id,
      capabilities: m.capabilities || ['chat'],
      rpd: m.nano_meta?.rpd || null,
      rpm: m.nano_meta?.rpm || null
    }));
}
