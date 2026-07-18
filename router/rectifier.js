/**
 * 反应式整流器注册表(Reactive Rectifier Registry)
 *
 * 检测上游 thinking signature / budget 相关错误,
 * 自动修复请求体并允许重试,避免多轮 agent 任务中断。
 *
 * 参考 cc-switch thinking_rectifier.rs / thinking_budget_rectifier.rs
 *
 * 使用方式:
 *   const rectifier = getRectifier();
 *   const fix = rectifier.tryRectify(errorMessage, requestBody);
 *   if (fix.rectified) {
 *     // 用 fix.body 重试
 *   }
 */

// ── Signature 错误模式(7 种,来自 cc-switch 实测) ──
const SIGNATURE_ERROR_PATTERNS = [
  /invalid.*signature/i,
  /signature.*invalid/i,
  /signature.*required/i,
  /signature field is required/i,
  /thinking.*signature/i,
  /thought_signature/i,                        // Gemini: "missing a thought_signature"
  /Function call is missing.*thought_signature/i,
  /must start with (a )?thinking/i,
  /expected thinking.*found/i,
  /cannot be modified/i,
  /extra inputs not permitted/i,
];

// ── Budget 错误模式 ──
const BUDGET_ERROR_PATTERNS = [
  /budget_tokens.*(?:too (?:large|small)|exceed|invalid)/i,
  /budget.*(?:\+|plus).*(?:1024|max_tokens)/i,
  /thinking.*budget.*invalid/i,
  /max_tokens.*budget/i,
];

// ── 媒体错误模式(用于二次剥图重试) ──
const MEDIA_ERROR_PATTERNS = [
  /image.*(not supported|unsupported)/i,
  /vision.*(not supported|unsupported)/i,
  /multimodal/i,
  /text-?only/i,
  /media.*(not supported|unsupported)/i,
  /modality/i,
];

/**
 * 移除 body 中所有 thinking block / signature 字段
 * 用于 signature 错误的修复
 */
function stripThinkingBlocks(body) {
  if (!body || typeof body !== 'object') return body;
  const newBody = { ...body };

  // 移除顶层 thinking 字段
  delete newBody.thinking;
  // 移除顶层 reasoning_effort(避免重新触发 thinking)
  delete newBody.reasoning_effort;

  // 移除 messages 中的 thinking blocks / reasoning_content / tool_calls.thought_signature
  if (Array.isArray(newBody.messages)) {
    newBody.messages = newBody.messages.map(msg => {
      if (!msg || typeof msg !== 'object') return msg;
      const newMsg = { ...msg };

      // 剥离 reasoning_content / reasoning_signature(对应 Gemini thought parts / Anthropic thinking blocks)
      // Gemini thinking 模型要求 functionCall 携带 thoughtSignature,客户端不回传时剥离 thought 信号让模型重新思考
      delete newMsg.reasoning_content;
      delete newMsg.reasoning_signature;

      // 剥离 tool_calls 的 thought_signature(Gemini functionCall 关联的 signature)
      if (Array.isArray(newMsg.tool_calls)) {
        newMsg.tool_calls = newMsg.tool_calls.map(tc => {
          if (!tc || typeof tc !== 'object') return tc;
          const { thought_signature, ...rest } = tc;
          return rest;
        });
      }

      // 过滤 content 数组中的 thinking blocks(Anthropic 风格)
      if (Array.isArray(newMsg.content)) {
        const newContent = newMsg.content.filter(block =>
          !(block && (block.type === 'thinking' || block.type === 'redacted_thinking'))
        ).map(block => {
          // 移除非 thinking block 上的 signature 字段
          if (block && typeof block === 'object' && 'signature' in block) {
            const { signature, ...rest } = block;
            return rest;
          }
          return block;
        });

        // 如果 content 为空,保留至少一个 text block
        if (newContent.length === 0) {
          newMsg.content = [{ type: 'text', text: '' }];
        } else {
          newMsg.content = newContent;
        }
      }

      return newMsg;
    });
  }

  // Anthropic 风格:移除 contents 中的 thought parts(Gemini)
  if (Array.isArray(newBody.contents)) {
    newBody.contents = newBody.contents.map(c => {
      if (!c || !Array.isArray(c.parts)) return c;
      const newParts = c.parts.filter(p =>
        !(p && p.thought === true)
      ).map(p => {
        if (p && 'thoughtSignature' in p) {
          const { thoughtSignature, ...rest } = p;
          return rest;
        }
        return p;
      });
      return { ...c, parts: newParts };
    });
  }

  return newBody;
}

/**
 * 修复 thinking budget 错误
 * 设置为保守的安全值
 */
function fixBudgetError(body) {
  if (!body || typeof body !== 'object') return body;
  const newBody = { ...body };

  // 设置保守的 max_tokens 与 budget
  const safeMaxTokens = 64000;
  const safeBudget = 32000;

  if (newBody.max_tokens && newBody.max_tokens < safeMaxTokens) {
    newBody.max_tokens = safeMaxTokens;
  }

  if (newBody.thinking && typeof newBody.thinking === 'object') {
    newBody.thinking = {
      type: 'enabled',
      budget_tokens: Math.min(safeBudget, newBody.max_tokens - 1024)
    };
  } else {
    newBody.thinking = { type: 'enabled', budget_tokens: safeBudget };
  }

  return newBody;
}

/**
 * 二次剥图(用于媒体错误)
 */
function stripAllImages(body) {
  if (!body || typeof body !== 'object') return body;
  const newBody = { ...body };

  if (Array.isArray(newBody.messages)) {
    newBody.messages = newBody.messages.map(msg => {
      if (!msg || typeof msg !== 'object') return msg;
      if (!Array.isArray(msg.content)) return msg;

      const newContent = msg.content.map(block => {
        if (!block || typeof block !== 'object') return block;
        if (block.type === 'image_url' || block.type === 'image' ||
            block.type === 'input_image' || block.type === 'input_file') {
          const replacement = { type: 'text', text: '[Image removed: model does not support vision]' };
          if (block.cache_control) replacement.cache_control = block.cache_control;
          return replacement;
        }
        return block;
      });
      return { ...msg, content: newContent };
    });
  }

  // Gemini 风格:剥除 inlineData / fileData
  if (Array.isArray(newBody.contents)) {
    newBody.contents = newBody.contents.map(c => {
      if (!c || !Array.isArray(c.parts)) return c;
      const newParts = c.parts.map(p => {
        if (!p) return p;
        if (p.inlineData || p.fileData) {
          return { text: '[Image removed: model does not support vision]' };
        }
        return p;
      });
      return { ...c, parts: newParts };
    });
  }

  return newBody;
}

class RectifierRegistry {
  constructor() {
    this.rectifiers = [
      {
        name: 'signature',
        patterns: SIGNATURE_ERROR_PATTERNS,
        rectify: stripThinkingBlocks,
      },
      {
        name: 'budget',
        patterns: BUDGET_ERROR_PATTERNS,
        rectify: fixBudgetError,
      },
      {
        name: 'media',
        patterns: MEDIA_ERROR_PATTERNS,
        rectify: stripAllImages,
      },
    ];
    this._appliedCount = new Map();
  }

  /**
   * 尝试整流
   * @param {string} errorMessage 上游错误消息
   * @param {object} requestBody 原始请求体
   * @returns {{ rectified: boolean, body: object, rectifierName: string|null }}
   */
  tryRectify(errorMessage, requestBody) {
    const msg = String(errorMessage || '');

    for (const r of this.rectifiers) {
      if (r.patterns.some(p => p.test(msg))) {
        const newBody = r.rectify(requestBody);
        // 模式匹配即视为整流生效,即使 body 看似无变化
        // (客户端可能未回传 reasoning_content/thought_signature,messages 表面无变化,
        //  但 signature 错误仍需通过清理 localOptions.thinking/reasoning_effort 来禁用 thinkingConfig)
        this._appliedCount.set(r.name, (this._appliedCount.get(r.name) || 0) + 1);
        return { rectified: true, body: newBody, rectifierName: r.name };
      }
    }

    return { rectified: false, body: requestBody, rectifierName: null };
  }

  getStats() {
    const stats = {};
    for (const r of this.rectifiers) {
      stats[r.name] = this._appliedCount.get(r.name) || 0;
    }
    return stats;
  }
}

let _instance = null;

export function getRectifier() {
  if (!_instance) {
    _instance = new RectifierRegistry();
  }
  return _instance;
}

export function resetRectifier() {
  _instance = null;
}
