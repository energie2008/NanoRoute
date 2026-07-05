/**
 * Reasoning Effort 归一化层
 *
 * 将客户端传入的各种 thinking/reasoning 字段归一化为内部标准:
 *   reasoning_effort: 'low' | 'medium' | 'high' | 'xhigh' | undefined
 *
 * 各 provider 再据此转换为上游字段:
 *   - Anthropic: thinking.type=enabled, budget_tokens
 *   - Gemini:    generationConfig.thinkingConfig
 *   - OpenAI:    reasoning_effort / max_completion_tokens
 *   - DeepSeek:  thinking(field)
 *   - Qwen/GLM:  enable_thinking
 *
 * 归一化优先级(参考 cc-switch transform.rs):
 *   1. reasoning_effort 显式字段
 *   2. thinking.type=adaptive → xhigh
 *   3. thinking.type=enabled + budget_tokens → 按 budget 分档
 *   4. reasoning.effort 对象(OpenRouter)
 *   5. enable_thinking 布尔(SiliconFlow)
 */

const BUDGET_TIERS = [
  { max: 5000,  effort: 'low' },
  { max: 13000, effort: 'medium' },
  { max: 18000, effort: 'high' },
  { max: Infinity, effort: 'xhigh' },
];

/**
 * 从 OpenAI 风格请求体中提取并归一化 reasoning_effort
 * @param {object} body OpenAI 风格请求体
 * @returns {{ effort: 'low'|'medium'|'high'|'xhigh'|undefined, budget: number|null }}
 */
export function normalizeReasoningEffort(body) {
  if (!body || typeof body !== 'object') return { effort: undefined, budget: null };

  // 1. 显式 reasoning_effort
  if (body.reasoning_effort) {
    return { effort: body.reasoning_effort, budget: null };
  }

  // 2. thinking 对象(Anthropic 风格)
  if (body.thinking && typeof body.thinking === 'object') {
    if (body.thinking.type === 'adaptive') {
      return { effort: 'xhigh', budget: null };
    }
    if (body.thinking.type === 'enabled' && typeof body.thinking.budget_tokens === 'number') {
      const budget = body.thinking.budget_tokens;
      const tier = BUDGET_TIERS.find(t => budget < t.max);
      return { effort: tier ? tier.effort : 'medium', budget };
    }
    if (body.thinking.type === 'disabled') {
      return { effort: undefined, budget: null };
    }
  }

  // 3. output_config.effort(Claude Code 内部格式)
  if (body.output_config?.effort) {
    const e = String(body.output_config.effort).toLowerCase();
    const map = { low: 'low', medium: 'medium', high: 'high', max: 'xhigh', xhigh: 'xhigh', adaptive: 'xhigh' };
    return { effort: map[e] || 'medium', budget: null };
  }

  // 4. reasoning 对象(OpenRouter)
  if (body.reasoning && typeof body.reasoning === 'object' && body.reasoning.effort) {
    return { effort: String(body.reasoning.effort).toLowerCase(), budget: null };
  }

  // 5. enable_thinking 布尔
  if (body.enable_thinking === true) {
    return { effort: 'medium', budget: null };
  }

  return { effort: undefined, budget: null };
}

/**
 * 把归一化的 effort 转换为 Anthropic thinking 字段
 */
export function effortToAnthropicThinking(effort, maxTokens = 4096) {
  if (!effort) return undefined;
  const budgetMap = { low: 4000, medium: 8000, high: 16000, xhigh: Math.max(32000, maxTokens - 1) };
  const budget = Math.min(budgetMap[effort] || 8000, Math.max(1024, maxTokens - 1));
  return { type: 'enabled', budget_tokens: budget };
}

/**
 * 把归一化的 effort 转换为 Gemini thinkingConfig 字段
 */
export function effortToGeminiThinkingConfig(effort) {
  if (!effort) return undefined;
  const budgetMap = { low: 2048, medium: 8192, high: 16384, xhigh: 32768 };
  return { thinkingBudget: budgetMap[effort] || 8192 };
}

/**
 * 把归一化的 effort 转换为 OpenAI reasoning_effort 字段
 */
export function effortToOpenAIReasoning(effort) {
  if (!effort) return undefined;
  // OpenAI 不支持 xhigh,降级为 high
  return effort === 'xhigh' ? 'high' : effort;
}
