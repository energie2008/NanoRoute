/**
 * Request Translation Layer
 * Convert between different LLM API formats
 * Internal format: OpenAI
 */

/**
 * Translate OpenAI request to Gemini format
 */
export function toGemini(openaiBody, target) {
  const messages = openaiBody.messages || [];
  const contents = [];
  let systemInstruction = null;
  
  // Extract system message
  const systemMsg = messages.find(m => m.role === 'system');
  if (systemMsg) {
    systemInstruction = { parts: [{ text: systemMsg.content }] };
  }
  
  // Convert messages
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    
    const role = msg.role === 'assistant' ? 'model' : 'user';
    
    if (typeof msg.content === 'string') {
      contents.push({
        role,
        parts: [{ text: msg.content }]
      });
    } else if (Array.isArray(msg.content)) {
      const parts = msg.content.map(part => {
        if (part.type === 'text') {
          return { text: part.text };
        } else if (part.type === 'image_url') {
          // Convert base64 or URL to inline data
          const imageUrl = part.image_url?.url || part.image_url;
          if (imageUrl.startsWith('data:')) {
            const [mimeType, base64] = imageUrl.split(',');
            return {
              inlineData: {
                mimeType: mimeType.split(':')[1].split(';')[0],
                data: base64
              }
            };
          } else {
            return {
              fileData: { fileUri: imageUrl }
            };
          }
        }
        return { text: '' };
      });
      
      contents.push({ role, parts });
    }
  }
  
  const geminiBody = {
    contents,
    generationConfig: {
      temperature: openaiBody.temperature ?? 1.0,
      maxOutputTokens: openaiBody.max_tokens ?? 8192,
      topP: openaiBody.top_p ?? 1.0,
      topK: openaiBody.top_k,
    }
  };
  
  if (systemInstruction) {
    geminiBody.systemInstruction = systemInstruction;
  }
  
  if (openaiBody.stop) {
    geminiBody.generationConfig.stopSequences = Array.isArray(openaiBody.stop) 
      ? openaiBody.stop 
      : [openaiBody.stop];
  }
  
  return geminiBody;
}

/**
 * Translate OpenAI request to Anthropic format
 */
export function toAnthropic(openaiBody, target) {
  const messages = openaiBody.messages || [];
  const anthropicMessages = [];
  let system = '';
  
  // Extract system message
  const systemMsg = messages.find(m => m.role === 'system');
  if (systemMsg) {
    system = systemMsg.content;
  }
  
  // Convert messages
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    
    anthropicMessages.push({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : msg.content
    });
  }
  
  const anthropicBody = {
    model: target.model,
    messages: anthropicMessages,
    max_tokens: openaiBody.max_tokens ?? 4096,
    temperature: openaiBody.temperature ?? 1.0,
    stream: openaiBody.stream ?? false
  };
  
  if (system) {
    anthropicBody.system = system;
  }
  
  if (openaiBody.top_p !== undefined) {
    anthropicBody.top_p = openaiBody.top_p;
  }
  
  if (openaiBody.stop) {
    anthropicBody.stop_sequences = Array.isArray(openaiBody.stop) 
      ? openaiBody.stop 
      : [openaiBody.stop];
  }
  
  return anthropicBody;
}

/**
 * Main translation router
 */
export function translateRequest(openaiBody, target) {
  const type = target.type;
  
  if (type === 'gemini') {
    return toGemini(openaiBody, target);
  } else if (type === 'anthropic') {
    return toAnthropic(openaiBody, target);
  } else if (type === 'openai') {
    return openaiBody; // Pass through
  }
  
  // Default: pass through
  return openaiBody;
}
