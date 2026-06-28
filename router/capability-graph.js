// router/capability-graph.js
// 静态能力簇：tier 内可互相桥接，caps 为簇最低能力要求
// members 使用 canonical 前缀（不带版本号），前缀匹配

export const CAPABILITY_CLUSTERS = {
  'flagship-multimodal': {
    caps: ['chat', 'vision', 'pdf'],
    // 旗舰多模态：最强推理+视觉+文档
    members: [
      'gpt-4o', 'gpt-5', 'gpt-5.6',
      'claude-opus', 'claude-fable', 'claude-sonnet-4',
      'gemini-2.5-pro', 'gemini-3.5-pro',
      'qwen-max', 'grok-3.1-ultra'
    ]
  },
  'fast-multimodal': {
    caps: ['chat', 'vision'],
    // 快速多模态：视觉+低延迟
    members: [
      'gpt-4o-mini', 'gpt-4.1-mini',
      'claude-haiku', 'claude-haiku-3',
      'gemini-2.5-flash', 'gemini-3.5-flash',
      'qwen-vl', 'grok-3-mini'
    ]
  },
  'fast-chat': {
    caps: ['chat'],
    // 极速纯文本：最低延迟，适合代码补全
    members: [
      'gemini-flash-lite', 'gemini-3.1-flash-lite',
      'deepseek-v3', 'deepseek-v3.2',
      'qwen-turbo', 'qwen3.7-turbo',
      'gpt-3.5-turbo', 'glm-4-flash', 'glm-4.7-flash'
    ]
  },
  'reasoning': {
    caps: ['chat', 'reasoning'],
    // 推理专用：CoT / extended thinking
    members: [
      'o3', 'o4', 'o4-mini',
      'claude-opus', 'claude-opus-4',
      'deepseek-r1', 'deepseek-r2',
      'gemini-2.5-pro',
      'qwq', 'qwq-32b'
    ]
  },
  'long-context': {
    caps: ['chat'],
    // 超长上下文：200k+ token
    members: [
      'gemini-2.5-pro', 'gemini-3.5-pro',
      'claude-opus', 'claude-fable',
      'moonshot-v1-1024k', 'kimi-128k'
    ]
  }
};

// 前缀匹配：'gpt-4o-mini' 命中 'gpt-4o'（前缀+连字符）
function memberMatches(modelId, member) {
  const id = modelId.toLowerCase().trim();
  const base = member.toLowerCase().trim();
  return id === base
    || id.startsWith(base + '-')
    || id.startsWith(base + '.');
}

/**
 * 返回 requestedModel 所在的能力簇（最长前缀匹配优先）
 * @param {string} modelId
 * @returns {{ name: string, cluster: object } | null}
 */
export function findCluster(modelId) {
  if (!modelId) return null;
  let bestMatch = null;
  let bestMatchLen = 0;

  for (const [name, cluster] of Object.entries(CAPABILITY_CLUSTERS)) {
    for (const member of cluster.members) {
      if (memberMatches(modelId, member) && member.length > bestMatchLen) {
        bestMatch = { name, cluster };
        bestMatchLen = member.length;
      }
    }
  }
  return bestMatch;
}

/**
 * 返回同簇中 availableModels 里有、但不是 requestedModel 自身的候选列表
 * 按 cluster.members 顺序排列（越靠前优先级越高）
 * @param {string} requestedModel
 * @param {Iterable<string>} availableModels  当前 config.providers 的 model 集合
 * @returns {string[]}
 */
export function getBridgeCandidates(requestedModel, availableModels) {
  const hit = findCluster(requestedModel);
  if (!hit) return [];

  const avail = new Set([...availableModels].map(m => m.toLowerCase().trim()));
  const result = [];
  const seen = new Set();
  const reqNorm = requestedModel.toLowerCase().trim();

  for (const member of hit.cluster.members) {
    for (const modelId of availableModels) {
      const norm = modelId.toLowerCase().trim();
      if (norm === reqNorm) continue;          // 跳过自身
      if (seen.has(norm)) continue;            // 去重
      if (memberMatches(norm, member)) {
        result.push(modelId);                  // 保留原始大小写
        seen.add(norm);
      }
    }
  }
  return result;
}
