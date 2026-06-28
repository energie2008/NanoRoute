#!/usr/bin/env node

/**
 * NanoRoute 完整功能测试
 * 测试所有 API 端点和核心功能
 */

const baseURL = 'http://localhost:20128';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  console.log('🧪 NanoRoute 功能测试\n');
  console.log(`📍 目标: ${baseURL}\n`);
  
  for (const { name, fn } of tests) {
    try {
      process.stdout.write(`  ${name} ... `);
      await fn();
      console.log('✅ PASS');
      passed++;
    } catch (err) {
      console.log('❌ FAIL');
      console.log(`     Error: ${err.message}`);
      failed++;
    }
  }
  
  console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败\n`);
  
  if (failed === 0) {
    console.log('🎉 所有测试通过！NanoRoute 运行正常。\n');
  } else {
    console.log('⚠️  部分测试失败，请检查服务器状态。\n');
    process.exit(1);
  }
}

// ============ 测试用例 ============

test('健康检查 GET /healthz', async () => {
  const res = await fetch(`${baseURL}/healthz`);
  assert(res.ok, 'Response not OK');
  
  const data = await res.json();
  assert(data.status === 'ok', 'Status not ok');
  assert(data.version === '0.1.0', 'Version mismatch');
});

test('健康检查 GET /api/health', async () => {
  const res = await fetch(`${baseURL}/api/health`);
  assert(res.ok, 'Response not OK');
  
  const data = await res.json();
  assert(data.status === 'ok', 'Status not ok');
  assert(data.memory, 'No memory info');
  assert(data.memory.rss > 0, 'Invalid memory value');
});

test('获取 Provider 列表 GET /api/providers', async () => {
  const res = await fetch(`${baseURL}/api/providers`);
  assert(res.ok, 'Response not OK');
  
  const data = await res.json();
  assert(data.providers, 'No providers field');
  assert(Array.isArray(data.providers), 'Providers not array');
  assert(data.providers.length > 0, 'No providers configured');
  
  const provider = data.providers[0];
  assert(provider.id, 'Provider has no id');
  assert(provider.type, 'Provider has no type');
  assert(provider.model, 'Provider has no model');
  assert(provider.status, 'Provider has no status');
  assert(typeof provider.rpm === 'number', 'Invalid rpm');
  assert(typeof provider.rpd === 'number', 'Invalid rpd');
});

test('获取统计数据 GET /api/stats', async () => {
  const res = await fetch(`${baseURL}/api/stats`);
  assert(res.ok, 'Response not OK');
  
  const data = await res.json();
  assert(typeof data.total_requests === 'number', 'Invalid total_requests');
  assert(typeof data.total_success === 'number', 'Invalid total_success');
  assert(typeof data.total_errors === 'number', 'Invalid total_errors');
  assert(Array.isArray(data.providers), 'Providers not array');
});

test('获取配置 GET /api/config', async () => {
  const res = await fetch(`${baseURL}/api/config`);
  assert(res.ok, 'Response not OK');
  
  const data = await res.json();
  assert(data.port, 'No port in config');
  assert(data.routing, 'No routing in config');
  assert(data.providers, 'No providers in config');
  assert(Array.isArray(data.providers), 'Providers not array');
});

test('获取模型列表 GET /v1/models', async () => {
  const res = await fetch(`${baseURL}/v1/models`);
  assert(res.ok, 'Response not OK');
  
  const data = await res.json();
  assert(data.object === 'list', 'Invalid object type');
  assert(Array.isArray(data.data), 'Data not array');
  assert(data.data.length > 0, 'No models available');
  
  const model = data.data[0];
  assert(model.id, 'Model has no id');
  assert(model.object === 'model', 'Invalid model object');
});

test('CORS 预检 OPTIONS /v1/chat/completions', async () => {
  const res = await fetch(`${baseURL}/v1/chat/completions`, {
    method: 'OPTIONS'
  });
  
  assert(res.status === 204, 'CORS preflight failed');
  assert(res.headers.get('access-control-allow-origin') === '*', 'No CORS header');
});

test('无效请求 POST /v1/chat/completions (无 model)', async () => {
  const res = await fetch(`${baseURL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'test' }]
    })
  });
  
  assert(res.status === 400, 'Should return 400 for missing model');
  
  const data = await res.json();
  assert(data.error, 'No error field');
  assert(data.error.message.includes('model'), 'Error message not about model');
});

test('Dashboard 页面 GET /', async () => {
  const res = await fetch(`${baseURL}/`);
  assert(res.ok, 'Response not OK');
  
  const html = await res.text();
  assert(html.includes('NanoRoute'), 'Not NanoRoute dashboard');
  assert(html.includes('Alpine'), 'No Alpine.js');
  assert(html.includes('dashboard'), 'Not dashboard page');
});

test('404 处理 GET /nonexistent', async () => {
  const res = await fetch(`${baseURL}/nonexistent`);
  assert(res.status === 404, 'Should return 404');
  
  const data = await res.json();
  assert(data.error, 'No error field');
});

test('内存占用检查', async () => {
  const res = await fetch(`${baseURL}/api/health`);
  const data = await res.json();
  
  const rss = data.memory.rss;
  console.log(`\n     Memory: ${rss}MB`);
  
  assert(rss < 150, `Memory too high: ${rss}MB (target <150MB)`);
  
  if (rss < 100) {
    console.log('     ✨ Excellent memory usage!');
  }
});

test('响应时间检查', async () => {
  const start = Date.now();
  await fetch(`${baseURL}/api/health`);
  const latency = Date.now() - start;
  
  console.log(`\n     Latency: ${latency}ms`);
  
  assert(latency < 100, `Response too slow: ${latency}ms`);
  
  if (latency < 20) {
    console.log('     ⚡ Excellent response time!');
  }
});

// ============ 运行测试 ============

console.log('正在连接到 NanoRoute...\n');

// 检查服务器是否运行
fetch(`${baseURL}/healthz`)
  .then(() => {
    console.log('✅ NanoRoute 服务器已启动\n');
    return runTests();
  })
  .catch((err) => {
    console.error('❌ 无法连接到 NanoRoute');
    console.error(`   ${err.message}\n`);
    console.error('请确保服务器正在运行:');
    console.error('   node server.js\n');
    process.exit(1);
  });
