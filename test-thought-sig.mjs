// 触发 thought_signature 错误的场景:
// assistant 带 reasoning_content + tool_calls,但不带 reasoning_signature / thought_signature
// 模拟 Trae 不回传 signature 的情况
const payload = {
  model: 'gemini-3.5-flash',
  messages: [
    { role: 'user', content: 'list files in /tmp' },
    {
      role: 'assistant',
      reasoning_content: 'I need to execute bash command to list files',
      content: '',
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'execute_bash', arguments: '{"command": "ls /tmp"}' }
        // 故意不带 thought_signature
      }]
    },
    { role: 'tool', tool_call_id: 'call_1', name: 'execute_bash', content: 'file1.txt\nfile2.txt' },
    { role: 'user', content: 'what did you find?' }
  ],
  tools: [{
    type: 'function',
    function: {
      name: 'execute_bash',
      description: 'Execute bash command',
      parameters: { type: 'object', properties: { command: { type: 'string' } } }
    }
  }],
  reasoning_effort: 'medium',
  stream: false
};

const res = await fetch('http://localhost:30128/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

console.log('=== Response ===');
console.log('status:', res.status);
const text = await res.text();
console.log('body:', text.slice(0, 800));
