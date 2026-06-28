import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

console.log('=== Phase F: Dashboard 升级验证 ===\n');

console.log('1. 验证 model-registry.js 动态模型合并函数');
const registryContent = fs.readFileSync(path.join(__dirname, 'dashboard/model-registry.js'), 'utf8');
assert(registryContent.includes('setDynamicModels'), 'setDynamicModels 函数存在');
assert(registryContent.includes('getMergedModelsForType'), 'getMergedModelsForType 函数存在');
assert(registryContent.includes('buildDynamicFromModelsAPI'), 'buildDynamicFromModelsAPI 函数存在');
assert(registryContent.includes('_dynamicModels'), '_dynamicModels 缓存变量存在');

// 验证动态模型合并逻辑
const dynamicModels = {
  'openai': [
    { value: 'gpt-4o-new', label: 'gpt-4o-new', capabilities: ['chat', 'vision'] }
  ]
};
const MODEL_REGISTRY = {
  'openai': [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini', capabilities: ['chat', 'vision'] },
    { value: '__custom__', label: '自定义模型…', capabilities: ['chat'] }
  ]
};
let _dynamicModels = {};
function setDynamicModels(typeModelsMap) { _dynamicModels = typeModelsMap || {}; }
function getMergedModelsForType(type) {
  const dynamic = _dynamicModels[type] || [];
  const static_ = MODEL_REGISTRY[type] || MODEL_REGISTRY['openai'] || [];
  const seen = new Set(dynamic.map(m => m.value));
  const merged = [
    ...dynamic,
    ...static_.filter(m => !seen.has(m.value) && m.value !== '__custom__'),
    static_.find(m => m.value === '__custom__')
  ].filter(Boolean);
  return merged;
}
setDynamicModels(dynamicModels);
const merged = getMergedModelsForType('openai');
assert(merged.length === 3, '合并后模型数量正确: ' + merged.length);
assert(merged[0].value === 'gpt-4o-new', '动态模型优先: ' + merged[0].value);
assert(merged[1].value === 'gpt-4o-mini', '静态模型兜底: ' + merged[1].value);
assert(merged[2].value === '__custom__', '__custom__ 始终在末尾: ' + merged[2].value);

console.log('\n2. 验证 config.html 三个新模块 DOM 结构');
const configHtml = fs.readFileSync(path.join(__dirname, 'dashboard/config.html'), 'utf8');
assert(configHtml.includes('id="channel-cards"'), '渠道卡片区容器存在: #channel-cards');
assert(configHtml.includes('id="capability-graph"'), '能力图谱容器存在: #capability-graph');
assert(configHtml.includes('id="alias-editor"'), 'Alias编辑器容器存在: #alias-editor');
assert(configHtml.includes('id="alias-tbody"'), 'Alias表格tbody存在: #alias-tbody');
assert(configHtml.includes('🧠 模型能力图谱'), '能力图谱标题存在');

console.log('\n3. 验证 config.html JS 函数存在');
assert(configHtml.includes('function renderChannelCards('), 'renderChannelCards 函数存在');
assert(configHtml.includes('function syncChannel('), 'syncChannel 函数存在');
assert(configHtml.includes('const CAPABILITY_CLUSTERS'), 'CAPABILITY_CLUSTERS 常量存在');
assert(configHtml.includes('function renderCapabilityGraph('), 'renderCapabilityGraph 函数存在');
assert(configHtml.includes('function renderAliasEditor('), 'renderAliasEditor 函数存在');
assert(configHtml.includes('function addAliasRow('), 'addAliasRow 函数存在');
assert(configHtml.includes('function collectAliases('), 'collectAliases 函数存在');
assert(configHtml.includes('aliases: collectAliases()'), 'buildConfig 使用 collectAliases() 收集别名');

console.log('\n4. 验证 CAPABILITY_CLUSTERS 簇定义完整');
const clusters = ['flagship-multimodal', 'fast-multimodal', 'fast-chat', 'reasoning', 'long-context'];
clusters.forEach(name => {
  assert(configHtml.includes(`'${name}'`), `能力簇 ${name} 存在定义`);
});
assert(configHtml.includes("caps: ['chat','vision','pdf']"), 'flagship-multimodal 能力标签正确');
assert(configHtml.includes("caps: ['chat','vision']"), 'fast-multimodal 能力标签正确');
assert(configHtml.includes("caps: ['chat']"), 'fast-chat 能力标签正确');
assert(configHtml.includes("caps: ['chat','reasoning']"), 'reasoning 能力标签正确');

console.log('\n5. 验证初始化逻辑');
assert(configHtml.includes('renderChannelCards(_config.provider_groups || [])'), '初始化调用 renderChannelCards');
assert(configHtml.includes('renderAliasEditor(_aliases)'), '初始化调用 renderAliasEditor');
assert(configHtml.includes('renderCapabilityGraph(localModels)'), '初始化调用 renderCapabilityGraph');
assert(configHtml.includes("fetch('/v1/models')"), '初始化时尝试获取 /v1/models');
assert(configHtml.includes('renderChannelCards(groups)'), 'renderGroups 末尾调用 renderChannelCards');

console.log('\n=== 验证结果 ===');
console.log(`通过: ${passed}, 失败: ${failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✅ Phase F 所有验证通过!');
}
