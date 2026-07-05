import { BaseProvider } from './base.js';
import { Readable } from 'stream';
import { normalizeReasoningEffort, effortToAnthropicThinking } from '../translate/reasoning.js';
import { stripImagesIfTextOnly, isTextOnlyModel } from '../translate/media.js';

/**
 * Anthropic Claude Provider —— 完整 OpenAI ↔ Anthropic 双向字段映射
 *
 * 映射表:
 *   请求方向 (OpenAI → Anthropic):
 *     tools[]                       → tools[] { name, description, input_schema }
 *     tool_choice                   → tool_choice { type: auto|any|tool, name? }
 *     messages[].tool_calls         → content[].tool_use { id, name, input }
 *     messages[].role='tool'        → user content[].tool_result { tool_use_id, content }
 *     reasoning_content             → content[].thinking { thinking, signature }
 *     reasoning_signature           → content[].thinking.signature
 *
 *   响应方向 (Anthropic → OpenAI):
 *     content[].tool_use            → message.tool_calls[]
 *     content[].thinking            → message.reasoning_content + reasoning_signature
 *     stop_reason='tool_use'        → finish_reason='tool_calls'
 *
 * signature 透传:Claude 3.7 Extended Thinking 多轮任务必须把 thinking.signature
 * 原样回传,否则 Claude 拒绝请求或重新思考。
 */
export class AnthropicProvider extends BaseProvider {
  getDefaultBaseUrl() {
    return 'https://api.anthropic.com';
  }

  _generateStableId() {
    return `chatcmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  _buildHeaders() {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01'
    };
  }

  /**
   * 把 OpenAI content (string | array) 转 Anthropic content blocks 数组
   */
  _toAnthropicContent(content) {
    if (typeof content === 'string') {
      return content ? [{ type: 'text', text: content }] : [];
    }
    if (Array.isArray(content)) {
      const blocks = [];
      for (const part of content) {
        if (part.type === 'text' || typeof part.text === 'string') {
          if (part.text) blocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'image_url') {
          const imageUrl = part.image_url?.url || part.image_url;
          if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
            const [mime, base64] = imageUrl.split(',');
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mime.split(':')[1].split(';')[0],
                data: base64
              }
            });
          }
        }
      }
      return blocks;
    }
    return [];
  }

  _buildRequestBody(messages, options = {}) {
    // ── Phase 1.4: 文本模型自动剥图
    const modelId = options.model || this.model;
    const strippedMessages = stripImagesIfTextOnly(messages, modelId, this._caps);

    let systemPrompt;
    const filteredMessages = [];

    for (const msg of strippedMessages) {
      if (msg.role === 'system') {
        let text = typeof msg.content === 'string'
          ? msg.content
          : this._toAnthropicContent(msg.content).map(b => b.text || '').join('');
        // ── Phase 1.2: 剥离动态前缀(Claude Code billing header 等,破坏 prefix cache)
        text = this._stripDynamicPrefix(text);
        if (text) systemPrompt = (systemPrompt ? systemPrompt + '\n' : '') + text;
        continue;
      }

      // ── OpenAI tool 角色响应 → Anthropic user.content[].tool_result
      if (msg.role === 'tool') {
        const toolResultContent = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content || {});
        // Anthropic 要求 tool_result 在 user 角色下
        // 合并连续的 tool 消息到同一个 user turn
        const lastMsg = filteredMessages[filteredMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content) &&
            lastMsg.content.some(b => b.type === 'tool_result')) {
          lastMsg.content.push({
            type: 'tool_result',
            tool_use_id: msg.tool_call_id || msg.name,
            content: toolResultContent
          });
        } else {
          filteredMessages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: msg.tool_call_id || msg.name,
              content: toolResultContent
            }]
          });
        }
        continue;
      }

      // ── assistant 消息(可能含 tool_calls / reasoning_content)
      if (msg.role === 'assistant') {
        const blocks = [];

        // 1. 透传思考链
        if (msg.reasoning_content) {
          const thinkingBlock = {
            type: 'thinking',
            thinking: msg.reasoning_content
          };
          if (msg.reasoning_signature) {
            thinkingBlock.signature = msg.reasoning_signature;
          }
          blocks.push(thinkingBlock);
        }

        // 2. 文本内容
        const textBlocks = this._toAnthropicContent(msg.content);
        blocks.push(...textBlocks);

        // 3. tool_calls → tool_use
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            if (!tc.function) continue;
            let input = {};
            try {
              input = JSON.parse(tc.function.arguments || '{}');
            } catch {
              input = { _raw: tc.function.arguments };
            }
            blocks.push({
              type: 'tool_use',
              id: tc.id || `toolu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
              name: tc.function.name,
              input
            });
          }
        }

        if (blocks.length > 0) {
          filteredMessages.push({ role: 'assistant', content: blocks });
        }
        continue;
      }

      // ── user 消息
      const userBlocks = this._toAnthropicContent(msg.content);
      if (userBlocks.length > 0) {
        // 合并连续 user 消息(Anthropic 要求严格交替)
        const lastMsg = filteredMessages[filteredMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          lastMsg.content.push(...userBlocks);
        } else {
          filteredMessages.push({ role: 'user', content: userBlocks });
        }
      }
    }

    // Anthropic 要求最后一条不能是 assistant(如果只回传了 assistant 文本会触发 400)
    // 安全兜底:如果最后是 assistant,补一条空 user
    if (filteredMessages.length > 0 &&
        filteredMessages[filteredMessages.length - 1].role === 'assistant') {
      // 不补充占位 user,因为客户端通常会带 tool_result 跟在后面
      // 仅当确实只有一条 assistant 时才补
      if (filteredMessages.length === 1) {
        filteredMessages.push({ role: 'user', content: [{ type: 'text', text: 'continue' }] });
      }
    }

    const body = {
      model: options.model || this.model,
      messages: filteredMessages,
      max_tokens: options.max_tokens || 4096,
      stream: options.stream || false
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.top_p !== undefined) body.top_p = options.top_p;
    if (options.stop) {
      body.stop_sequences = Array.isArray(options.stop) ? options.stop : [options.stop];
    }

    // ── tools (OpenAI tools[] → Anthropic tools[])
    if (Array.isArray(options.tools) && options.tools.length > 0) {
      const anthropicTools = [];
      for (const t of options.tools) {
        const fn = t.function || t;
        if (!fn.name) continue;
        anthropicTools.push({
          name: fn.name,
          description: fn.description || '',
          input_schema: fn.parameters || fn.input_schema || { type: 'object', properties: {} }
        });
      }
      if (anthropicTools.length > 0) {
        body.tools = anthropicTools;
      }
    }

    // ── tool_choice (OpenAI → Anthropic)
    if (options.tool_choice !== undefined && options.tool_choice !== null) {
      const tc = options.tool_choice;
      if (tc === 'auto') {
        body.tool_choice = { type: 'auto' };
      } else if (tc === 'required') {
        body.tool_choice = { type: 'any' };
      } else if (tc === 'none') {
        // Anthropic 没有 none,通过不传 tools 实现;此处忽略
      } else if (typeof tc === 'object' && tc.function?.name) {
        body.tool_choice = { type: 'tool', name: tc.function.name };
      }
    }

    // ── extended thinking(Claude 3.7+)
    // Phase 1.3: 用 reasoning_effort 归一化层
    const { effort } = normalizeReasoningEffort({
      thinking: options.thinking,
      reasoning_effort: options.reasoning_effort,
      output_config: options.output_config,
      reasoning: options.reasoning,
      enable_thinking: options.enable_thinking,
    });
    if (effort) {
      const thinkingConfig = effortToAnthropicThinking(effort, body.max_tokens);
      if (thinkingConfig) body.thinking = thinkingConfig;
    } else if (options.thinking && typeof options.thinking === 'object') {
      // 透传显式 thinking 对象(含 signature 透传场景)
      body.thinking = options.thinking;
    }

    // ── Phase 1.1: Prompt Cache 断点自动注入(4-断点预算)
    this._injectCacheControl(body);

    return body;
  }

  /**
   * Phase 1.2: 剥离动态前缀
   * Claude Code 注入的 `x-anthropic-billing-header: cch=xxx` 每次变化,
   * 会让 prefix cache 永远 miss。剥离后可显著提升缓存命中率。
   */
  _stripDynamicPrefix(text) {
    if (typeof text !== 'string' || !text) return text;
    // 已知动态前缀模式(可扩展)
    const patterns = [
      /^x-anthropic-billing-header:\s*[^\n]*\n/i,
      /^x-cc-switch-[a-z-]+:\s*[^\n]*\n/i,
    ];
    let result = text;
    for (const p of patterns) {
      result = result.replace(p, '');
    }
    return result;
  }

  /**
   * Phase 1.1: Prompt Cache 断点自动注入
   * Anthropic 限制最多 4 个 cache_control 断点
   * 注入顺序:tools 末尾 → system 末尾 → 最后 assistant 非 thinking block
   */
  _injectCacheControl(body, ttl = '5m') {
    if (!body || typeof body !== 'object') return body;

    // 统计已有断点数
    let existingCount = 0;
    const countExisting = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) countExisting(item);
      } else {
        if (obj.cache_control) existingCount++;
        for (const v of Object.values(obj)) countExisting(v);
      }
    };
    countExisting(body);
    const budget = 4 - existingCount;
    if (budget <= 0) return body;

    const cacheControl = ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
    let used = 0;

    // 1. tools 末尾
    if (used < budget && Array.isArray(body.tools) && body.tools.length > 0) {
      const lastTool = body.tools[body.tools.length - 1];
      if (!lastTool.cache_control) {
        lastTool.cache_control = { ...cacheControl };
        used++;
      }
    }

    // 2. system 末尾(字符串 → 数组化)
    if (used < budget && body.system) {
      if (typeof body.system === 'string') {
        body.system = [{ type: 'text', text: body.system }];
      }
      if (Array.isArray(body.system) && body.system.length > 0) {
        const lastSys = body.system[body.system.length - 1];
        if (!lastSys.cache_control) {
          lastSys.cache_control = { ...cacheControl };
          used++;
        }
      }
    }

    // 3. 最后 assistant 消息的最后一个非 thinking block
    if (used < budget && Array.isArray(body.messages) && body.messages.length > 0) {
      for (let i = body.messages.length - 1; i >= 0 && used < budget; i--) {
        const msg = body.messages[i];
        if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
        for (let j = msg.content.length - 1; j >= 0 && used < budget; j--) {
          const block = msg.content[j];
          if (!block || block.type === 'thinking' || block.type === 'redacted_thinking') continue;
          if (!block.cache_control) {
            block.cache_control = { ...cacheControl };
            used++;
            break; // 每条消息最多注入一个
          }
        }
      }
    }

    return body;
  }

  /**
   * 解析 Anthropic content blocks,提取 text / reasoning / signature / tool_calls
   */
  _extractFromContent(content) {
    let text = '';
    let reasoning = '';
    let reasoningSignature = null;
    const toolCalls = [];

    if (!Array.isArray(content)) return { text, reasoning, reasoningSignature, toolCalls };

    content.forEach((block, idx) => {
      if (!block || typeof block !== 'object') return;
      if (block.type === 'text' && block.text) {
        text += block.text;
      } else if (block.type === 'thinking' && block.thinking) {
        reasoning += block.thinking;
        if (block.signature) {
          reasoningSignature = reasoningSignature
            ? `${reasoningSignature}\n${block.signature}`
            : block.signature;
        }
      } else if (block.type === 'tool_use' && block.name) {
        toolCalls.push({
          id: block.id || `call_${idx}_${Date.now().toString(36)}`,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {})
          }
        });
      }
    });

    return { text, reasoning, reasoningSignature, toolCalls };
  }

  _finishReasonMap(stopReason, hasToolCalls) {
    if (hasToolCalls || stopReason === 'tool_use') return 'tool_calls';
    const sr = String(stopReason || '').toLowerCase();
    if (sr === 'end_turn' || sr === '') return 'stop';
    if (sr === 'max_tokens') return 'length';
    if (sr === 'stop_sequence') return 'stop';
    return sr;
  }

  _parseNonStreamResponse(data, stableId) {
    const { text, reasoning, reasoningSignature, toolCalls } = this._extractFromContent(data.content);

    const message = { role: 'assistant' };
    message.content = text || null;
    if (reasoning) {
      message.reasoning_content = reasoning;
      if (reasoningSignature) message.reasoning_signature = reasoningSignature;
    }
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
      if (!message.content) message.content = null;
    }

    return {
      id: data.id || stableId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model || this.model,
      choices: [{
        index: 0,
        message,
        finish_reason: this._finishReasonMap(data.stop_reason, toolCalls.length > 0)
      }],
      // Phase 2.1: 归一化 usage(含 cache_read / cache_creation 三桶)
      usage: this._normalizeUsage(data.usage, 'anthropic')
    };
  }

  _parseAnthropicSSE(buffer) {
    const events = [];
    const lines = buffer.split('\n');
    let currentEvent = 'message';
    let currentData = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
        try {
          events.push({ event: currentEvent, data: JSON.parse(currentData) });
        } catch {
        }
        currentEvent = 'message';
        currentData = '';
      }
    }
    return events;
  }

  async chatCompletion(messages, options = {}) {
    const body = this._buildRequestBody(messages, { ...options, stream: false });
    const stableId = this._generateStableId();

    const response = await this._request('/v1/messages', {
      method: 'POST',
      headers: this._buildHeaders(),
      body,
    });

    if (response.statusCode >= 400) {
      const errorBody = await this._readJSON(response);
      throw this._createError(response.statusCode, errorBody);
    }

    const data = await this._readJSON(response);
    return this._parseNonStreamResponse(data, stableId);
  }

  async chatCompletionStream(messages, options = {}) {
    const model = options.model || this.model;
    const body = this._buildRequestBody(messages, { ...options, stream: true });
    const STABLE_CHUNK_ID = this._generateStableId();

    const response = await this._streamRequest('/v1/messages', {
      method: 'POST',
      headers: { ...this._buildHeaders(), 'Accept': 'text/event-stream' },
      body,
    });

    if (response.statusCode >= 400) {
      const errorBody = await this._readJSON(response);
      throw this._createError(response.statusCode, errorBody);
    }

    const output = new Readable({ read() {} });
    let buffer = '';

    // 工具调用累积状态
    // content_block_start 给出 id+name,input_json_delta 给出 args 增量
    const toolUseBuffer = new Map(); // index -> { id, name, arguments }
    const reasoningSigBuffer = new Map(); // index -> signature
    let reasoningBuf = '';
    let lastStopReason = null;
    let ended = false;
    let hadToolCalls = false;
    // Phase 2.1: 流式 usage 累积(message_start 给 input+cache,message_delta 给 output)
    let streamUsage = null;

    const emit = (delta, finishReason = null) => {
      output.push(`data: ${JSON.stringify({
        id: STABLE_CHUNK_ID,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          delta,
          finish_reason: finishReason
        }]
      })}\n\n`);
    };

    const flushToolUse = (idx) => {
      const t = toolUseBuffer.get(idx);
      if (!t) return;
      toolUseBuffer.delete(idx);
      hadToolCalls = true;
      emit({
        tool_calls: [{
          index: idx,
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.arguments || '{}' }
        }]
      });
    };

    const flushReasoning = () => {
      if (!reasoningBuf) return;
      const sig = reasoningSigBuffer.size > 0
        ? Array.from(reasoningSigBuffer.values()).join('\n')
        : null;
      const delta = { reasoning_content: reasoningBuf };
      if (sig) delta.reasoning_signature = sig;
      emit(delta);
      reasoningBuf = '';
      reasoningSigBuffer.clear();
    };

    const handleEvent = (event) => {
      const { event: type, data } = event;

      // Phase 2.1: message_start 携带完整 input usage(含 cache_read / cache_creation)
      if (type === 'message_start' && data?.message?.usage) {
        streamUsage = { ...data.message.usage };
        return;
      }

      if (type === 'content_block_start' && data.content_block) {
        const cb = data.content_block;
        const idx = data.index ?? 0;
        if (cb.type === 'tool_use') {
          toolUseBuffer.set(idx, {
            id: cb.id || `call_${idx}_${Date.now().toString(36)}`,
            name: cb.name,
            arguments: ''
          });
        } else if (cb.type === 'thinking' && cb.signature) {
          reasoningSigBuffer.set(idx, cb.signature);
        }
        return;
      }

      if (type === 'content_block_delta' && data.delta) {
        const d = data.delta;
        const idx = data.index ?? 0;
        if (d.type === 'text_delta' && d.text) {
          emit({ content: d.text });
        } else if (d.type === 'thinking_delta' && d.thinking) {
          reasoningBuf += d.thinking;
        } else if (d.type === 'input_json_delta' && d.partial_json) {
          const t = toolUseBuffer.get(idx);
          if (t) t.arguments += d.partial_json;
        } else if (d.type === 'signature_delta' && d.signature) {
          // Claude 3.7 流式 signature 通过 signature_delta 推送
          const existing = reasoningSigBuffer.get(idx) || '';
          reasoningSigBuffer.set(idx, existing ? `${existing}\n${d.signature}` : d.signature);
        }
        return;
      }

      if (type === 'content_block_stop') {
        const idx = data.index ?? 0;
        if (toolUseBuffer.has(idx)) {
          flushToolUse(idx);
        }
        return;
      }

      if (type === 'message_delta' && data.delta) {
        if (data.delta.stop_reason) {
          lastStopReason = data.delta.stop_reason;
        }
        // Phase 2.1: message_delta 携带累计 output_tokens
        if (data.usage?.output_tokens !== undefined && streamUsage) {
          streamUsage.output_tokens = data.usage.output_tokens;
        }
        // 流末把剩余 reasoning 一次性吐出
        if (reasoningBuf || reasoningSigBuffer.size > 0) {
          flushReasoning();
        }
        return;
      }

      if (type === 'message_stop') {
        // finalize 会在 end 事件中触发
        return;
      }
    };

    const finalize = () => {
      if (ended) return;
      ended = true;

      // 兜底刷新
      flushReasoning();
      for (const idx of Array.from(toolUseBuffer.keys())) {
        flushToolUse(idx);
      }

      const finishReason = this._finishReasonMap(lastStopReason, hadToolCalls);
      emit({}, finishReason);

      // Phase 2.1: 流末推送归一化 usage chunk(OpenAI 流式 usage 格式:choices=[])
      if (streamUsage) {
        const normalizedUsage = this._normalizeUsage(streamUsage, 'anthropic');
        output.push(`data: ${JSON.stringify({
          id: STABLE_CHUNK_ID,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [],
          usage: normalizedUsage
        })}\n\n`);
      }

      output.push('data: [DONE]\n\n');
      output.push(null);
    };

    response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.lastIndexOf('\n\n');
      if (newlineIndex === -1) return;

      const toProcess = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 2);

      const events = this._parseAnthropicSSE(toProcess + '\n\n');
      for (const event of events) {
        handleEvent(event);
      }
    });

    response.body.on('end', () => {
      if (buffer.trim()) {
        const events = this._parseAnthropicSSE(buffer + '\n\n');
        for (const event of events) {
          handleEvent(event);
        }
      }
      finalize();
    });

    response.body.on('error', (err) => {
      output.destroy(err);
    });

    return output;
  }
}
