# Web2API Desktop

A lightweight Windows desktop application that wraps LLM web chat interfaces (and Claude Code CLI) into unified HTTP APIs, providing both OpenAI Chat Completions and Anthropic Messages API compatibility.

## Features

- **Dual Protocol Support**: Compatible with both OpenAI `/v1/chat/completions` and Anthropic `/v1/messages` endpoints
- **20+ Model Adapters**: Including ChatGPT, Claude, DeepSeek, Qwen, Kimi, and more Chinese LLMs
- **Claude Code CLI Integration**: Direct access to Claude Code's powerful command-line capabilities
- **Local API Gateway**: All requests stay on your machine, no third-party servers involved
- **Session Management**: Persistent browser contexts with encrypted cookie storage
- **Rate Limiting**: Configurable per-API-key rate limits to prevent account bans
- **System Tray**: Runs silently in the background with quick status access

## Installation

```bash
# Install dependencies
npm install

# Start development mode
npm run dev

# Build for production
npm run build

# Package as executable
npm run package
```

## Quick Start

1. **Launch the application** - It will start automatically on system tray
2. **Add models** - Click "Add Model" and log in to each platform you want to use
3. **Get your API key** - Copy the API key from the dashboard
4. **Make requests** - Use standard OpenAI or Anthropic API format

## API Usage

### OpenAI Compatible Endpoint

```bash
curl http://127.0.0.1:8899/v1/chat/completions \
  -H "Authorization: Bearer sk-web2api-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chatgpt",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Anthropic Compatible Endpoint

```bash
curl http://127.0.0.1:8899/v1/messages \
  -H "Authorization: Bearer sk-web2api-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-web",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Claude Code CLI

```bash
curl http://127.0.0.1:8899/v1/chat/completions \
  -H "Authorization: Bearer sk-web2api-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-code",
    "messages": [{"role": "user", "content": "Read the README file"}],
    "claude_code_options": {
      "allowed_tools": ["Read", "Write"],
      "max_budget_usd": 0.50
    }
  }'
```

## Supported Models

| Model | ID | Type | Provider |
|-------|-----|------|----------|
| ChatGPT | `chatgpt` | Web | OpenAI |
| Claude Web | `claude-web` | Web | Anthropic |
| Claude Code | `claude-code` | CLI | Anthropic |
| DeepSeek | `deepseek` | Web | DeepSeek |
| 通义千问 | `qwen` | Web | Alibaba |
| 智谱清言 | `glm` | Web | Zhipu |
| Kimi | `kimi` | Web | Moonshot |
| 豆包 | `doubao` | Web | ByteDance |
| 腾讯元宝 | `yuanbao` | Web | Tencent |
| 文心一言 | `yiyan` | Web | Baidu |
| 讯飞星火 | `xinghuo` | Web | iFlytek |
| 海螺 AI | `hailuo` | Web | MiniMax |
| Coze | `coze` | Web | ByteDance |
| 秘塔 AI | `metaso` | Web | Metaso |
| 天工 AI | `tiangong` | Web | Kunlun |
| 问小白 | `wxiaobai` | Web | Wxiaobai |
| 纳米 AI | `nano` | Web | Tianrang |
| 波尔 AI | `boai` | Web | BoAI |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB2API_PORT` | `8899` | API server port |
| `ANTHROPIC_API_KEY` | - | Required for Claude Code CLI |

### Database

Session data and configurations are stored in SQLite at:
- Windows: `%APPDATA%\web2api\web2api.db`
- Browser profiles: `%APPDATA%\web2api\browser-profiles\`

## Architecture

```
┌─────────────────┐
│  External Apps  │
│  (Scripts/IDE)  │
└────────┬────────┘
         │ HTTP/SSE
┌────────▼────────┐
│   API Gateway   │
│  (Express.js)   │
└────────┬────────┘
         │
┌────────▼────────┐
│ Task Scheduler  │
└────────┬────────┘
         │
┌────────▼────────┐
│   Adapters      │
│ ┌─────┬─────┐   │
│ │Web  │ CLI  │   │
│ └─────┴─────┘   │
└────────┬────────┘
         │
┌────────▼────────┐
│ Playwright /    │
│ child_process   │
└─────────────────┘
```

## Security

- All data stored locally with AES-256-GCM encryption
- API keys are hashed before storage
- Browser contexts are isolated per model
- API only listens on 127.0.0.1 (no remote access)
- Claude Code supports tool restrictions and budget limits

## Development

### Project Structure

```
web2api-desktop/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.ts           # App entry point
│   │   ├── api-server.ts      # Express API server
│   │   ├── scheduler.ts       # Task scheduler
│   │   ├── browser-pool.ts    # Browser instance pool
│   │   ├── cli-manager.ts     # CLI process manager
│   │   ├── adapters/          # Model adapter configs
│   │   ├── converters/        # Protocol converters
│   │   └── storage/           # Database & encryption
│   ├── renderer/              # React frontend
│   └── shared/                # Shared types
├── package.json
└── electron-builder.yml
```

### Adding New Adapters

1. Create a new YAML file in `src/main/adapters/`
2. Define selectors and interaction flow
3. Add model entry to the scheduler's adapter registry

Example adapter (`new-model.yml`):
```yaml
name: new-model
type: web
base_url: https://example.com
input_selector: "#input"
send_button: "button.send"
response_container: ".response"
```

## Risks & Disclaimers

⚠️ **Important**: This software is for educational and research purposes only.

- Using web automation may violate target websites' Terms of Service
- Accounts may be flagged or banned due to automated access
- Developers assume no liability for any consequences of using this software
- Always use dedicated accounts for automation testing
- Respect rate limits and implement conservative delays

## License

MIT License - See LICENSE file for details

## Version

1.0.0 (2026-04-27)
