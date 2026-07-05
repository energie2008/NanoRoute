import { BaseProvider } from './base.js';
import { Readable } from 'stream';
import { normalizeReasoningEffort, effortToOpenAIReasoning } from '../translate/reasoning.js';
import { stripImagesIfTextOnly } from '../translate/media.js';

export class OpenAIProvider extends BaseProvider {
  getDefaultBaseUrl() {
    return 'https://api.openai.com';
  }

  _buildHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  _buildRequestBody(messages, options = {}) {
    // ── Phase 1.4: 文本模型自动剥图
    const modelId = options.model || this.model;
    messages = stripImagesIfTextOnly(messages, modelId, this._caps);

    // ── Phase 2.1: 流式请求强制注入 stream_options.include_usage
    const isStream = !!options.stream;
    let streamOptions = options.stream_options;
    if (isStream && !streamOptions) {
      streamOptions = { include_usage: true };
    } else if (isStream && streamOptions && streamOptions.include_usage === undefined) {
      streamOptions = { ...streamOptions, include_usage: true };
    }

    // ── Phase 1.3: reasoning_effort 归一化
    const { effort } = normalizeReasoningEffort({
      thinking: options.thinking,
      reasoning_effort: options.reasoning_effort,
      output_config: options.output_config,
      reasoning: options.reasoning,
      enable_thinking: options.enable_thinking,
    });
    const normalizedEffort = effortToOpenAIReasoning(effort);

    const body = {
      model: options.model || this.model,
      messages,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.max_tokens !== undefined && { max_tokens: options.max_tokens }),
      ...(options.top_p !== undefined && { top_p: options.top_p }),
      stream: isStream,

      ...(options.tools?.length && { tools: options.tools }),
      ...(options.tool_choice && { tool_choice: options.tool_choice }),
      ...(options.parallel_tool_calls !== undefined && { parallel_tool_calls: options.parallel_tool_calls }),
      ...(normalizedEffort && { reasoning_effort: normalizedEffort }),
      ...(options.reasoning && { reasoning: options.reasoning }),
      ...(options.logprobs && { logprobs: options.logprobs }),
      ...(options.top_logprobs && { top_logprobs: options.top_logprobs }),
      ...(streamOptions && { stream_options: streamOptions }),
      ...(options.response_format && { response_format: options.response_format }),
      ...(options.metadata && { metadata: options.metadata }),
      ...(options.store !== undefined && { store: options.store }),
      ...(options.previous_response_id && { previous_response_id: options.previous_response_id }),
    };
    return body;
  }

  async chatCompletion(messages, options = {}) {
    const body = this._buildRequestBody(messages, { ...options, stream: false });

    const response = await this._request('/v1/chat/completions', {
      method: 'POST',
      headers: this._buildHeaders(),
      body,
    });

    if (response.statusCode >= 400) {
      const errorBody = await this._readJSON(response);
      throw this._createError(response.statusCode, errorBody);
    }

    const data = await this._readJSON(response);
    // Phase 2.1: 归一化 usage(补 cache_read_tokens 等)
    if (data && data.usage) {
      data.usage = this._normalizeUsage(data.usage, 'openai');
    }
    return data;
  }

  async chatCompletionStream(messages, options = {}) {
    const model = options.model || this.model;
    const body = this._buildRequestBody(messages, { ...options, stream: true });

    const response = await this._streamRequest('/v1/chat/completions', {
      method: 'POST',
      headers: this._buildHeaders(),
      body,
    });

    if (response.statusCode >= 400) {
      const errorBody = await this._readJSON(response);
      throw this._createError(response.statusCode, errorBody);
    }

    const output = new Readable({ read() {} });
    let buffer = '';

    // Phase 2.1: 流式 usage chunk 归一化(OpenAI usage chunk 的 choices=[], 带 usage 字段)
    const normalizeEvent = (event) => {
      if (event.data && event.data.usage) {
        event.data.usage = this._normalizeUsage(event.data.usage, 'openai');
      }
      return event;
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
          output.push('data: [DONE]\n\n');
          output.push(null);
          return;
        }
        if (event.data) {
          normalizeEvent(event);
          output.push(`data: ${JSON.stringify(event.data)}\n\n`);
        }
      }
    });

    response.body.on('end', () => {
      if (buffer.trim()) {
        const events = this._parseSSEChunk(buffer + '\n\n');
        for (const event of events) {
          if (event.done) {
            output.push('data: [DONE]\n\n');
            output.push(null);
            return;
          }
          if (event.data) {
            normalizeEvent(event);
            output.push(`data: ${JSON.stringify(event.data)}\n\n`);
          }
        }
      }
      output.push('data: [DONE]\n\n');
      output.push(null);
    });

    response.body.on('error', (err) => {
      output.destroy(err);
    });

    return output;
  }
}
