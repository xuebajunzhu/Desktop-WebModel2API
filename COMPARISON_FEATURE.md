# 多模型对比输出功能

## 概述
新增了多模型并行对比功能，允许用户同时向多个 LLM 模型发送相同的请求，并比较它们的输出结果、响应时间和性能指标。

## 新增文件

### 1. `src/main/comparison-engine.ts`
核心对比引擎，负责：
- 并行执行多个模型的请求
- 收集和管理对比结果
- 数据库持久化存储

### 2. 数据库新增表
- `comparison_sessions`: 存储对比会话信息
- `comparison_results`: 存储每个模型的对比结果

## API 端点

### POST /v1/compare
启动多模型对比任务

**请求体:**
```json
{
  "prompt": "解释量子纠缠",
  "models": ["chatgpt", "claude-web", "deepseek", "qwen"],
  "systemPrompt": "你是一位专业的科学解释者",
  "temperature": 0.7,
  "maxTokens": 1000
}
```

**响应:**
```json
{
  "session": {
    "id": "cmp-xxx-uuid-xxx",
    "prompt": "解释量子纠缠",
    "models": ["chatgpt", "claude-web", "deepseek", "qwen"],
    "status": "completed",
    "createdAt": 1234567890,
    "completedAt": 1234567895
  },
  "results": [
    {
      "id": "res-xxx",
      "sessionId": "cmp-xxx",
      "model": "chatgpt",
      "content": "量子纠缠是...",
      "durationMs": 3500,
      "status": "success"
    },
    ...
  ],
  "metadata": {
    "total_models": 4,
    "successful": 4,
    "failed": 0,
    "total_duration_ms": 5200
  }
}
```

### GET /v1/compare/:sessionId
获取特定对比会话的详细信息

**响应:**
```json
{
  "session": { ... },
  "results": [ ... ]
}
```

### GET /v1/compare
列出所有对比会话（支持分页）

**查询参数:**
- `limit`: 每页数量 (默认 50)
- `offset`: 偏移量 (默认 0)

**响应:**
```json
{
  "sessions": [ ... ],
  "pagination": {
    "limit": 50,
    "offset": 0
  }
}
```

### DELETE /v1/compare/:sessionId
删除对比会话

**响应:**
```json
{
  "success": true
}
```

## 使用示例

### cURL 示例
```bash
# 启动对比任务
curl -X POST http://localhost:8899/v1/compare \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "用简单语言解释相对论",
    "models": ["chatgpt", "claude-web", "deepseek"],
    "temperature": 0.7
  }'

# 查询对比结果
curl http://localhost:8899/v1/compare/cmp-xxx-uuid-xxx \
  -H "Authorization: Bearer YOUR_API_KEY"

# 列出历史对比
curl "http://localhost:8899/v1/compare?limit=10&offset=0" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### JavaScript 示例
```javascript
const response = await fetch('http://localhost:8899/v1/compare', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: '写一首关于春天的诗',
    models: ['chatgpt', 'claude-web', 'qwen', 'kimi'],
    temperature: 0.8
  })
});

const data = await response.json();
console.log('对比结果:', data.results);

// 按响应时间排序
const sorted = data.results.sort((a, b) => a.durationMs - b.durationMs);
console.log('最快模型:', sorted[0].model);
```

## 特性

### 1. 并行执行
- 所有模型同时发起请求，最大化效率
- 独立错误处理，单个模型失败不影响其他模型

### 2. 性能指标
- 每个模型的响应时间 (durationMs)
- 总体耗时统计
- 成功/失败计数

### 3. 数据持久化
- 所有对比结果自动保存到 SQLite 数据库
- 支持历史查询和对比分析
- 级联删除确保数据一致性

### 4. 灵活配置
- 支持 1-10 个模型同时对比
- 可配置 system prompt、temperature、maxTokens
- 兼容 OpenAI 和 Anthropic 格式的模型

## 数据库结构

### comparison_sessions 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 会话唯一 ID |
| prompt | TEXT | 原始提示词 |
| models_json | TEXT | 模型列表 JSON |
| system_prompt | TEXT | 系统提示词 |
| temperature | REAL | 温度参数 |
| max_tokens | INTEGER | 最大 token 数 |
| status | TEXT | running/completed/failed |
| created_at | INTEGER | 创建时间戳 |
| completed_at | INTEGER | 完成时间戳 |
| error_message | TEXT | 错误信息 |

### comparison_results 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 结果唯一 ID |
| session_id | TEXT | 关联会话 ID |
| model | TEXT | 模型名称 |
| content | TEXT | 模型输出内容 |
| finish_reason | TEXT | 结束原因 |
| usage_json | TEXT | Token 使用统计 JSON |
| cost_usd | REAL | 成本 (美元) |
| duration_ms | INTEGER | 响应时间 (毫秒) |
| status | TEXT | success/error/timeout |
| error_message | TEXT | 错误信息 |
| created_at | INTEGER | 创建时间戳 |

## 注意事项

1. **模型数量限制**: 单次对比最多支持 10 个模型
2. **并发控制**: 受限于 BrowserPool 的并发设置
3. **超时处理**: 单个模型超时不影响其他模型
4. **资源消耗**: 多模型并行会消耗更多系统资源

## 后续扩展

此功能为三大协作能力之一，后续可扩展：
- **辩论模式**: 多模型对抗式对话
- **协作模式**: 多模型分工完成任务
