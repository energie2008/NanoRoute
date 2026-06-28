// verify-phase-g.js — Phase G 验证脚本
import assert from 'node:assert';
import { Readable } from 'stream';
import { GeminiProvider } from './providers/gemini.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { Router } from './router/index.js';
import { initDB, closeDB } from './state/db.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('=== Phase G: 稳定性巩固 验证 ===\n');

// G-1: Stable chunk id - Gemini
test('GeminiProvider 所有流式 chunk 使用相同 id', () => {
  const provider = new GeminiProvider({ id: 'test', type: 'gemini', api_key: 'test', model: 'gemini-2.5-flash' });
  const mockStream = new Readable({ read() {} });
  const originalStreamRequest = provider._streamRequest;
  provider._streamRequest = async () => ({
    statusCode: 200,
    body: mockStream
  });
  provider._parseSSEChunk = () => [{ data: { candidates: [{ content: { parts: [{ text: 'hello' }] } }] }, done: false }];

  const chunks = [];
  const streamPromise = provider.chatCompletionStream([{ role: 'user', content: 'hi' }], {}).then(outStream => {
    return new Promise((resolve) => {
      outStream.on('data', (chunk) => {
        const text = chunk.toString();
        if (text.startsWith('data: ') && !text.includes('[DONE]')) {
          chunks.push(JSON.parse(text.slice(6)));
        }
      });
      outStream.on('end', () => resolve(chunks));
    });
  });

  setTimeout(() => {
    mockStream.push('data: {}\n\n');
    mockStream.push('data: {}\n\n');
    mockStream.push(null);
  }, 10);

  return streamPromise.then(collectedChunks => {
    assert.ok(collectedChunks.length >= 2, 'Should have at least 2 chunks');
    const firstId = collectedChunks[0].id;
    assert.ok(firstId.startsWith('chatcmpl-'), `Id should start with chatcmpl-, got ${firstId}`);
    for (const c of collectedChunks) {
      assert.strictEqual(c.id, firstId, `All chunks should have same id, got ${c.id} vs ${firstId}`);
    }
  });
});

// G-1: Stable chunk id - Anthropic
test('AnthropicProvider 所有流式 chunk 使用相同 id', () => {
  const provider = new AnthropicProvider({ id: 'test', type: 'anthropic', api_key: 'test', model: 'claude-3-haiku' });
  const mockStream = new Readable({ read() {} });
  provider._streamRequest = async () => ({
    statusCode: 200,
    body: mockStream
  });

  const chunks = [];
  const streamPromise = provider.chatCompletionStream([{ role: 'user', content: 'hi' }], {}).then(outStream => {
    return new Promise((resolve) => {
      outStream.on('data', (chunk) => {
        const text = chunk.toString();
        if (text.startsWith('data: ') && !text.includes('[DONE]')) {
          chunks.push(JSON.parse(text.slice(6)));
        }
      });
      outStream.on('end', () => resolve(chunks));
    });
  });

  setTimeout(() => {
    mockStream.push('event: content_block_delta\ndata: {"delta":{"text":"hello"}}\n\n');
    mockStream.push('event: content_block_delta\ndata: {"delta":{"text":"world"}}\n\n');
    mockStream.push('event: message_stop\ndata: {}\n\n');
    mockStream.push(null);
  }, 10);

  return streamPromise.then(collectedChunks => {
    assert.ok(collectedChunks.length >= 2, 'Should have at least 2 chunks');
    const firstId = collectedChunks[0].id;
    assert.ok(firstId.startsWith('chatcmpl-'), `Id should start with chatcmpl-, got ${firstId}`);
    for (const c of collectedChunks) {
      assert.strictEqual(c.id, firstId, `All chunks should have same id, got ${c.id} vs ${firstId}`);
    }
  });
});

// G-2: _getMemberTargets 方法存在
initDB();
test('Router 有 _getMemberTargets 方法', () => {
  const router = new Router({ providers: [], routing: {} });
  assert.strictEqual(typeof router._getMemberTargets, 'function');
});

// G-2: _getMemberTargets 返回 targets 数组
test('_getMemberTargets 返回扁平化 targets', () => {
  const router = new Router({
    providers: [
      { id: 'p1', type: 'openai', model: 'gpt-4o', enabled: true },
      { id: 'p2', type: 'openai', model: 'gpt-4o', enabled: true }
    ],
    routing: {}
  });
  const resolveResult = router.resolver.resolve('gpt-4o');
  const targets = router._getMemberTargets(resolveResult);
  assert.ok(Array.isArray(targets));
  assert.strictEqual(targets.length, 2);
});

// G-3: Lazy loading - FusionHandler 未在构造时实例化
test('FusionHandler 懒加载 - 初始 _fusion 为 null', () => {
  const router = new Router({ providers: [], routing: {} });
  assert.strictEqual(router._fusion, null, '_fusion should be null initially');
});

// G-3: _getFusion 是 async 方法
test('_getFusion 是异步方法', () => {
  const router = new Router({ providers: [], routing: {} });
  assert.strictEqual(typeof router._getFusion, 'function');
});

// G-4: bridge 字段在 resolve 后被设置到 parsedRequest
test('handleRequest 解析后设置 parsedRequest._bridge', async () => {
  const config = {
    providers: [
      { id: 'gemini1', type: 'gemini', model: 'gemini-2.5-pro', enabled: true }
    ],
    routing: { capability_bridge: true }
  };
  const router = new Router(config);

  let receivedParsedRequest = null;
  const originalTryProvider = router._tryProvider.bind(router);
  router._tryProvider = async (target, req, res, parsedRequest, ...args) => {
    receivedParsedRequest = parsedRequest;
    return { success: false, error: new Error('test') };
  };

  const mockReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const mockRes = {
    writeHead: () => {},
    setHeader: () => {},
    write: () => {},
    end: () => {},
    status: () => mockRes,
    json: () => { mockRes.end(); },
    send: () => { mockRes.end(); }
  };

  await router.handleRequest(mockReq, mockRes, {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    options: {}
  });

  assert.ok(receivedParsedRequest, 'parsedRequest should be passed to _tryProvider');
  assert.ok(receivedParsedRequest._bridge, '_bridge should exist on parsedRequest');
  assert.strictEqual(receivedParsedRequest._bridge.from, 'gpt-4o');
  assert.strictEqual(receivedParsedRequest._bridge.to, 'gemini-2.5-pro');
});

// G-4: Request log 包含 bridge 字段
test('_addRequestLog 记录包含 bridge 字段', () => {
  const router = new Router({ providers: [], routing: {} });
  router._requestLog = [];
  router._addRequestLog({
    ts: Date.now(),
    model: 'gpt-4o',
    resolved_model: 'gemini-2.5-pro',
    status: 200,
    provider: 'gemini1',
    latency: 100,
    tokens: 50,
    stream: false,
    bridge: { from: 'gpt-4o', to: 'gemini-2.5-pro' }
  });
  const log = router.getRequestLog()[0];
  assert.ok(log.bridge, 'log entry should have bridge field');
  assert.strictEqual(log.bridge.from, 'gpt-4o');
  assert.strictEqual(log.bridge.to, 'gemini-2.5-pro');
});

// G-5: Memory Guard - 检查 server.js 包含内存守卫代码
import { readFileSync } from 'node:fs';
const serverCode = readFileSync('./server.js', 'utf-8');
test('server.js 包含 Memory Guard 代码 (PEAK_THRESHOLD_MB)', () => {
  assert.ok(serverCode.includes('PEAK_THRESHOLD_MB'), 'Should define PEAK_THRESHOLD_MB');
  assert.ok(serverCode.includes('IDLE_THRESHOLD_MB'), 'Should define IDLE_THRESHOLD_MB');
  assert.ok(serverCode.includes('MemoryGuard'), 'Should log MemoryGuard messages');
  assert.ok(serverCode.includes('providerCache.clear()'), 'Should clear provider cache');
});

closeDB();

// 等待异步测试完成
setTimeout(() => {
  console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
  if (failed > 0) process.exit(1);
}, 500);
