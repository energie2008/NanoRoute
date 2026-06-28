import { BaseProvider } from './base.js';
import { Readable } from 'stream';

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

  _buildRequestBody(messages, options = {}) {
    let systemPrompt;
    const filteredMessages = [];
    
    const extractText = (content) => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .filter(part => part.type === 'text' || typeof part.text === 'string')
          .map(part => part.text || '')
          .join('');
      }
      return String(content || '');
    };
    
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = extractText(msg.content);
      } else {
        filteredMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: extractText(msg.content)
        });
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

    return body;
  }

  _parseNonStreamResponse(data, stableId) {
    const content = data.content?.map(c => c.text || '').join('') || '';
    return {
      id: data.id || stableId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model || this.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: (data.stop_reason || 'end_turn').toLowerCase() === 'end_turn' ? 'stop' : data.stop_reason
      }],
      usage: {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
      }
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

    response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.lastIndexOf('\n\n');
      if (newlineIndex === -1) return;

      const toProcess = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 2);

      const events = this._parseAnthropicSSE(toProcess + '\n\n');
      for (const event of events) {
        if (event.event === 'content_block_delta' && event.data.delta?.text) {
          output.push(`data: ${JSON.stringify({
            id: STABLE_CHUNK_ID,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
              index: 0,
              delta: { content: event.data.delta.text },
              finish_reason: null
            }]
          })}\n\n`);
        } else if (event.event === 'message_stop') {
          output.push('data: [DONE]\n\n');
          output.push(null);
          return;
        }
      }
    });

    response.body.on('end', () => {
      if (buffer.trim()) {
        const events = this._parseAnthropicSSE(buffer + '\n\n');
        for (const event of events) {
          if (event.event === 'content_block_delta' && event.data.delta?.text) {
            output.push(`data: ${JSON.stringify({
              id: STABLE_CHUNK_ID,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [{ index: 0, delta: { content: event.data.delta.text }, finish_reason: null }]
            })}\n\n`);
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
