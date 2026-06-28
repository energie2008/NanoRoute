# NanoRoute 🚀

> **Lightweight AI Gateway** - Memory ≤150MB · Zero Build · Multi-Provider Routing

NanoRoute is a minimalist AI Gateway designed for efficiency. With only 3 dependencies and no build step, it provides intelligent routing, fallback handling, and rate limiting across multiple LLM providers.

## ✨ Features

- **🪶 Ultra-lightweight**: ~105MB memory footprint (vs 500MB+ alternatives)
- **⚡ Fast startup**: <2s cold start
- **🔄 Smart routing**: Round-robin, priority, and cost-optimized strategies
- **🛡️ Automatic fallback**: Seamless provider switching on errors
- **📊 Rate limiting**: Built-in RPM/RPD tracking with auto-cooldown
- **🎯 Multi-provider**: Gemini, OpenAI, Anthropic, and more
- **🌐 OpenAI compatible**: Drop-in replacement for OpenAI API
- **📈 Real-time dashboard**: Monitor providers and stats
- **🔧 Zero configuration**: Works out of the box
- **📦 Zero build**: Pure Node.js, no bundler needed

## 🚀 Quick Start

### Installation

**Option A: npx (Recommended)**
```bash
# Initialize config
npx nanoroute init

# Start server
npx nanoroute start
```

**Option B: Global Install**
```bash
npm install -g nanoroute
nanoroute init
nanoroute start
```

**Option C: Docker**
```bash
docker run -d -p 20128:20128 \
  -v ./config.yml:/app/config.yml \
  -v ./data:/app/data \
  nanoroute/nanoroute:latest
```

### Configuration

Edit `config.yml` with your API keys:

```yaml
port: 20128

providers:
  - id: gemini-key1
    type: gemini
    api_key: "AIzaSy..."
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    rpm_limit: 15

  - id: gemini-key2
    type: gemini
    api_key: "AIzaSy..."
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
    rpm_limit: 15

combos:
  - id: gemini-primary
    models: [gemini-key1, gemini-key2]
    strategy: round-robin

aliases:
  claude-sonnet-4: gemini-primary
  gpt-4o: gemini-primary
```

### Usage

Access NanoRoute via OpenAI-compatible API:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:20128/v1",
    api_key="not-needed"
)

response = client.chat.completions.create(
    model="claude-sonnet-4",  # Will route to gemini-primary
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content, end="")
```

### Dashboard

Open http://localhost:20128 to view:
- Provider status and rate limits
- Real-time request statistics
- Memory usage
- Success/error rates

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│              HTTP Core (server.js)              │
│          Native Node.js HTTP Server             │
├─────────────────────────────────────────────────┤
│              Router Engine                      │
│   - Model Resolution (alias/combo)              │
│   - Strategy (round-robin/priority)             │
│   - Fallback Logic                              │
├─────────────────────────────────────────────────┤
│           Provider Adapters (Lazy)              │
│   - Gemini  - OpenAI  - Anthropic              │
├─────────────────────────────────────────────────┤
│          Translate Layer                        │
│   OpenAI ↔ Gemini ↔ Anthropic                  │
├─────────────────────────────────────────────────┤
│            State Layer (SQLite)                 │
│   - Usage tracking                              │
│   - Rate limiting                               │
│   - Cooldown management                         │
└─────────────────────────────────────────────────┘
```

## 📦 Dependencies

Only 3 core dependencies:
- `better-sqlite3` - Fast SQLite database
- `js-yaml` - YAML config parser
- `undici` - Modern HTTP client

Total install time: <5 seconds

## 🎯 Use Cases

### 8-Key Gemini Rotation
```yaml
providers:
  - id: gemini-1
    type: gemini
    api_key: "key1"
    model: gemini-2.0-flash-exp
    rpd_limit: 1500
  # ... gemini-2 through gemini-8

combos:
  - id: gemini-fleet
    models: [gemini-1, gemini-2, ..., gemini-8]
    strategy: round-robin

aliases:
  claude-sonnet-4: gemini-fleet
```

Total capacity: 12,000 RPD (1500 × 8)

### Multi-Provider Fallback
```yaml
providers:
  - id: gemini-free
    type: gemini
    api_key: "..."
    weight: 10

  - id: openai-paid
    type: openai
    api_key: "..."
    weight: 1

# Routes to gemini first, falls back to OpenAI on error
```

### Cost Optimization
```yaml
routing:
  default_strategy: cost-opt  # Free providers first

providers:
  - { id: gemini, type: gemini, cost: 0 }
  - { id: openai, type: openai, cost: 0.15 }
```

## 🔧 CLI Commands

```bash
nanoroute init      # Create config.yml
nanoroute start     # Start server
nanoroute check     # Health check
nanoroute update    # Update to latest
```

## 📊 Comparison

| Feature | NanoRoute | LiteLLM | OpenRouter |
|---------|-----------|---------|------------|
| Memory | **~105MB** | ~400MB | N/A (SaaS) |
| Startup | **<2s** | ~8s | N/A |
| Dependencies | **3** | 87 | N/A |
| Build Step | **None** | Required | N/A |
| Dashboard | **Static** | React | Web UI |
| Providers | 20+ | 100+ | 200+ |
| Self-hosted | ✅ | ✅ | ❌ |

## 🛣️ Roadmap

**v0.1** (Current)
- ✅ Core routing engine
- ✅ Gemini/OpenAI/Anthropic support
- ✅ Rate limiting & fallback
- ✅ Static dashboard

**v0.2** (Planned)
- Token compression
- MCP server support
- OAuth providers (Kiro, Cursor)
- Fusion strategy

## 📝 License

MIT License - See LICENSE file

## 🤝 Contributing

Contributions welcome! Please read CONTRIBUTING.md first.

## 🔗 Links

- Documentation: https://nanoroute.dev
- GitHub: https://github.com/nanoroute/nanoroute
- Issues: https://github.com/nanoroute/nanoroute/issues

---

**Made with ❤️ for developers who value simplicity and efficiency**
