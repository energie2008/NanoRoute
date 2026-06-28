import { BaseProvider } from './base.js';
import { Readable } from 'stream';

export class GeminiProvider extends BaseProvider {
  getDefaultBaseUrl() {
    return 'https://generativelanguage.googleapis.com';
  }

  _buildUrl(model, stream = false) {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    return `/v1beta/models/${model}:${action}?key=${this.apiKey}&alt=sse`;
  }

  _buildRequestBody(messages, options = {}) {
    const contents = [];
    let systemInstruction;

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
        systemInstruction = { parts: [{ text: extractText(msg.content) }] };
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: extractText(msg.content) }]
        });
      }
    }

    const body = { contents };
    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    const generationConfig = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.max_tokens !== undefined) generationConfig.maxOutputTokens = options.max_tokens;
    if (options.top_p !== undefined) generationConfig.topP = options.top_p;
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    return body;
  }

  _generateStableId() {
    return `chatcmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  _parseNonStreamResponse(data, stableId) {
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No candidates in response');
    }
    const candidate = data.candidates[0];
    const content = candidate.content?.parts?.map(p => p.text || '').join('') || '';
    
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    if (data.usageMetadata) {
      usage = {
        prompt_tokens: data.usageMetadata.promptTokenCount || 0,
        completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata.totalTokenCount || 0
      };
    }

    return {
      id: stableId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: candidate.finishReason?.toLowerCase() || 'stop'
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

    response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.lastIndexOf('\n\n');
      if (newlineIndex === -1) return;

      const toProcess = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 2);

      const events = this._parseSSEChunk(toProcess + '\n\n');
      for (const event of events) {
        if (event.done) {
          output.push(null);
          return;
        }
        if (event.data) {
          const chunk_data = event.data;
          if (chunk_data.candidates && chunk_data.candidates[0]?.content?.parts) {
            const delta = chunk_data.candidates[0].content.parts.map(p => p.text || '').join('');
            if (delta) {
              output.push(`data: ${JSON.stringify({
                id: STABLE_CHUNK_ID,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                  index: 0,
                  delta: { content: delta },
                  finish_reason: null
                }]
              })}\n\n`);
            }
          }
        }
      }
    });

    response.body.on('end', () => {
      if (buffer.trim()) {
        const events = this._parseSSEChunk(buffer + '\n');
        for (const event of events) {
          if (event.data && event.data.candidates?.[0]?.content?.parts) {
            const delta = event.data.candidates[0].content.parts.map(p => p.text || '').join('');
            if (delta) {
              output.push(`data: ${JSON.stringify({
                id: STABLE_CHUNK_ID,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
              })}\n\n`);
            }
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
