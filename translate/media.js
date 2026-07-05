/**
 * 媒体内容清理层
 *
 * 对文本模型自动剥图(替换为 [Unsupported Image] 标记),
 * 避免 400/415 错误浪费 quota。
 *
 * 策略(参考 cc-switch media_sanitizer.rs):
 *   - 声明驱动:capabilities 包含 'text-only' 时剥图
 *   - 启发式:已知 text-only 模型列表(deepseek/glm/mimo/qwen3-coder 等)
 *   - cache_control 迁移:剥图时保留 cache_control 到 text block
 */

// 已知文本模型(无视觉能力)
const TEXT_ONLY_MODEL_PATTERNS = [
  /deepseek/i,
  /glm-?(4(\.?[0-9])?|coder)/i,
  /mimo/i,
  /qwen-?3-?coder/i,
  /qwen-?coder/i,
  /reasoner/i,
  /o1|o3/i,
  /embed/i,
];

/**
 * 判断模型是否为文本模型(无视觉)
 * @param {string} modelId
 * @param {string[]} caps capabilities 数组
 */
export function isTextOnlyModel(modelId, caps = []) {
  // 显式声明优先
  if (Array.isArray(caps) && caps.includes('text-only')) return true;
  if (Array.isArray(caps) && caps.includes('vision')) return false;
  // 启发式
  const id = String(modelId || '').toLowerCase();
  return TEXT_ONLY_MODEL_PATTERNS.some(p => p.test(id));
}

/**
 * 把 image_url/image block 替换为 text 占位
 * 保留 cache_control 迁移(Anthropic 风格)
 */
function replaceImageBlock(block) {
  const replacement = { type: 'text', text: '[Unsupported Image]' };
  if (block.cache_control) {
    replacement.cache_control = block.cache_control;
  }
  return replacement;
}

/**
 * 剥除 OpenAI 风格 messages 中的图片
 * @param {Array} messages OpenAI messages 数组
 * @returns {Array} 新的 messages 数组(不修改原数组)
 */
export function stripImagesFromMessages(messages) {
  if (!Array.isArray(messages)) return messages;

  return messages.map(msg => {
    if (!msg || typeof msg !== 'object') return msg;

    // string content 直接返回
    if (typeof msg.content === 'string') return msg;

    // 数组 content:过滤 image_url
    if (Array.isArray(msg.content)) {
      const newContent = msg.content.map(part => {
        if (!part || typeof part !== 'object') return part;
        if (part.type === 'image_url' || part.type === 'image') {
          return replaceImageBlock(part);
        }
        // 递归处理 tool_result 内嵌 content(Anthropic 风格)
        if (part.type === 'tool_result' && Array.isArray(part.content)) {
          return {
            ...part,
            content: part.content.map(c =>
              (c.type === 'image' || c.type === 'image_url') ? replaceImageBlock(c) : c
            )
          };
        }
        return part;
      });
      return { ...msg, content: newContent };
    }

    return msg;
  });
}

/**
 * 如果目标模型是文本模型,剥除 messages 中的图片
 * @param {Array} messages
 * @param {string} modelId
 * @param {string[]} caps
 * @returns {Array}
 */
export function stripImagesIfTextOnly(messages, modelId, caps = []) {
  if (isTextOnlyModel(modelId, caps)) {
    return stripImagesFromMessages(messages);
  }
  return messages;
}
