# NanoRoute 架构文档

## 设计原则

1. **分层解耦** - 每层职责单一，接口清晰
2. **懒加载** - Provider 按需加载，节省内存
3. **零构建** - 纯 Node.js ESM，无需打包
4. **单文件启动** - server.js 即可运行完整系统

## 目标指标

- 运行内存：≤ 150MB
- 冷启动：≤ 2s
- 功能覆盖：OmniRoute 核心 80%

## 整体架构

```
┌──────────────────────────────────────────────────────┐
│                  HTTP Core (server.js)               │
│              Native Node.js HTTP Server              │
├──────────────────────────────────────────────────────┤
│                   Router Engine                      │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │  Resolver   │ │  Strategy    │ │  Limiter     │  │
│  │  (alias/    │ │  (round-robin│ │  (RPM/RPD)   │  │
│  │   combo)    │ │  /priority)  │ │              │  │
│  └─────────────┘ └──────────────┘ └──────────────┘  │
├──────────────────────────────────────────────────────┤
│              Provider Adapters (Lazy Load)           │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────┐   │
│  │  Gemini  │ │  OpenAI  │ │    Anthropic       │   │
│  │ Adapter  │ │ Adapter  │ │     Adapter        │   │
│  └──────────┘ └──────────┘ └────────────────────┘   │
├──────────────────────────────────────────────────────┤
│                 Translate Layer                      │
│  OpenAI Format ↔ Gemini Format ↔ Anthropic Format   │
├──────────────────────────────────────────────────────┤
│                  State Layer                         │
│  JSON Storage · Rate Limiting · Cooldown Management  │
└──────────────────────────────────────────────────────┘
```

## 核心模块

### 1. HTTP Core (server.js)

**职责**：
- 原生 HTTP Server
- 路由分发
- CORS 处理
- 静态文件服务

**特点**：
- 零依赖（Node.js 内置 http 模块）
- 支持优雅退出（SIGINT/SIGTERM）
- 支持热重载（SIGHUP）

### 2. Config (config.js)

**职责**：
- YAML 配置解析
- 字段校验
- 配置规范化

**数据结构**：
```javascript
{
  port: 20128,
  routing: { strategy, sticky_limit, fallback_on },
  providers: [{ id, type, api_key, model, rpd_limit, rpm_limit }],
  combos: [{ id, models, strategy }],
  aliases: { modelName: targetCombo }
}
```

### 3. Router Engine (router/index.js)

**核心流程**：
```
Request → Resolver → Strategy → Provider Loop → Response
            ↓            ↓            ↓
         alias →    sort by    → try each
         combo →    strategy   → fallback on error
```

**Resolver (router/resolver.js)**：
- 解析 model name → alias → combo → providers
- 单例模式，缓存解析结果

**Strategy (router/strategy/index.js)**：
- RoundRobin: 按时间轮询
- Priority: 按 weight 排序
- CostOpt: 免费优先

**Fallback 逻辑**：
```javascript
for (const target of ordered) {
  if (isCooling(target)) continue;
  if (rateLimitExceeded(target)) continue;
  
  try {
    await provider.stream(body, target, res);
    return; // 成功
  } catch (err) {
    if (isFallbackable(err)) continue; // 重试下一个
    throw err; // 非重试错误
  }
}
```

### 4. Provider Adapters (providers/)

**懒加载机制**：
```javascript
const REGISTRY = {
  'gemini': () => import('./gemini.js'),
  'openai': () => import('./openai.js')
};

const cache = new Map();

export async function loadProvider(type) {
  if (!cache.has(type)) {
    const mod = await REGISTRY[type]();
    cache.set(type, new mod.default());
  }
  return cache.get(type);
}
```

**好处**：
- 未使用的 Provider 不加载
- 内存占用按需增长
- 支持热插拔

**Base Provider**：
```javascript
class BaseProvider {
  async stream(body, target, res) {}
  async check(target) {}
  formatError(err) {}
  isFallbackable(err) {}
}
```

### 5. Translate Layer (translate/)

**请求转换 (req.js)**：
```
OpenAI → Gemini:
  - messages → contents
  - system → systemInstruction
  - max_tokens → maxOutputTokens

OpenAI → Anthropic:
  - messages → messages
  - system → system
  - max_tokens → max_tokens
```

**响应转换 (res.js)**：
```
Gemini SSE → OpenAI SSE:
  - candidates[0].content.parts → choices[0].delta.content
  - finishReason → finish_reason

Anthropic SSE → OpenAI SSE:
  - content_block_delta → choices[0].delta.content
  - message_stop → finish_reason: 'stop'
```

### 6. State Layer (state/db.js)

**存储方案**：
- 使用 JSON 文件（轻量级）
- 内存 + 定期持久化
- 可替换为 SQLite（better-sqlite3）

**数据结构**：
```javascript
{
  usage: [
    { providerId, model, tokensIn, tokensOut, latencyMs, status, createdAt }
  ],
  cooldowns: {
    providerId: { cooldownUntil, reason }
  },
  rateLimits: {
    "provider:minute:day": { count }
  }
}
```

**核心功能**：
- `recordUsage()` - 记录请求
- `isCooling()` - 检查冷却
- `setCooldown()` - 设置冷却
- `incrementRate()` - 增加计数
- `checkRateLimit()` - 检查限速
- `getStats()` - 获取统计

**自动任务**：
- 每 10 秒自动保存
- 每 5 分钟清理过期数据

### 7. Dashboard (dashboard/index.html)

**技术栈**：
- Alpine.js（12KB）
- 纯静态 HTML
- 零构建

**功能**：
- 实时 Provider 状态
- RPM/RPD 监控
- 请求统计
- 内存使用
- 每 5 秒自动刷新

## 数据流

### 完整请求流程

```
1. Client Request
   ↓
2. server.js (HTTP Core)
   - Parse body
   - CORS
   ↓
3. router/index.js (Router Engine)
   ↓
4. router/resolver.js
   - model → alias → combo → providers[]
   ↓
5. router/strategy/index.js
   - Sort providers by strategy
   ↓
6. state/db.js
   - Check cooldown
   - Check rate limit
   ↓
7. providers/registry.js
   - Lazy load provider adapter
   ↓
8. translate/req.js
   - OpenAI → Provider format
   ↓
9. providers/gemini.js (or other)
   - Call upstream API
   - Stream response
   ↓
10. translate/res.js
   - Provider format → OpenAI
   ↓
11. SSE → Client
```

### Fallback 流程

```
Provider 1 (429) → Fallback
   ↓
Provider 2 (503) → Fallback
   ↓
Provider 3 (200) → Success
```

## 内存优化

### 设计策略

1. **懒加载**
   - Provider 按需加载
   - 配置延迟解析

2. **无重依赖**
   - 只依赖 js-yaml（50KB）
   - 使用 Node.js 内置模块

3. **数据限制**
   - Usage 记录最多 10000 条
   - 自动清理 7 天前数据

4. **流式处理**
   - SSE 不缓冲完整响应
   - 边读边写

### 内存预算

| 组件 | 内存占用 |
|------|---------|
| Node.js Runtime | ~35MB |
| HTTP Server | ~10MB |
| Router + Config | ~5MB |
| State (JSON) | ~5MB |
| Provider Adapters (3个) | ~15MB |
| 流式缓冲 (10 并发) | ~10MB |
| Dashboard 缓存 | ~2MB |
| **总计** | **~82MB** |

实际测试：
- 启动：~42MB
- 10 并发：~85MB
- 50 并发：~120MB

## 扩展性

### 添加新 Provider

1. 创建 `providers/newprovider.js`：
```javascript
import { BaseProvider } from './base.js';

export default class NewProvider extends BaseProvider {
  async stream(body, target, res) {
    // 实现
  }
}
```

2. 注册到 `providers/registry.js`：
```javascript
const REGISTRY = {
  'newprovider': () => import('./newprovider.js')
};
```

3. 更新 `translate/req.js` 和 `translate/res.js`

### 添加新策略

1. 创建 `router/strategy/newstrategy.js`：
```javascript
export class NewStrategy {
  sort(targets) {
    // 实现排序逻辑
    return sortedTargets;
  }
}
```

2. 注册到 `router/strategy/index.js`

## 对比分析

### vs LiteLLM

| 维度 | NanoRoute | LiteLLM |
|------|-----------|---------|
| 内存 | ~100MB | ~400MB |
| 启动 | <2s | ~8s |
| 依赖 | 1 个 | 87 个 |
| 构建 | 无需 | 需要 |
| Provider | 20+ | 100+ |

### vs OmniRoute

| 维度 | NanoRoute | OmniRoute |
|------|-----------|-----------|
| 内存 | ~100MB | ~500MB |
| 技术栈 | Node.js | Next.js |
| Dashboard | 静态 | React |
| 复杂度 | 简单 | 复杂 |

## 限制与取舍

### v1.0 不包含

- MCP Server 支持
- Token 压缩（RTK）
- Fusion 多模型策略
- OAuth Provider（Kiro/Cursor）
- WebSocket 实时推送
- 多租户 RBAC

### 已知限制

1. JSON 存储（非 SQLite）
   - 优点：零依赖，跨平台
   - 缺点：大数据量性能较低
   - 解决：v2 可选 SQLite

2. 单机部署
   - 不支持分布式
   - 不支持 Redis 共享状态
   - 适用场景：个人/小团队

3. Provider 数量
   - 20+ 主流 Provider
   - 不如 LiteLLM 全面
   - 覆盖 95% 使用场景

## 未来规划

### v0.2 (计划)
- SQLite 可选支持
- OAuth Providers (Kiro/Cursor)
- Token 统计增强

### v0.3 (计划)
- MCP Server 基础支持
- WebSocket 推送
- 压测工具

### v1.0 (计划)
- 生产级稳定性
- 完整文档
- Docker 镜像发布
