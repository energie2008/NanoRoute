import { BaseProvider } from './base.js';
import { Readable } from 'stream';

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
    const body = {
      model: options.model || this.model,
      messages,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.max_tokens !== undefined && { max_tokens: options.max_tokens }),
      ...(options.top_p !== undefined && { top_p: options.top_p }),
      stream: !!options.stream,

      ...(options.tools?.length && { tools: options.tools }),
      ...(options.tool_choice && { tool_choice: options.tool_choice }),
      ...(options.parallel_tool_calls !== undefined && { parallel_tool_calls: options.parallel_tool_calls }),
      ...(options.reasoning && { reasoning: options.reasoning }),
      ...(options.logprobs && { logprobs: options.logprobs }),
      ...(options.top_logprobs && { top_logprobs: options.top_logprobs }),
      ...(options.stream_options && { stream_options: options.stream_options }),
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
