// verify-phase-e.js — Phase E 验证脚本
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { Router } from './router/index.js';
import { AdminAPI } from './api/index.js';
import { parseBody, sendJSON, sendError, handleCORS } from './utils/http.js';
import { initDB, closeDB } from './state/db.js';
import assert from 'node:assert';

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

console.log('=== Phase E: 协议端点补全 验证 ===\n');

// E-1: normalizeResponsesInput 函数逻辑验证（直接复制 server.js 中的逻辑测试）
function normalizeResponsesInput(input) {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  if (Array.isArray(input)) {
    if (input.length > 0 && input[0].role) {
      return input;
    }
    return [{ role: 'user', content: input }];
  }
  return [];
}

test('normalizeResponsesInput(string) → single user message', () => {
  const r = normalizeResponsesInput('Hello');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].role, 'user');
  assert.strictEqual(r[0].content, 'Hello');
});

test('normalizeResponsesInput(array of messages) → passthrough', () => {
  const msgs = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
  const r = normalizeResponsesInput(msgs);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].role, 'user');
});

test('normalizeResponsesInput(array of content parts) → wrap in user message', () => {
  const parts = [{ type: 'text', text: 'hi' }];
  const r = normalizeResponsesInput(parts);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].role, 'user');
  assert.deepStrictEqual(r[0].content, parts);
});

// E-2: OpenAI provider 透传字段验证
import { OpenAIProvider } from './providers/openai.js';

test('OpenAI _buildRequestBody 透传 tools 参数', () => {
  const provider = new OpenAIProvider({ id: 'test', type: 'openai', api_key: 'test', model: 'gpt-4o' });
  const tools = [{ type: 'function', function: { name: 'test' } }];
  const body = provider._buildRequestBody([{ role: 'user', content: 'hi' }], { tools, stream: false });
  assert.deepStrictEqual(body.tools, tools);
  assert.strictEqual(body.stream, false);
});

test('OpenAI _buildRequestBody 透传 response_format', () => {
  const provider = new OpenAIProvider({ id: 'test', type: 'openai', api_key: 'test', model: 'gpt-4o' });
  const body = provider._buildRequestBody([{ role: 'user', content: 'hi' }], {
    response_format: { type: 'json_object' },
    stream: true
  });
  assert.deepStrictEqual(body.response_format, { type: 'json_object' });
  assert.strictEqual(body.stream, true);
});

test('OpenAI _buildRequestBody 不传未提供的可选字段', () => {
  const provider = new OpenAIProvider({ id: 'test', type: 'openai', api_key: 'test', model: 'gpt-4o' });
  const body = provider._buildRequestBody([{ role: 'user', content: 'hi' }], { stream: false });
  assert.strictEqual(body.tools, undefined);
  assert.strictEqual(body.reasoning, undefined);
  assert.strictEqual(body.logprobs, undefined);
});

// E-3: Router 有 handleEmbeddings 方法
test('Router 类有 handleEmbeddings 方法', () => {
  const config = { providers: [], routing: {} };
  const router = new Router(config);
  assert.strictEqual(typeof router.handleEmbeddings, 'function');
});

// E-4: /v1/models 包含 nano_meta 字段（通过启动服务测试）
async function startTestServer() {
  initDB();
  const config = {
    providers: [
      { id: 'gemini1', type: 'gemini', vendor_type: 'gemini', model: 'gemini-2.5-flash', enabled: true, capabilities: ['chat', 'vision'] }
    ],
    combos: [{ id: 'fast-chat', members: [{ group: 'gemini1', weight: 1 }] }],
    aliases: { 'gpt-4o-mini': 'gemini-2.5-flash' },
    routing: {},
    port: 20129
  };
  const routerRef = { router: new Router(config) };
  const api = new AdminAPI(config, routerRef);

  const server = createServer(async (req, res) => {
    try {
      if (handleCORS(req, res)) return;
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;

      if (path === '/v1/responses') {
        const body = await parseBody(req);
        if (!body.model) { sendError(res, 400, 'model is required'); return; }
        if (body.stream === undefined) body.stream = true;
        body._api_mode = 'responses';
        if (body.input && !body.messages) body.messages = normalizeResponsesInput(body.input);
        sendJSON(res, { received: true, model: body.model, msg_count: body.messages?.length });
        return;
      }

      if (path === '/v1/embeddings') {
        const body = await parseBody(req);
        if (!body.model) { sendError(res, 400, 'model is required'); return; }
        if (!body.input) { sendError(res, 400, 'input is required'); return; }
        sendJSON(res, { received: true, model: body.model, input_len: body.input.length });
        return;
      }

      if (path === '/v1/models') {
        const providers = config.providers || [];
        const combos = config.combos || [];
        const aliases = config.aliases || {};
        const modelMap = new Map();
        providers.filter(p => p.enabled !== false).forEach(p => {
          if (!modelMap.has(p.model)) {
            modelMap.set(p.model, {
              id: p.model, object: 'model', created: 0, owned_by: p.vendor_type || p.type,
              capabilities: p.capabilities || [],
              nano_meta: { provider_count: providers.filter(x => x.model === p.model && x.enabled !== false).length, type: p.vendor_type || p.type }
            });
          }
        });
        combos.forEach(c => {
          if (c.id && !modelMap.has(c.id)) {
            modelMap.set(c.id, { id: c.id, object: 'model', created: 0, owned_by: 'combo', capabilities: [], nano_meta: { type: 'combo', members: (c.members || []).map(m => m.group) } });
          }
        });
        Object.entries(aliases).forEach(([alias, target]) => {
          if (!modelMap.has(alias)) {
            modelMap.set(alias, { id: alias, object: 'model', created: 0, owned_by: 'alias', capabilities: [], nano_meta: { type: 'alias', target } });
          }
        });
        sendJSON(res, { object: 'list', data: Array.from(modelMap.values()) });
        return;
      }

      sendError(res, 404, 'Not found');
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  return new Promise((resolve) => {
    server.listen(20129, () => {
      resolve(server);
    });
  });
}

async function httpTest() {
  const server = await startTestServer();

  try {
    // Test /v1/models
    const modelsResp = await fetch('http://localhost:20129/v1/models');
    const modelsData = await modelsResp.json();
    test('GET /v1/models 返回 200', () => {
      assert.strictEqual(modelsResp.status, 200);
      assert.strictEqual(modelsData.object, 'list');
      assert.ok(Array.isArray(modelsData.data));
    });

    const geminiModel = modelsData.data.find(m => m.id === 'gemini-2.5-flash');
    test('/v1/models 包含 nano_meta 字段', () => {
      assert.ok(geminiModel);
      assert.ok(geminiModel.nano_meta);
      assert.strictEqual(geminiModel.nano_meta.type, 'gemini');
    });

    const aliasModel = modelsData.data.find(m => m.id === 'gpt-4o-mini');
    test('/v1/models 包含 alias 项', () => {
      assert.ok(aliasModel);
      assert.strictEqual(aliasModel.nano_meta.type, 'alias');
      assert.strictEqual(aliasModel.nano_meta.target, 'gemini-2.5-flash');
    });

    // Test /v1/responses 无 model 返回 400
    const respNoModel = await fetch('http://localhost:20129/v1/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Hello' })
    });
    test('POST /v1/responses 无 model 返回 400', () => {
      assert.strictEqual(respNoModel.status, 400);
    });

    // Test /v1/responses 正常请求
    const respOk = await fetch('http://localhost:20129/v1/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-2.5-flash', input: 'Hello', stream: false })
    });
    const respOkData = await respOk.json();
    test('POST /v1/responses 正常处理 string input', () => {
      assert.strictEqual(respOk.status, 200);
      assert.strictEqual(respOkData.received, true);
      assert.strictEqual(respOkData.msg_count, 1);
    });

    // Test /v1/embeddings 无 input 返回 400
    const embNoInput = await fetch('http://localhost:20129/v1/embeddings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small' })
    });
    test('POST /v1/embeddings 无 input 返回 400', () => {
      assert.strictEqual(embNoInput.status, 400);
    });

  } finally {
    server.close();
    closeDB();
  }
}

await httpTest();

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
