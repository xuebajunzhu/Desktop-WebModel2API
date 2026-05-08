# 多模型协作功能文档

## 📋 概述

本文档介绍 Web2API Desktop 新增的多模型协作功能，包括：
1. **多模型对比输出** - 并行调用多个模型，对比结果
2. **多模型辩论** - 多轮对抗式对话，支持立场分配
3. **多模型协作** - 多种工作流完成复杂任务

---

## 🗄️ 数据库结构

### 辩论相关表

```sql
-- 辩论会话
CREATE TABLE debate_sessions (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,                    -- 辩论主题
  models_json TEXT NOT NULL,              -- 参与模型列表
  positions_json TEXT NOT NULL,           -- 各模型立场
  rounds INTEGER DEFAULT 3,               -- 总轮次
  system_prompt TEXT,
  temperature REAL,
  max_tokens INTEGER,
  status TEXT CHECK(status IN ('running', 'completed', 'failed')),
  current_round INTEGER DEFAULT 0,        -- 当前轮次
  created_at INTEGER,
  completed_at INTEGER,
  error_message TEXT
);

-- 辩论轮次
CREATE TABLE debate_rounds (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  created_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES debate_sessions(id) ON DELETE CASCADE
);

-- 辩论论点
CREATE TABLE debate_arguments (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  model TEXT NOT NULL,
  position TEXT NOT NULL,                 -- 立场
  content TEXT,                           -- 论点内容
  duration_ms INTEGER,
  status TEXT CHECK(status IN ('success', 'error', 'timeout')),
  error_message TEXT,
  created_at INTEGER,
  FOREIGN KEY (round_id) REFERENCES debate_rounds(id) ON DELETE CASCADE
);
```

### 协作相关表

```sql
-- 协作任务
CREATE TABLE collaboration_tasks (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,                     -- 任务目标
  models_json TEXT NOT NULL,              -- 参与模型
  workflow TEXT CHECK(workflow IN ('sequential', 'parallel', 'voting')),
  steps_json TEXT,                        -- 步骤定义
  status TEXT CHECK(status IN ('running', 'completed', 'failed')),
  current_step INTEGER DEFAULT 0,         -- 当前步骤
  result TEXT,                            -- 最终结果
  created_at INTEGER,
  completed_at INTEGER,
  error_message TEXT
);

-- 协作步骤
CREATE TABLE collaboration_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  description TEXT NOT NULL,              -- 步骤描述
  assigned_models TEXT,                   -- 分配给哪些模型
  status TEXT CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  created_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES collaboration_tasks(id) ON DELETE CASCADE
);

-- 协作输出
CREATE TABLE collaboration_outputs (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL,
  model TEXT NOT NULL,
  content TEXT,                           -- 模型输出
  duration_ms INTEGER,
  status TEXT CHECK(status IN ('success', 'error', 'timeout')),
  error_message TEXT,
  created_at INTEGER,
  FOREIGN KEY (step_id) REFERENCES collaboration_steps(id) ON DELETE CASCADE
);
```

---

## 🔌 API 端点

### 1. 多模型对比 (已实现)

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/v1/compare` | 启动对比 |
| GET | `/v1/compare/:sessionId` | 获取详情 |
| GET | `/v1/compare` | 列出历史 |
| DELETE | `/v1/compare/:sessionId` | 删除会话 |

### 2. 多模型辩论

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/v1/debate` | 启动辩论 |
| GET | `/v1/debate/:sessionId` | 获取详情 |
| GET | `/v1/debate` | 列出历史 |
| DELETE | `/v1/debate/:sessionId` | 删除会话 |

### 3. 多模型协作

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/v1/collaborate` | 启动协作任务 |
| GET | `/v1/collaborate/:taskId` | 获取详情 |
| GET | `/v1/collaborate` | 列出历史 |
| DELETE | `/v1/collaborate/:taskId` | 删除任务 |

---

## 📝 使用示例

### 1. 多模型对比

```bash
curl -X POST http://localhost:8899/v1/compare \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "解释量子纠缠",
    "models": ["chatgpt", "claude-web", "deepseek", "qwen"],
    "temperature": 0.7,
    "maxTokens": 1000
  }'
```

**响应示例:**
```json
{
  "session": {
    "id": "cmp-xxx",
    "prompt": "解释量子纠缠",
    "models": ["chatgpt", "claude-web", "deepseek", "qwen"],
    "status": "completed",
    "createdAt": 1234567890,
    "completedAt": 1234567895
  },
  "results": [
    {
      "model": "chatgpt",
      "content": "量子纠缠是...",
      "durationMs": 2500,
      "status": "success"
    },
    {
      "model": "claude-web",
      "content": "量子纠缠指的是...",
      "durationMs": 3200,
      "status": "success"
    }
  ],
  "metadata": {
    "total_models": 4,
    "successful": 4,
    "failed": 0,
    "total_duration_ms": 3500
  }
}
```

---

### 2. 多模型辩论

```bash
curl -X POST http://localhost:8899/v1/debate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "人工智能是否应该受到严格监管？",
    "models": ["chatgpt", "claude-web", "deepseek"],
    "positions": {
      "chatgpt": "支持严格监管",
      "claude-web": "反对过度监管",
      "deepseek": "中立，主张平衡监管"
    },
    "rounds": 3,
    "temperature": 0.7
  }'
```

**响应示例:**
```json
{
  "session": {
    "id": "deb-xxx",
    "topic": "人工智能是否应该受到严格监管？",
    "models": ["chatgpt", "claude-web", "deepseek"],
    "positions": {
      "chatgpt": "支持严格监管",
      "claude-web": "反对过度监管",
      "deepseek": "中立，主张平衡监管"
    },
    "rounds": 3,
    "status": "completed",
    "currentRound": 3
  },
  "rounds": [
    {
      "roundNumber": 1,
      "arguments": [
        {
          "model": "chatgpt",
          "position": "支持严格监管",
          "content": "我认为 AI 应该受到严格监管，因为...",
          "status": "success"
        },
        {
          "model": "claude-web",
          "position": "反对过度监管",
          "content": "过度监管会阻碍创新...",
          "status": "success"
        }
      ]
    }
  ],
  "summary": "本次辩论的核心分歧在于...\n各方共识：...\n未解决问题：...",
  "metadata": {
    "total_rounds": 3,
    "total_arguments": 9,
    "total_duration_ms": 25000
  }
}
```

---

### 3. 多模型协作

#### 3.1 Sequential 工作流（流水线式）

```bash
curl -X POST http://localhost:8899/v1/collaborate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "分析气候变化对农业的影响并提出应对策略",
    "models": ["chatgpt", "claude-web", "deepseek"],
    "workflow": "sequential",
    "temperature": 0.7
  }'
```

**自动生成的步骤:**
1. **步骤 1**: `chatgpt` 分析任务并制定计划
2. **步骤 2**: 所有模型并行执行分析
3. **步骤 3**: `chatgpt` 汇总结果并输出最终答案

#### 3.2 Parallel 工作流（并行独立）

```bash
curl -X POST http://localhost:8899/v1/collaborate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "评估三种不同的投资策略",
    "models": ["chatgpt", "claude-web", "qwen"],
    "workflow": "parallel"
  }'
```

**自动生成的步骤:**
1. **步骤 1**: 所有模型并行独立分析
2. **步骤 2**: `chatgpt` 整合所有分析结果

#### 3.3 Voting 工作流（投票决策）

```bash
curl -X POST http://localhost:8899/v1/collaborate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "选择最佳的技术栈用于构建高并发系统",
    "models": ["chatgpt", "claude-web", "deepseek"],
    "workflow": "voting"
  }'
```

**自动生成的步骤:**
1. **步骤 1**: 所有模型各自给出答案
2. **步骤 2**: 所有模型互相评估并投票
3. **步骤 3**: `chatgpt` 根据投票结果确定最终答案

#### 3.4 自定义步骤

```bash
curl -X POST http://localhost:8899/v1/collaborate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "编写一份完整的产品需求文档",
    "models": ["chatgpt", "claude-web"],
    "workflow": "sequential",
    "steps": [
      {
        "description": "进行市场调研和竞品分析",
        "assignedModels": ["chatgpt"]
      },
      {
        "description": "定义产品功能和用户需求",
        "assignedModels": ["claude-web"]
      },
      {
        "description": "撰写完整的 PRD 文档",
        "assignedModels": ["chatgpt", "claude-web"]
      }
    ]
  }'
```

---

## 💡 核心特性

### 辩论功能
- ✅ 支持 2+ 模型参与
- ✅ 自定义立场分配
- ✅ 多轮对抗（默认 3 轮）
- ✅ 上下文累积（每轮参考之前论点）
- ✅ 自动生成总结
- ✅ 数据持久化

### 协作功能
- ✅ 三种预设工作流：
  - **Sequential**: 流水线式任务分解
  - **Parallel**: 并行独立分析后汇总
  - **Voting**: 各自给出答案后互相评估投票
- ✅ 支持自定义步骤
- ✅ 步骤间上下文传递
- ✅ 最终结果聚合
- ✅ 数据持久化

---

## 🔧 JavaScript SDK 示例

```javascript
// 发起辩论
async function startDebate() {
  const response = await fetch('http://localhost:8899/v1/debate', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      topic: '远程办公是否提高效率？',
      models: ['chatgpt', 'claude-web'],
      positions: {
        'chatgpt': '支持，认为提高效率',
        'claude-web': '反对，认为降低效率'
      },
      rounds: 2
    })
  });
  
  const data = await response.json();
  console.log('辩论结果:', data.summary);
}

// 发起协作任务
async function startCollaboration() {
  const response = await fetch('http://localhost:8899/v1/collaborate', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      goal: '设计一个电商网站的数据库架构',
      models: ['chatgpt', 'claude-web', 'deepseek'],
      workflow: 'voting'
    })
  });
  
  const data = await response.json();
  console.log('最终方案:', data.finalResult);
}
```

---

## ⚠️ 注意事项

1. **性能考虑**
   - 辩论和多模型协作会消耗较多时间和资源
   - 建议限制参与模型数量（2-4 个为宜）
   - 辩论轮次建议不超过 5 轮

2. **错误处理**
   - 单个模型失败不会影响整体流程
   - 错误会被记录并继续执行
   - 最终结果会标注哪些部分有错误

3. **速率限制**
   - 注意 API Key 的速率限制
   - 大量并发请求可能触发限流
   - 建议使用专用的高限额 API Key

4. **数据存储**
   - 所有会话和结果都保存在 SQLite 数据库中
   - 定期清理旧数据以节省空间
   - 外键级联删除确保数据一致性

---

## 📊 监控与统计

可以通过以下端点获取统计数据：

```bash
# 获取所有辩论会话
GET /v1/debate?limit=10&offset=0

# 获取所有协作任务
GET /v1/collaborate?limit=10&offset=0

# 获取特定会话详情
GET /v1/debate/{sessionId}
GET /v1/collaborate/{taskId}
```

---

## 🚀 未来扩展

- [ ] 实时流式输出辩论过程
- [ ] 支持观众投票功能
- [ ] 更多协作工作流模板
- [ ] 可视化辩论图谱
- [ ] 导出为 Markdown/PDF 报告
