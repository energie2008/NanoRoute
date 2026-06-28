# NanoRoute 快速开始指南

## 1. 安装

```bash
# 克隆或下载项目
cd NanoRoute

# 安装依赖（仅需 js-yaml）
npm install
```

## 2. 配置

复制配置文件：
```bash
cp config.example.yml config.yml
```

编辑 `config.yml`，填入你的 API Keys：

```yaml
providers:
  - id: gemini-key1
    type: gemini
    api_key: "你的Gemini API Key"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    rpm_limit: 15
```

## 3. 启动

```bash
node server.js
```

你会看到：
```
╔═══════════════════════════════════════════════════════════╗
║   🚀 NanoRoute v0.1.0                                     ║
║   ✓ Server running on http://localhost:20128            ║
║   ✓ Providers: 8 configured                              ║
║   ✓ Memory: ~42MB                                        ║
╚═══════════════════════════════════════════════════════════╝
```

## 4. 使用

### Web Dashboard

打开浏览器访问：http://localhost:20128

实时查看：
- Provider 状态
- RPM/RPD 使用情况
- 请求统计
- 内存使用

### API 调用（OpenAI 格式）

#### Python 示例

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:20128/v1",
    api_key="not-needed"  # NanoRoute 不需要认证
)

response = client.chat.completions.create(
    model="claude-sonnet-4",  # 会自动路由到 gemini-primary
    messages=[{"role": "user", "content": "你好"}],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

#### curl 示例

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

#### Node.js 示例

```javascript
import { request } from 'node:https';

const body = {
  model: "claude-sonnet-4",
  messages: [{ role: "user", content: "Hello" }],
  stream: true
};

const options = {
  hostname: 'localhost',
  port: 20128,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
};

const req = request(options, (res) => {
  res.on('data', (chunk) => {
    console.log(chunk.toString());
  });
});

req.write(JSON.stringify(body));
req.end();
```

## 5. 配置多 Key 轮询

```yaml
providers:
  - id: gemini-1
    type: gemini
    api_key: "key1"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    
  - id: gemini-2
    type: gemini
    api_key: "key2"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    
  # ... 最多 8 个

combos:
  - id: gemini-primary
    models: [gemini-1, gemini-2, gemini-3, gemini-4, 
             gemini-5, gemini-6, gemini-7, gemini-8]
    strategy: round-robin

aliases:
  claude-sonnet-4: gemini-primary
  gpt-4o: gemini-primary
```

## 6. 监控与管理

### API 接口

- `GET /api/health` - 健康检查
- `GET /api/providers` - Provider 状态
- `GET /api/stats` - 统计数据
- `GET /v1/models` - 可用模型列表

### 查看日志

```bash
# 服务器会输出详细日志
[Router] Trying provider: gemini-35-key1 (gemini)
[Router] ✓ Success with gemini-35-key1 (234ms)
```

### 内存监控

```bash
# 访问 health 接口查看内存
curl http://localhost:20128/api/health
```

## 7. 故障排查

### 配置文件错误
```
Error: config.providers must be an array
```
检查 `config.yml` 格式是否正确。

### API Key 无效
```
[Router] ✗ Failed with gemini-key1: HTTP 401
```
检查 API Key 是否正确填写。

### 端口被占用
```
Error: listen EADDRINUSE
```
修改 `config.yml` 中的 `port` 配置。

### 达到速率限制
```
[Router] gemini-key1 rate limit exceeded: rpd_exceeded
```
系统会自动切换到下一个 Key，无需手动干预。

## 8. 生产部署

### Docker 部署

```bash
# 构建镜像
docker build -t nanoroute .

# 运行容器
docker run -d \
  -p 20128:20128 \
  -v $(pwd)/config.yml:/app/config.yml \
  -v $(pwd)/data:/app/data \
  --name nanoroute \
  nanoroute
```

### 使用 docker-compose

```bash
docker-compose up -d
```

### systemd 服务（Linux）

创建 `/etc/systemd/system/nanoroute.service`：

```ini
[Unit]
Description=NanoRoute AI Gateway
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/NanoRoute
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务：
```bash
sudo systemctl enable nanoroute
sudo systemctl start nanoroute
```

## 9. 性能指标

- **内存占用**: ~40MB 启动，~100MB 运行中
- **冷启动**: <2 秒
- **请求延迟**: 底层 Provider 延迟 + ~5ms 路由开销
- **并发**: 支持 50+ 并发连接

## 10. 下一步

- 查看 [CONFIG.md](./CONFIG.md) 了解完整配置选项
- 查看 [ARCHITECTURE.md](./ARCHITECTURE.md) 了解架构设计
- 阅读 [README.md](../README.md) 了解更多功能
