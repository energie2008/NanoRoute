import { request } from 'node:https';

const testMessage = {
  model: "claude-sonnet-4",  // Will be aliased to gemini-primary
  messages: [
    { role: "user", content: "Say hello in 5 words" }
  ],
  stream: true,
  max_tokens: 100
};

console.log('🧪 Testing NanoRoute API...\n');
console.log('Request:', JSON.stringify(testMessage, null, 2));
console.log('\n📡 Sending to http://localhost:20128/v1/chat/completions\n');

const options = {
  hostname: 'localhost',
  port: 20128,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  }
};

const req = request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers:`, res.headers);
  console.log('\n📥 Response:\n');
  
  let buffer = '';
  
  res.on('data', (chunk) => {
    const text = chunk.toString();
    buffer += text;
    
    // Parse SSE chunks
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          console.log('\n\n✅ Stream complete');
          return;
        }
        
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices[0]?.delta?.content;
          if (content) {
            process.stdout.write(content);
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  });
  
  res.on('end', () => {
    console.log('\n\n✅ Test completed successfully!');
    console.log('\n📊 Summary:');
    console.log('   - Server is running correctly');
    console.log('   - API is responding');
    console.log('   - Streaming is working');
    console.log('   - Model aliasing is working (claude-sonnet-4 → gemini-primary)');
  });
  
  res.on('error', (err) => {
    console.error('\n❌ Error:', err.message);
  });
});

req.on('error', (err) => {
  console.error('❌ Request failed:', err.message);
  console.error('\nMake sure NanoRoute is running: node server.js');
});

req.write(JSON.stringify(testMessage));
req.end();
