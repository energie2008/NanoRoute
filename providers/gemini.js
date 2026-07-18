import { BaseProvider } from './base.js';
import { Readable } from 'stream';
import { normalizeReasoningEffort, effortToGeminiThinkingConfig } from '../translate/reasoning.js';
import { stripImagesIfTextOnly } from '../translate/media.js';

/**
 * Gemini Provider —— 完整 OpenAI ↔ Gemini 双向字段映射
 *
 * 映射表:
 *   请求方向 (OpenAI → Gemini):
 *     tools[]                       → tools[].functionDeclarations[]
 *     tool_choice                   → toolConfig.functionCallingConfig
 *     messages[].tool_calls         → contents[].parts[].functionCall   (role=model)
 *     messages[].role='tool'        → contents[].parts[].functionResponse (role=user)
 *     reasoning_content             → parts[].thought=true + text
 *     reasoning_signature           → parts[].thoughtSignature
 *
 *   响应方向 (Gemini → OpenAI):
 *     parts[].functionCall          → message.tool_calls[]
 *     parts[].thought=true + text   → message.reasoning_content
 *     parts[].thoughtSignature      → message.reasoning_signature (透传,多轮必需)
 *     finishReason=STOP+tool_calls  → finish_reason='tool_calls'
 *
 * signature 透传:多轮 Agent 任务中,客户端必须把 reasoning_signature 原样回传,
 * 否则 Gemini 2.5 Thinking 会强制重新思考(浪费 token/触发 400)。
 */
export class GeminiProvider extends BaseProvider {
  getDefaultBaseUrl() {
    return 'https://generativelanguage.googleapis.com';
  }

  _buildUrl(model, stream = false) {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    // alt=sse 仅用于流式;非流式若带 alt=sse 会返回 SSE 格式,导致 JSON 解析失败
    const altParam = stream ? '&alt=sse' : '';
    return `/v1beta/models/${model}:${action}?key=${this.apiKey}${altParam}`;
  }

  _generateStableId() {
    return `chatcmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 把 OpenAI 消息内容统一成 Gemini parts(可能含 text / functionCall / functionResponse / thought)
   */
  _contentToParts(content) {
    if (typeof content === 'string') {
      return content ? [{ text: content }] : [];
    }
    if (Array.isArray(content)) {
      const parts = [];
      for (const part of content) {
        if (part.type === 'text' || typeof part.text === 'string') {
          if (part.text) parts.push({ text: part.text });
        } else if (part.type === 'image_url') {
          const imageUrl = part.image_url?.url || part.image_url;
          if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
            const [mime, base64] = imageUrl.split(',');
            parts.push({
              inlineData: {
                mimeType: mime.split(':')[1].split(';')[0],
                data: base64
              }
            });
          } else if (imageUrl) {
            parts.push({ fileData: { fileUri: imageUrl } });
          }
        }
      }
      return parts;
    }
    return [];
  }

  _buildRequestBody(messages, options = {}) {
    // ── Phase 1.4: 文本模型自动剥图
    const modelId = options.model || this.model;
    messages = stripImagesIfTextOnly(messages, modelId, this._caps);

    const contents = [];
    let systemInstruction;

    for (const msg of messages) {
      if (msg.role === 'system') {
        const sysText = typeof msg.content === 'string'
          ? msg.content
          : this._contentToParts(msg.content).map(p => p.text || '').join('');
        if (sysText) systemInstruction = { parts: [{ text: sysText }] };
        continue;
      }

      // ── OpenAI tool 角色响应 → Gemini functionResponse (role=user)
      if (msg.role === 'tool') {
        let respContent;
        try {
          respContent = typeof msg.content === 'string'
            ? JSON.parse(msg.content || '{}')
            : (msg.content || {});
        } catch {
          respContent = { _raw: String(msg.content || '') };
        }
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.name || msg.tool_call_id || 'unknown',
              response: respContent
            }
          }]
        });
        continue;
      }

      // ── assistant 消息(可能含 tool_calls / reasoning_content)
      if (msg.role === 'assistant') {
        const parts = [];

        // 1. 透传思考链(thought + signature)
        if (msg.reasoning_content) {
          const thoughtPart = { thought: true, text: msg.reasoning_content };
          if (msg.reasoning_signature) {
            thoughtPart.thoughtSignature = msg.reasoning_signature;
          }
          parts.push(thoughtPart);
        }

        // 2. 文本内容
        const textParts = this._contentToParts(msg.content);
        parts.push(...textParts);

        // 3. tool_calls → functionCall
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            if (!tc.function) continue;
            let args = {};
            try {
              args = JSON.parse(tc.function.arguments || '{}');
            } catch {
              args = { _raw: tc.function.arguments };
            }
            const fcPart = {
              functionCall: {
                name: tc.function.name,
                args
              }
            };
            // 回传 functionCall 关联的 thoughtSignature(Gemini thinking 模型多轮必需)
            if (tc.thought_signature) {
              fcPart.thoughtSignature = tc.thought_signature;
            }
            parts.push(fcPart);
          }
        }

        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
        continue;
      }

      // ── user 消息
      const userParts = this._contentToParts(msg.content);
      if (userParts.length > 0) {
        contents.push({ role: 'user', parts: userParts });
      }
    }

    const body = { contents };
    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    // ── generationConfig
    const generationConfig = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.max_tokens !== undefined) generationConfig.maxOutputTokens = options.max_tokens;
    if (options.top_p !== undefined) generationConfig.topP = options.top_p;
    if (options.top_k !== undefined) generationConfig.topK = options.top_k;
    if (options.stop) {
      generationConfig.stopSequences = Array.isArray(options.stop) ? options.stop : [options.stop];
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    // ── Phase 1.3: thinking 配置(Gemini 2.5+ thinkingConfig)
    const { effort: geminiEffort } = normalizeReasoningEffort({
      thinking: options.thinking,
      reasoning_effort: options.reasoning_effort,
      output_config: options.output_config,
      reasoning: options.reasoning,
      enable_thinking: options.enable_thinking,
    });
    if (geminiEffort) {
      const thinkingConfig = effortToGeminiThinkingConfig(geminiEffort);
      if (thinkingConfig) {
        if (!body.generationConfig) body.generationConfig = {};
        body.generationConfig.thinkingConfig = thinkingConfig;
      }
    }

    // ── tools (OpenAI tools[] → Gemini functionDeclarations[])
    if (Array.isArray(options.tools) && options.tools.length > 0) {
      const functionDeclarations = [];
      for (const t of options.tools) {
        if (t.type === 'function' && t.function) {
          functionDeclarations.push({
            name: t.function.name,
            description: t.function.description || '',
            parameters: t.function.parameters || { type: 'object', properties: {} }
          });
        } else if (t.function) {
          // 兼容未带 type 字段的写法
          functionDeclarations.push({
            name: t.function.name,
            description: t.function.description || '',
            parameters: t.function.parameters || { type: 'object', properties: {} }
          });
        }
      }
      if (functionDeclarations.length > 0) {
        body.tools = [{ functionDeclarations }];
      }
    }

    // ── tool_choice (OpenAI → Gemini toolConfig)
    if (options.tool_choice !== undefined && options.tool_choice !== null) {
      const tc = options.tool_choice;
      const config = { functionCallingConfig: { mode: 'AUTO' } };
      if (tc === 'none') {
        // Gemini 没有 NONE,通过不传 tools 实现;此处保留 config 但模式 AUTO
        config.functionCallingConfig.mode = 'AUTO';
      } else if (tc === 'required') {
        config.functionCallingConfig.mode = 'ANY';
      } else if (tc === 'auto') {
        config.functionCallingConfig.mode = 'AUTO';
      } else if (typeof tc === 'object' && tc.function?.name) {
        config.functionCallingConfig.mode = 'ANY';
        config.functionCallingConfig.allowedFunctionNames = [tc.function.name];
      }
      body.toolConfig = config;
    }

    return body;
  }

  /**
   * 解析 Gemini parts,提取 text / reasoning_content / reasoning_signature / tool_calls
   */
  _extractFromParts(parts) {
    let text = '';
    let reasoning = '';
    let reasoningSignature = null;
    const toolCalls = [];

    if (!Array.isArray(parts)) return { text, reasoning, reasoningSignature, toolCalls };

    parts.forEach((p, idx) => {
      if (!p || typeof p !== 'object') return;

      // 思考链(Gemini 2.5 Thinking)
      if (p.thought === true && p.text) {
        reasoning += p.text;
        if (p.thoughtSignature) {
          // 多个 thought part 可能有多个 signature,合并保存
          reasoningSignature = reasoningSignature
            ? `${reasoningSignature}\n${p.thoughtSignature}`
            : p.thoughtSignature;
        }
        return;
      }

      // 普通文本
      if (p.text) {
        text += p.text;
      }

      // function call → tool_call
      if (p.functionCall && p.functionCall.name) {
        const tc = {
          id: `call_${idx}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          type: 'function',
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args || {})
          }
        };
        // Gemini thinking 模型:functionCall part 可能带 thoughtSignature
        // 多轮回传时必须携带,否则 Gemini API 返回 400
        if (p.thoughtSignature) {
          tc.thought_signature = p.thoughtSignature;
        }
        toolCalls.push(tc);
      }
    });

    return { text, reasoning, reasoningSignature, toolCalls };
  }

  _finishReasonMap(finishReason, hasToolCalls) {
    if (hasToolCalls) return 'tool_calls';
    const fr = String(finishReason || '').toUpperCase();
    if (fr === 'STOP' || fr === '') return 'stop';
    if (fr === 'MAX_TOKENS') return 'length';
    if (fr === 'SAFETY' || fr === 'RECITATION') return 'content_filter';
    return fr.toLowerCase();
  }

  _parseNonStreamResponse(data, stableId) {
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No candidates in response');
    }
    const candidate = data.candidates[0];
    const parts = candidate.content?.parts || [];
    const { text, reasoning, reasoningSignature, toolCalls } = this._extractFromParts(parts);

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

    // Phase 2.1: 归一化 usage(Gemini usageMetadata → 统一三桶格式)
    const usage = this._normalizeUsage(data.usageMetadata, 'gemini');

    return {
      id: stableId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [{
        index: 0,
        message,
        finish_reason: this._finishReasonMap(candidate.finishReason, toolCalls.length > 0)
      }],
      usage
    };
  }

  async chatCompletion(messages, options = {}) {
    const model = options.model || this.model;
    const body = this._buildRequestBody(messages, options);
    const stableId = this._generateStableId();

    const response = await this._request(this._buildUrl(model, false), {
      method: 'POST',
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
    const body = this._buildRequestBody(messages, options);
    const STABLE_CHUNK_ID = this._generateStableId();

    const response = await this._streamRequest(this._buildUrl(model, true), {
      method: 'POST',
      body,
    });

    if (response.statusCode >= 400) {
      const errorBody = await this._readJSON(response);
      throw this._createError(response.statusCode, errorBody);
    }

    const output = new Readable({ read() {} });
    let buffer = '';

    // 跟踪 tool_call 累积(流式 functionCall 一次性返回,但 args 可能分块)
    const toolCallBuffer = new Map();
    let reasoningBuf = '';
    let reasoningSigBuf = '';
    let lastFinishReason = null;
    let ended = false;
    let hadToolCallsInStream = false; // 用于 finalize 决定 finish_reason
    // Phase 2.1: 流式 usage 累积(Gemini 在最后一个 chunk 携带 usageMetadata)
    let streamUsage = null;

    const flushToolCalls = () => {
      if (toolCallBuffer.size === 0) return null;
      const calls = Array.from(toolCallBuffer.values());
      toolCallBuffer.clear();
      hadToolCallsInStream = true;
      return {
        id: STABLE_CHUNK_ID,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          delta: { tool_calls: calls },
          finish_reason: null
        }]
      };
    };

    const flushReasoning = () => {
      if (!reasoningBuf) return null;
      const chunk = {
        id: STABLE_CHUNK_ID,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          delta: { reasoning_content: reasoningBuf },
          finish_reason: null
        }]
      };
      reasoningBuf = '';
      return chunk;
    };

    const handleData = (chunk_data) => {
      // Phase 2.1: 捕获 usageMetadata(通常在最后一个 chunk)
      if (chunk_data.usageMetadata) {
        streamUsage = chunk_data.usageMetadata;
      }
      if (!chunk_data.candidates || !chunk_data.candidates[0]) return;
      const candidate = chunk_data.candidates[0];
      const parts = candidate.content?.parts || [];
      let textDelta = '';

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i] || {};
        if (p.thought === true && p.text) {
          reasoningBuf += p.text;
          if (p.thoughtSignature) {
            reasoningSigBuf = reasoningSigBuf
              ? `${reasoningSigBuf}\n${p.thoughtSignature}`
              : p.thoughtSignature;
          }
        } else if (p.text) {
          textDelta += p.text;
        }
        if (p.functionCall && p.functionCall.name) {
          // 流式中 functionCall 通常一次性完整返回,但用 index 聚合保险
          const idx = i;
          if (!toolCallBuffer.has(idx)) {
            toolCallBuffer.set(idx, {
              index: idx,
              id: `call_${idx}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
              type: 'function',
              function: { name: p.functionCall.name, arguments: '' }
            });
          }
          const existing = toolCallBuffer.get(idx);
          if (p.functionCall.args) {
            existing.function.arguments = JSON.stringify(p.functionCall.args);
          }
          // Gemini thinking 模型:functionCall part 可能带 thoughtSignature
          if (p.thoughtSignature) {
            existing.thought_signature = p.thoughtSignature;
          }
        }
      }

      if (candidate.finishReason) {
        lastFinishReason = candidate.finishReason;
      }

      // 先吐 reasoning
      const rChunk = flushReasoning();
      if (rChunk) output.push(`data: ${JSON.stringify(rChunk)}\n\n`);

      // 再吐 tool_calls
      const tcChunk = flushToolCalls();
      if (tcChunk) output.push(`data: ${JSON.stringify(tcChunk)}\n\n`);

      // 最后吐文本
      if (textDelta) {
        output.push(`data: ${JSON.stringify({
          id: STABLE_CHUNK_ID,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{
            index: 0,
            delta: { content: textDelta },
            finish_reason: null
          }]
        })}\n\n`);
      }
    };

    const finalize = () => {
      if (ended) return;
      ended = true;

      // 兜底刷新缓冲
      const rChunk = flushReasoning();
      if (rChunk) output.push(`data: ${JSON.stringify(rChunk)}\n\n`);
      const tcChunk = flushToolCalls();
      if (tcChunk) output.push(`data: ${JSON.stringify(tcChunk)}\n\n`);

      // 推送 finish_reason(根据是否出现过 tool_calls 决定)
      // 注意:Gemini 的 lastFinishReason 在最后一个 chunk 才出现
      const finishReason = this._finishReasonMap(lastFinishReason, hadToolCallsInStream);
      output.push(`data: ${JSON.stringify({
        id: STABLE_CHUNK_ID,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: finishReason
        }]
      })}\n\n`);

      // Phase 2.1: 流末推送归一化 usage chunk
      if (streamUsage) {
        const normalizedUsage = this._normalizeUsage(streamUsage, 'gemini');
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

      const events = this._parseSSEChunk(toProcess + '\n\n');
      for (const event of events) {
        if (event.done) {
          finalize();
          return;
        }
        if (event.data) {
          handleData(event.data);
        }
      }
    });

    response.body.on('end', () => {
      if (buffer.trim()) {
        const events = this._parseSSEChunk(buffer + '\n');
        for (const event of events) {
          if (event.data) {
            handleData(event.data);
          }
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
