# NanoRoute 配置文档

## 配置文件结构

NanoRoute 使用单一 `config.yml` 文件进行配置。

```yaml
# 服务器配置
port: 20128
log_level: info

# 路由配置
routing:
  default_strategy: round-robin
  sticky_limit: 1
  combo_sticky_limit: 1
  fallback_on: [429, 503, 504]

# Provider 定义
providers:
  - id: provider-1
    type: gemini
    api_key: "xxx"
    model: gemini-2.0-flash-exp
    # ...

# Combo 定义
combos:
  - id: combo-1
    models: [provider-1, provider-2]
    strategy: round-robin

# Model Alias
aliases:
  claude-sonnet-4: combo-1
  gpt-4o: combo-1
```

## 详细配置项

### 服务器配置

#### port
- **类型**: Number
- **默认值**: 20128
- **说明**: HTTP 服务器监听端口

```yaml
port: 20128
```

#### log_level
- **类型**: String
- **默认值**: "info"
- **可选值**: "debug" | "info" | "warn" | "error"
- **说明**: 日志级别

```yaml
log_level: info  # 推荐生产环境使用
log_level: debug # 开发调试使用
```

### 路由配置 (routing)

#### default_strategy
- **类型**: String
- **默认值**: "round-robin"
- **可选值**: "round-robin" | "priority" | "cost-opt"
- **说明**: 默认路由策略

**round-robin** - 轮询策略
```yaml
routing:
  default_strategy: round-robin
  sticky_limit: 1  # 每个 provider 连续使用次数
```

**priority** - 优先级策略
```yaml
routing:
  default_strategy: priority

providers:
  - id: free-provider
    weight: 10  # 高权重优先使用
  - id: paid-provider
    weight: 1   # 低权重作为后备
```

**cost-opt** - 成本优化策略
```yaml
routing:
  default_strategy: cost-opt

providers:
  - id: free-gemini
    cost: 0
  - id: openai
    cost: 0.15  # 每百万 token 成本
```

#### sticky_limit
- **类型**: Number
- **默认值**: 1
- **说明**: 单个 provider 最多连续使用次数

```yaml
routing:
  sticky_limit: 1  # 建议值，避免单 Key 过载
  sticky_limit: 3  # 可适当提高，减少切换开销
```

#### combo_sticky_limit
- **类型**: Number
- **默认值**: 1
- **说明**: Combo 内每个 provider 连续使用次数

#### fallback_on
- **类型**: Array<Number>
- **默认值**: [429, 503, 504]
- **说明**: 触发 fallback 的 HTTP 状态码

```yaml
routing:
  fallback_on: [429, 503, 504]
  # 429: 速率限制
  # 503: 服务不可用
  # 504: 网关超时
```

### Provider 配置

每个 provider 必须包含以下字段：

#### id (必需)
- **类型**: String
- **说明**: Provider 唯一标识符

```yaml
providers:
  - id: gemini-key1  # 必须唯一
```

#### type (必需)
- **类型**: String
- **可选值**: "gemini" | "openai" | "anthropic"
- **说明**: Provider 类型

```yaml
providers:
  - type: gemini     # Google Gemini
  - type: openai     # OpenAI 或兼容接口
  - type: anthropic  # Anthropic Claude
```

#### api_key (必需)
- **类型**: String
- **说明**: API 密钥或 Token

```yaml
providers:
  - api_key: "AIzaSyXXXXXXXXXXXX"  # Gemini
  - api_key: "sk-XXXXXXXXXXXXXXXX"  # OpenAI
  - api_key: "sk-ant-XXXXXXXXXXXXX" # Anthropic
```

#### model (必需)
- **类型**: String
- **说明**: 模型名称

```yaml
providers:
  - model: gemini-2.0-flash-exp      # Gemini
  - model: gpt-4o                     # OpenAI
  - model: claude-3-5-sonnet-20240620 # Anthropic
```

#### base_url (可选)
- **类型**: String
- **说明**: 自定义 API 端点（用于代理或兼容接口）

```yaml
providers:
  - type: openai
    base_url: "https://api.openai-proxy.com/v1"
```

#### group (可选)
- **类型**: String
- **默认值**: "default"
- **说明**: Provider 分组（用于管理和统计）

```yaml
providers:
  - id: gemini-1
    group: primary
  - id: openai-1
    group: fallback
```

#### weight (可选)
- **类型**: Number
- **默认值**: 1
- **说明**: 权重（priority 策略使用）

```yaml
providers:
  - id: free-provider
    weight: 10  # 优先使用
  - id: paid-provider
    weight: 1   # 备用
```

#### rpd_limit (可选)
- **类型**: Number
- **默认值**: Infinity
- **说明**: 每日请求数限制 (Requests Per Day)

```yaml
providers:
  - id: gemini-free
    rpd_limit: 1500  # Gemini 免费层限制
```

#### rpm_limit (可选)
- **类型**: Number
- **默认值**: Infinity
- **说明**: 每分钟请求数限制 (Requests Per Minute)

```yaml
providers:
  - id: gemini-free
    rpm_limit: 15  # Gemini 免费层限制
```

#### enabled (可选)
- **类型**: Boolean
- **默认值**: true
- **说明**: 是否启用

```yaml
providers:
  - id: temp-disabled
    enabled: false  # 临时禁用
```

### Combo 配置

Combo 将多个 provider 组合成一个逻辑单元。

#### id (必需)
- **类型**: String
- **说明**: Combo 唯一标识符

```yaml
combos:
  - id: gemini-primary
```

#### models (必需)
- **类型**: Array<String>
- **说明**: Provider ID 列表

```yaml
combos:
  - id: gemini-fleet
    models:
      - gemini-key1
      - gemini-key2
      - gemini-key3
```

#### strategy (可选)
- **类型**: String
- **默认值**: 使用 routing.default_strategy
- **说明**: 该 Combo 的路由策略

```yaml
combos:
  - id: gemini-rr
    models: [key1, key2]
    strategy: round-robin
    
  - id: gemini-priority
    models: [key1, key2]
    strategy: priority
```

### Alias 配置

Alias 将客户端请求的模型名映射到 Combo 或 Provider。

```yaml
aliases:
  # 客户端请求名: 实际路由目标
  claude-sonnet-4: gemini-primary
  claude-sonnet-4-5: gemini-primary
  claude-3-5-sonnet: gemini-primary
  gpt-4o: gemini-primary
  gpt-4o-mini: gemini-backup
```

**作用**：
- 统一接入：客户端无需修改代码
- 灵活路由：随时调整后端 Provider
- 成本优化：将贵的模型映射到便宜的

## 配置示例

### 示例 1：单 Key 简单配置

```yaml
port: 20128

providers:
  - id: my-gemini
    type: gemini
    api_key: "AIzaSyXXXXXXXXXX"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    rpm_limit: 15

aliases:
  claude-sonnet-4: my-gemini
  gpt-4o: my-gemini
```

### 示例 2：8 Key 轮询配置

```yaml
port: 20128

routing:
  default_strategy: round-robin
  sticky_limit: 1

providers:
  - id: gemini-1
    type: gemini
    api_key: "key1"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    rpm_limit: 15
  
  - id: gemini-2
    type: gemini
    api_key: "key2"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    rpm_limit: 15
  
  # ... gemini-3 到 gemini-8

combos:
  - id: gemini-fleet
    models: [gemini-1, gemini-2, gemini-3, gemini-4,
             gemini-5, gemini-6, gemini-7, gemini-8]
    strategy: round-robin

aliases:
  claude-sonnet-4: gemini-fleet
  gpt-4o: gemini-fleet
```

**容量**：8 × 1500 = 12,000 RPD

### 示例 3：多层 Fallback

```yaml
providers:
  # 第一层：免费 Gemini
  - id: gemini-free
    type: gemini
    api_key: "xxx"
    model: gemini-2.0-flash-exp
    weight: 10
    rpd_limit: 1500
  
  # 第二层：付费 OpenAI
  - id: openai-paid
    type: openai
    api_key: "sk-xxx"
    model: gpt-4o-mini
    weight: 5
  
  # 第三层：Anthropic
  - id: claude
    type: anthropic
    api_key: "sk-ant-xxx"
    model: claude-3-5-sonnet-20240620
    weight: 1

routing:
  default_strategy: priority
  fallback_on: [429, 503, 504]

combos:
  - id: auto-fallback
    models: [gemini-free, openai-paid, claude]
    strategy: priority

aliases:
  claude-sonnet-4: auto-fallback
```

**执行顺序**：
1. 优先 gemini-free (weight=10)
2. 429/503 则 openai-paid (weight=5)
3. 再失败则 claude (weight=1)

### 示例 4：成本优化

```yaml
routing:
  default_strategy: cost-opt

providers:
  - id: gemini-free
    type: gemini
    api_key: "xxx"
    model: gemini-2.0-flash-exp
    cost: 0
    rpd_limit: 1500
  
  - id: openai-mini
    type: openai
    api_key: "xxx"
    model: gpt-4o-mini
    cost: 0.15  # $0.15/1M tokens
  
  - id: openai-full
    type: openai
    api_key: "xxx"
    model: gpt-4o
    cost: 2.5   # $2.50/1M tokens

combos:
  - id: cost-optimized
    models: [gemini-free, openai-mini, openai-full]
    strategy: cost-opt

aliases:
  gpt-4o: cost-optimized  # 优先用免费的
```

## 配置热重载

### Linux/macOS
```bash
# 发送 SIGHUP 信号
kill -HUP <pid>

# 或使用 systemctl
systemctl reload nanoroute
```

### Windows
暂不支持，需重启服务。

## 配置验证

启动时会自动校验配置：

```bash
node server.js
```

错误示例：
```
Error: provider.id is required
Error: provider.api_key or token is required for gemini-key1
Error: No provider found for model: invalid-model
```

## 安全建议

1. **保护 API Key**
```bash
# 设置文件权限
chmod 600 config.yml

# 不要提交到 Git
echo "config.yml" >> .gitignore
```

2. **使用环境变量**（未来支持）
```yaml
providers:
  - api_key: ${GEMINI_API_KEY}
```

3. **限制访问**
```bash
# 仅监听本地
# 使用反向代理 (nginx/caddy) 加认证
```

## 故障排查

### Provider 不生效
检查：
- `enabled: true`
- `api_key` 正确
- 没有被冷却（达到 RPD/RPM 限制）

### Alias 不工作
检查：
- Alias 目标存在
- Combo 中的 models 有效

### 速率限制过于严格
调整：
```yaml
providers:
  - rpd_limit: 2000  # 增加限制
  - rpm_limit: 20
```

### 频繁切换 Provider
调整：
```yaml
routing:
  sticky_limit: 3  # 增加粘性
```

## 推荐配置

### 个人开发
```yaml
port: 20128
routing:
  default_strategy: round-robin
  sticky_limit: 1

providers:
  - id: gemini-1
    type: gemini
    api_key: "xxx"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500

aliases:
  claude-sonnet-4: gemini-1
```

### 小团队（5-10人）
```yaml
# 4-8 个 Gemini Key 轮询
providers:
  - gemini-1
  - gemini-2
  - gemini-3
  - gemini-4

combos:
  - id: team-fleet
    models: [gemini-1, gemini-2, gemini-3, gemini-4]

# 容量：4 × 1500 = 6000 RPD
```

### 生产环境
```yaml
# 多层 fallback + 监控
routing:
  default_strategy: priority
  fallback_on: [429, 503, 504]

providers:
  - gemini (免费层，多 Key)
  - openai (付费层，备用)
  - anthropic (最终备用)

# 配合 Dashboard 监控
# 配合日志分析
```
