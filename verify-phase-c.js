// verify-phase-c.js — Phase C 验证脚本
import { findCluster, getBridgeCandidates } from './router/capability-graph.js';
import { Resolver } from './router/resolver.js';
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

console.log('=== Phase C: 能力图谱 + 自动桥接 验证 ===\n');

// C-1: findCluster 精确命中
test('findCluster(gemini-2.5-pro) → flagship-multimodal', () => {
  const r = findCluster('gemini-2.5-pro');
  assert.strictEqual(r?.name, 'flagship-multimodal');
});

test('findCluster(gpt-4o) → flagship-multimodal', () => {
  const r = findCluster('gpt-4o');
  assert.strictEqual(r?.name, 'flagship-multimodal');
});

test('findCluster(claude-opus) → flagship-multimodal', () => {
  const r = findCluster('claude-opus');
  assert.strictEqual(r?.name, 'flagship-multimodal');
});

// C-2: 前缀命中（带版本号）
test('findCluster(gemini-2.5-flash-latest) → fast-multimodal', () => {
  const r = findCluster('gemini-2.5-flash-latest');
  assert.strictEqual(r?.name, 'fast-multimodal');
});

test('findCluster(claude-haiku-3.5) → fast-multimodal', () => {
  const r = findCluster('claude-haiku-3.5');
  assert.strictEqual(r?.name, 'fast-multimodal');
});

test('findCluster(gpt-4o-mini-2024-07-18) → fast-multimodal', () => {
  const r = findCluster('gpt-4o-mini-2024-07-18');
  assert.strictEqual(r?.name, 'fast-multimodal');
});

test('findCluster(gemini-flash-lite) → fast-chat', () => {
  const r = findCluster('gemini-flash-lite');
  assert.strictEqual(r?.name, 'fast-chat');
});

test('findCluster(o3-mini) → reasoning', () => {
  const r = findCluster('o3-mini');
  assert.strictEqual(r?.name, 'reasoning');
});

// C-3: 无命中
test('findCluster(my-custom-model) → null', () => {
  const r = findCluster('my-custom-model');
  assert.strictEqual(r, null);
});

test('findCluster(empty) → null', () => {
  const r = findCluster('');
  assert.strictEqual(r, null);
});

// C-4: getBridgeCandidates
test('bridge gpt-4o 应该匹配同簇的 gemini-2.5-pro', () => {
  const candidates = getBridgeCandidates('gpt-4o', ['gemini-2.5-pro', 'claude-fable-5', 'deepseek-v3']);
  assert.ok(candidates.includes('gemini-2.5-pro'), '应该包含 gemini-2.5-pro');
  assert.ok(candidates.includes('claude-fable-5'), '应该包含 claude-fable-5');
  assert.ok(!candidates.includes('deepseek-v3'), '不应该包含 deepseek-v3（不在 flagship 簇）');
});

test('bridge 应该跳过自身', () => {
  const candidates = getBridgeCandidates('gpt-4o', ['gpt-4o', 'gemini-2.5-pro']);
  assert.ok(!candidates.includes('gpt-4o'), '不应该包含自身');
  assert.ok(candidates.includes('gemini-2.5-pro'));
});

test('bridge 未知模型返回空数组', () => {
  const candidates = getBridgeCandidates('unknown-model-xyz', ['gemini-2.5-pro']);
  assert.strictEqual(candidates.length, 0);
});

// C-5: Resolver 桥接集成测试
test('Resolver 自动桥接 gpt-4o → gemini-2.5-pro', () => {
  const config = {
    providers: [
      { id: 'gemini1', type: 'gemini', model: 'gemini-2.5-pro', enabled: true }
    ],
    routing: { capability_bridge: true }
  };
  const resolver = new Resolver(config);
  const result = resolver.resolve('gpt-4o');
  assert.strictEqual(result._bridged_from, 'gpt-4o');
  assert.strictEqual(result._bridged_to, 'gemini-2.5-pro');
  assert.ok(result.memberGroups.length > 0);
});

test('Resolver 禁用桥接时应该抛错', () => {
  const config = {
    providers: [
      { id: 'gemini1', type: 'gemini', model: 'gemini-2.5-pro', enabled: true }
    ],
    routing: { capability_bridge: false }
  };
  const resolver = new Resolver(config);
  assert.throws(() => resolver.resolve('gpt-4o'), /Model not found/);
});

test('Resolver 无同簇候选时应该抛错', () => {
  const config = {
    providers: [
      { id: 'lite1', type: 'openai', model: 'gpt-3.5-turbo', enabled: true }
    ],
    routing: { capability_bridge: true }
  };
  const resolver = new Resolver(config);
  assert.throws(() => resolver.resolve('gpt-4o'), /Model not found/);
});

// C-6: _providerSupportsCaps 逻辑验证（直接测试 preset 匹配）
import { resolvePreset } from './state/model-presets.js';

test('resolvePreset 对 gemini-2.5-flash 应该返回 vision capabilities', () => {
  const preset = resolvePreset('gemini-2.5-flash', 'gemini');
  assert.ok(preset.capabilities.includes('chat'));
  assert.ok(preset.capabilities.includes('vision'));
});

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
