# 📚 NanoRoute 详细使用教程

**版本**: v0.1.0  
**更新日期**: 2026-06-27  
**适用人群**: 初学者到高级用户

---

## 📖 目录

1. [基础教程](#基础教程)
2. [进阶配置](#进阶配置)
3. [客户端集成](#客户端集成)
4. [实战案例](#实战案例)
5. [性能优化](#性能优化)
6. [问题排查](#问题排查)

---

## 基础教程

### 第一步：安装与启动

#### 1.1 环境准备

**系统要求**:
- Node.js >= 22.0.0
- 操作系统: Windows/Linux/macOS
- 内存: 256MB+
- 磁盘: 10MB+

**检查 Node.js 版本**:
```bash
node --version
# 应该显示 v22.x.x 或更高
```

**安装 Node.js**（如果需要）:
```bash
# Windows
# 下载安装包: https://nodejs.org/

# Linux (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# macOS
brew install node@22
```

#### 1.2 获取项目

**方式一: 直接使用**（已有项目）
```bash
cd d:\ai路由\NanoRoute
```

**方式二: 克隆仓库**（从 Git）
```bash
git clone <repository-url> NanoRoute
cd NanoRoute
```

#### 1.3 安装依赖

```bash
npm install
```

**预期输出**:
```
added 2 packages in 4s
```

#### 1.4 配置文件

**复制配置模板**:
```bash
# Windows
copy config.example.yml config.yml

# Linux/macOS
cp config.example.yml config.yml
```

**编辑配置**:
```bash
# Windows
notepad config.yml

# Linux/macOS
nano config.yml
```

**最小配置示例**:
```yaml
port: 20128

providers:
  - id: my-gemini
    type: gemini
    api_key: "你的Gemini API Key"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    rpm_limit: 15

aliases:
  claude-sonnet-4: my-gemini
  gpt-4o: my-gemini
```

#### 1.5 启动服务

```bash
node server.js
```

**预期输出**:
```
╔═══════════════════════════════════════════════════════════╗
║   🚀 NanoRoute v0.1.0                                     ║
║   ✓ Server running on http://localhost:20128            ║
║   ✓ Providers: 1 configured                              ║
║   ✓ Memory: ~42MB                                        ║
╚═══════════════════════════════════════════════════════════╝
```

#### 1.6 验证安装

**打开新终端，执行**:
```bash
curl http://localhost:20128/api/health
```

**预期输出**:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 10.5,
  "memory": {
    "rss": 42,
    "heapUsed": 8,
    "heapTotal": 10
  }
}
```

**访问 Dashboard**:
```
浏览器打开: http://localhost:20128
```

✅ **第一步完成！服务器已成功运行。**

---

### 第二步：获取 API Key

#### 2.1 获取 Gemini API Key

1. **访问 Google AI Studio**:
   ```
   https://aistudio.google.com/app/apikey
   ```

2. **登录 Google 账号**

3. **创建 API Key**:
   - 点击 "Create API Key"
   - 选择项目或创建新项目
   - 复制生成的 API Key

4. **记录 API Key**:
   ```
   AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

5. **更新配置文件**:
   ```yaml
   providers:
     - id: gemini-key1
       api_key: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
   ```

#### 2.2 获取多个 API Key

**为什么需要多个 Key？**
- 单个 Gemini 免费 Key 限制: 1500 RPD (Requests Per Day)
- 8个 Key = 12,000 RPD
- 自动轮询和 Fallback

**步骤**:
1. 使用不同的 Google 账号（或同一账号的不同项目）
2. 重复上述步骤获取 8 个 API Key
3. 配置到 config.yml

**配置示例**:
```yaml
providers:
  - id: gemini-key1
    type: gemini
    api_key: "AIzaSy_Key1_XXXXXXXXXX"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    rpm_limit: 15

  - id: gemini-key2
    type: gemini
    api_key: "AIzaSy_Key2_XXXXXXXXXX"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    rpm_limit: 15

  # ... 添加更多 Key

combos:
  - id: gemini-fleet
    models: [gemini-key1, gemini-key2]
    strategy: round-robin

aliases:
  claude-sonnet-4: gemini-fleet
  gpt-4o: gemini-fleet
```

**重启服务使配置生效**:
```bash
# Ctrl+C 停止服务
node server.js  # 重新启动
```

---

### 第三步：第一次 API 调用

#### 3.1 使用 curl 测试

**基础调用**:
```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello, who are you?"}
    ],
    "stream": false
  }'
```

**流式调用**:
```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [
      {"role": "user", "content": "Count from 1 to 10"}
    ],
    "stream": true
  }'
```

#### 3.2 使用 Python 测试

**安装 OpenAI SDK**:
```bash
pip install openai
```

**创建测试脚本** `test.py`:
```python
from openai import OpenAI

# 指向 NanoRoute
client = OpenAI(
    base_url="http://localhost:20128/v1",
    api_key="not-needed"  # NanoRoute 不需要认证
)

# 非流式调用
response = client.chat.completions.create(
    model="gpt-4o",  # 会被路由到 gemini
    messages=[
        {"role": "user", "content": "你好，介绍一下自己"}
    ]
)

print(response.choices[0].message.content)

# 流式调用
print("\n流式输出:")
stream = client.chat.completions.create(
    model="claude-sonnet-4",
    messages=[
        {"role": "user", "content": "从1数到5"}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)

print()
```

**运行测试**:
```bash
python test.py
```

#### 3.3 使用 Node.js 测试

**创建测试脚本** `test.js`:
```javascript
import { OpenAI } from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:20128/v1',
  apiKey: 'not-needed'
});

// 非流式调用
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

console.log(response.choices[0].message.content);

// 流式调用
console.log('\n流式输出:');
const stream = await client.chat.completions.create({
  model: 'claude-sonnet-4',
  messages: [
    { role: 'user', content: 'Count from 1 to 5' }
  ],
  stream: true
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);
}

console.log();
```

**运行测试**:
```bash
node test.js
```

✅ **第三步完成！你已经成功调用 API。**

---

## 进阶配置

### 多 Key 轮询配置

#### 场景：8个 Gemini Key 轮询

**目标**: 实现 12,000 RPD 容量

**完整配置**:
```yaml
port: 20128
log_level: info

routing:
  default_strategy: round-robin
  sticky_limit: 1
  combo_sticky_limit: 1
  fallback_on: [429, 503, 504]

providers:
  - id: gemini-1
    type: gemini
    api_key: "AIzaSy_Key1_XXXXXXXXXX"
    model: gemini-2.0-flash-exp
    group: primary
    weight: 1
    rpd_limit: 1500
    rpm_limit: 15

  - id: gemini-2
    type: gemini
    api_key: "AIzaSy_Key2_XXXXXXXXXX"
    model: gemini-2.0-flash-exp
    group: primary
    weight: 1
    rpd_limit: 1500
    rpm_limit: 15

  - id: gemini-3
    type: gemini
    api_key: "AIzaSy_Key3_XXXXXXXXXX"
    model: gemini-2.0-flash-exp
    group: primary
    weight: 1
    rpd_limit: 1500
    rpm_limit: 15

  - id: gemini-4
    type: gemini
    api_key: "AIzaSy_Key4_XXXXXXXXXX"
    model: gemini-2.0-flash-exp
    group: primary
    weight: 1
    rpd_limit: 1500
    rpm_limit: 15

  - id: gemini-5
    type: gemini
    api_key: "AIzaSy_Key5_XXXXXXXXXX"
    model: gemini-2.0-flash-exp
    group: primary
    weight: 1
    rpd_limit: 1500
    rpm_limit: 15

  - id: gemini-6
    type: gemini
    api_key: "AIzaSy_Key6_XXXXXXXXXX"
    model: gemini-2.0-flash-exp
    group: primary
    weight: 1
    rpd_limit: 1500
    rpm_limit: 15

  - id: gemini-7
    type: gemini
    api_key: "AIzaSy_Key7_XXXXXXXXXX"
    model: gemini-2.0-flash-exp
    group: primary
    weight: 1
    rpd_limit: 1500
    rpm_limit: 15

  - id: gemini-8
    type: gemini
    api_key: "AIzaSy_Key8_XXXXXXXXXX"
    model: gemini-2.0-flash-exp
    group: primary
    weight: 1
    rpd_limit: 1500
    rpm_limit: 15

combos:
  - id: gemini-fleet
    models:
      - gemini-1
      - gemini-2
      - gemini-3
      - gemini-4
      - gemini-5
      - gemini-6
      - gemini-7
      - gemini-8
    strategy: round-robin

aliases:
  # 所有主流模型名都路由到 gemini-fleet
  claude-sonnet-4: gemini-fleet
  claude-sonnet-4-5: gemini-fleet
  claude-3-5-sonnet: gemini-fleet
  claude-3-5-sonnet-20240620: gemini-fleet
  gpt-4o: gemini-fleet
  gpt-4o-mini: gemini-fleet
  gpt-4: gemini-fleet
  gemini-2.0-flash-exp: gemini-fleet
```

**工作原理**:
1. 客户端请求 `gpt-4o`
2. Resolver 解析: `gpt-4o` → `gemini-fleet` → `[gemini-1, ..., gemini-8]`
3. Strategy 排序: 按上次使用时间轮询
4. 调用最久未使用的 Key
5. 如果失败（429/503），自动 Fallback 到下一个

**验证配置**:
```bash
# 重启服务
node server.js

# 查看 Dashboard
浏览器打开 http://localhost:20128
# 应该看到 8 个 Provider
```

---

### 多层 Fallback 配置

#### 场景：免费 Key + 付费备份

**配置**:
```yaml
providers:
  # 第一层：免费 Gemini Keys
  - id: gemini-free-1
    type: gemini
    api_key: "AIzaSy_Free1_XXX"
    model: gemini-2.0-flash-exp
    weight: 10  # 高权重优先使用
    rpd_limit: 1500

  - id: gemini-free-2
    type: gemini
    api_key: "AIzaSy_Free2_XXX"
    model: gemini-2.0-flash-exp
    weight: 10
    rpd_limit: 1500

  # 第二层：付费 OpenAI
  - id: openai-paid
    type: openai
    api_key: "sk-XXXXXXXXXXXXXXXXXX"
    model: gpt-4o-mini
    weight: 5  # 中权重备用

  # 第三层：Anthropic 最终备份
  - id: claude-backup
    type: anthropic
    api_key: "sk-ant-XXXXXXXXXXXXXXX"
    model: claude-3-5-sonnet-20240620
    weight: 1  # 低权重最后使用

routing:
  default_strategy: priority  # 使用优先级策略
  fallback_on: [429, 503, 504]

combos:
  - id: multi-tier
    models:
      - gemini-free-1
      - gemini-free-2
      - openai-paid
      - claude-backup
    strategy: priority

aliases:
  claude-sonnet-4: multi-tier
  gpt-4o: multi-tier
```

**工作流程**:
1. 优先使用 `gemini-free-1` (weight=10)
2. 如果 429/503，切换到 `gemini-free-2` (weight=10)
3. 如果都失败，切换到 `openai-paid` (weight=5)
4. 最后切换到 `claude-backup` (weight=1)

---

### 成本优化配置

#### 场景：自动选择最便宜的 Provider

**配置**:
```yaml
routing:
  default_strategy: cost-opt  # 成本优化策略

providers:
  - id: gemini-free
    type: gemini
    api_key: "AIzaSy_XXX"
    model: gemini-2.0-flash-exp
    cost: 0  # 免费
    rpd_limit: 1500

  - id: openai-mini
    type: openai
    api_key: "sk-XXX"
    model: gpt-4o-mini
    cost: 0.15  # $0.15/1M tokens

  - id: openai-full
    type: openai
    api_key: "sk-XXX"
    model: gpt-4o
    cost: 2.5  # $2.50/1M tokens

combos:
  - id: cost-optimized
    models:
      - gemini-free
      - openai-mini
      - openai-full
    strategy: cost-opt

aliases:
  gpt-4o: cost-optimized
```

**执行顺序**: 
1. `gemini-free` (cost=0) 优先
2. `openai-mini` (cost=0.15) 次之
3. `openai-full` (cost=2.5) 最后

---

## 客户端集成

### Python 集成

#### Cursor IDE

**配置 Cursor**:
1. 打开 Cursor 设置
2. 找到 "OpenAI API Key" 设置
3. 设置 Base URL: `http://localhost:20128/v1`
4. API Key 设置为任意值（例如 `sk-nanoroute`）

**或使用环境变量**:
```bash
# ~/.bashrc 或 ~/.zshrc
export OPENAI_API_BASE="http://localhost:20128/v1"
export OPENAI_API_KEY="sk-nanoroute"
```

#### Continue (VS Code扩展)

**配置文件** `~/.continue/config.json`:
```json
{
  "models": [
    {
      "title": "NanoRoute Gemini",
      "provider": "openai",
      "model": "gpt-4o",
      "apiBase": "http://localhost:20128/v1",
      "apiKey": "not-needed"
    }
  ]
}
```

#### LangChain

```python
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage

chat = ChatOpenAI(
    model="gpt-4o",
    openai_api_base="http://localhost:20128/v1",
    openai_api_key="not-needed",
    streaming=True
)

messages = [HumanMessage(content="Hello!")]
response = chat(messages)
print(response.content)
```

### Node.js 集成

#### Vercel AI SDK

```javascript
import { OpenAI } from 'openai';
import { OpenAIStream, StreamingTextResponse } from 'ai';

const openai = new OpenAI({
  baseURL: 'http://localhost:20128/v1',
  apiKey: 'not-needed'
});

export async function POST(req) {
  const { messages } = await req.json();

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    stream: true,
    messages
  });

  const stream = OpenAIStream(response);
  return new StreamingTextResponse(stream);
}
```

### Rust 集成

```rust
use reqwest::Client;
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new();
    
    let response = client
        .post("http://localhost:20128/v1/chat/completions")
        .json(&json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "user", "content": "Hello!"}
            ]
        }))
        .send()
        .await?;
    
    let result = response.json::<serde_json::Value>().await?;
    println!("{}", result);
    
    Ok(())
}
```

---

## 实战案例

### 案例1：个人开发环境

**需求**:
- 1个开发者
- 日均 200 请求
- 预算: 免费

**配置**:
```yaml
providers:
  - id: my-gemini
    type: gemini
    api_key: "你的Key"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500

aliases:
  claude-sonnet-4: my-gemini
  gpt-4o: my-gemini
```

**容量**: 1500 RPD, 足够使用

---

### 案例2：小团队（5人）

**需求**:
- 5个开发者
- 日均 5,000 请求
- 预算: 免费

**配置**:
```yaml
providers:
  - gemini-1  # 1500 RPD
  - gemini-2  # 1500 RPD
  - gemini-3  # 1500 RPD
  - gemini-4  # 1500 RPD

combos:
  - id: team-fleet
    models: [gemini-1, gemini-2, gemini-3, gemini-4]
```

**容量**: 6,000 RPD, 足够使用

---

### 案例3：企业应用

**需求**:
- 50+ 用户
- 日均 20,000+ 请求
- 预算: 混合（免费+付费）

**配置**:
```yaml
providers:
  # 免费层 (12,000 RPD)
  - gemini-1 到 gemini-8

  # 付费层 (无限)
  - openai-1
  - openai-2
  - anthropic-1

combos:
  - id: enterprise
    models: [gemini-1, ..., gemini-8, openai-1, openai-2, anthropic-1]
    strategy: priority  # 优先免费，不足时使用付费
```

**策略**: 
1. 前 12,000 请求使用免费 Gemini
2. 超出部分使用付费 Provider

---

## 性能优化

### 内存优化

**当前状态**: 34MB

**如果内存占用过高**:

1. **重启服务**:
   ```bash
   systemctl restart nanoroute
   ```

2. **减少并发**:
   ```yaml
   # 在反向代理层限制并发
   ```

3. **清理数据**:
   ```bash
   rm data/nano.json
   node server.js
   ```

### 响应速度优化

**当前状态**: 1ms 路由开销

**进一步优化**:

1. **使用本地部署** (避免网络延迟)
   ```bash
   # 部署在同一台服务器
   ```

2. **减少 Provider 数量** (减少遍历)
   ```yaml
   # 只配置必需的 Provider
   ```

3. **使用 Priority 策略** (减少尝试)
   ```yaml
   routing:
     default_strategy: priority
   ```

### 吞吐量优化

**当前状态**: 100+ req/s

**水平扩展**:
```bash
# 启动多个实例
node server.js --port 20128 &
node server.js --port 20129 &
node server.js --port 20130 &

# 使用 Nginx 负载均衡
upstream nanoroute {
    server localhost:20128;
    server localhost:20129;
    server localhost:20130;
}
```

---

## 问题排查

### 问题1：服务无法启动

**现象**:
```
Error: listen EADDRINUSE
```

**原因**: 端口被占用

**解决**:
```bash
# 查看占用
netstat -tlnp | grep 20128

# 方案1: 杀死进程
kill <pid>

# 方案2: 修改端口
# 编辑 config.yml
port: 20129
```

### 问题2：API返回429

**现象**:
```json
{
  "error": {
    "message": "Rate limit exceeded",
    "code": 429
  }
}
```

**原因**: 达到 RPD/RPM 限制

**解决**:
1. **查看Dashboard** - 确认哪个Key达到限制
2. **添加更多Key** - 增加容量
3. **等待重置** - RPM 1分钟重置，RPD 每日重置

### 问题3：响应慢

**现象**: 请求耗时 >5秒

**排查**:
```bash
# 1. 检查上游延迟
curl -w "\nTime: %{time_total}s\n" \
  https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp

# 2. 检查网络
ping generativelanguage.googleapis.com

# 3. 查看日志
journalctl -u nanoroute -f
```

**解决**:
- 网络问题 → 使用代理
- 上游慢 → 正常情况
- 本地慢 → 检查内存和CPU

### 问题4：Dashboard无法访问

**现象**: `GET /` 返回 404

**解决**:
```bash
# 检查文件
ls -la dashboard/index.html

# 如果不存在，重新创建
# 参考 COMPLETION_REPORT.md 中的 dashboard 内容
```

### 问题5：配置不生效

**现象**: 修改 config.yml 后无变化

**解决**:
```bash
# 重启服务
systemctl restart nanoroute

# 或发送 SIGHUP (Linux)
kill -HUP <pid>
```

✅ **教程完成！你已经掌握 NanoRoute 的核心使用方法。**

---

## 下一步

1. 阅读 [MAINTENANCE.md](MAINTENANCE.md) - 维护和更新指南
2. 查看 [DEPLOYMENT.md](DEPLOYMENT.md) - 生产部署
3. 参考 [ARCHITECTURE.md](docs/ARCHITECTURE.md) - 深入理解架构

**需要帮助？**
- 查看文档索引: [INDEX.md](INDEX.md)
- 查看故障排查: [DEPLOYMENT.md#故障排查](DEPLOYMENT.md)

---

**教程版本**: v0.1.0  
**更新日期**: 2026-06-27  
**状态**: ✅ 完整

🎓 **祝你使用愉快！**
