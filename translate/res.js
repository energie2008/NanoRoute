/**
 * Response Translation Layer
 * Convert provider responses to OpenAI format
 */

/**
 * Parse Gemini SSE chunk to OpenAI format
 */
export function geminiChunkToOpenAI(chunk, model = 'gemini-2.0-flash-exp') {
  try {
    // Gemini sends JSON chunks
    const data = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;
    
    if (data.candidates && data.candidates[0]) {
      const candidate = data.candidates[0];
      const content = candidate.content;
      
      // Extract text
      let text = '';
      if (content && content.parts) {
        for (const part of content.parts) {
          if (part.text) {
            text += part.text;
          }
        }
      }
      
      // Check finish reason
      const finishReason = candidate.finishReason;
      const stopReason = finishReason === 'STOP' ? 'stop' 
        : finishReason === 'MAX_TOKENS' ? 'length'
        : finishReason === 'SAFETY' ? 'content_filter'
        : null;
      
      return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          delta: text ? { content: text } : {},
          finish_reason: stopReason
        }]
      };
    }
    
    return null;
  } catch (err) {
    console.error('Failed to parse Gemini chunk:', err);
    return null;
  }
}

/**
 * Parse Anthropic SSE chunk to OpenAI format
 */
export function anthropicChunkToOpenAI(chunk, model = 'claude-sonnet-4') {
  try {
    const data = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;
    
    if (data.type === 'content_block_delta' && data.delta) {
      return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          delta: { content: data.delta.text || '' },
          finish_reason: null
        }]
      };
    }
    
    if (data.type === 'message_stop' || data.type === 'content_block_stop') {
      return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop'
        }]
      };
    }
    
    return null;
  } catch (err) {
    console.error('Failed to parse Anthropic chunk:', err);
    return null;
  }
}

/**
 * Convert Gemini non-streaming response to OpenAI format
 */
export function geminiResponseToOpenAI(geminiResp, model = 'gemini-2.0-flash-exp') {
  const candidate = geminiResp.candidates?.[0];
  if (!candidate) {
    throw new Error('No valid response from Gemini');
  }
  
  const content = candidate.content;
  let text = '';
  
  if (content && content.parts) {
    for (const part of content.parts) {
      if (part.text) {
        text += part.text;
      }
    }
  }
  
  const finishReason = candidate.finishReason === 'STOP' ? 'stop'
    : candidate.finishReason === 'MAX_TOKENS' ? 'length'
    : 'stop';
  
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text
      },
      finish_reason: finishReason
    }],
    usage: {
      prompt_tokens: geminiResp.usageMetadata?.promptTokenCount || 0,
      completion_tokens: geminiResp.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: geminiResp.usageMetadata?.totalTokenCount || 0
    }
  };
}

/**
 * Convert Anthropic non-streaming response to OpenAI format
 */
export function anthropicResponseToOpenAI(anthropicResp, model = 'claude-sonnet-4') {
  const content = anthropicResp.content?.[0];
  if (!content) {
    throw new Error('No valid response from Anthropic');
  }
  
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: content.text || ''
      },
      finish_reason: anthropicResp.stop_reason || 'stop'
    }],
    usage: {
      prompt_tokens: anthropicResp.usage?.input_tokens || 0,
      completion_tokens: anthropicResp.usage?.output_tokens || 0,
      total_tokens: (anthropicResp.usage?.input_tokens || 0) + (anthropicResp.usage?.output_tokens || 0)
    }
  };
}
