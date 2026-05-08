import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

const DB_PATH = path.join(app.getPath('userData'), 'web2api.db');

export function initDatabase(): void {
  db = new Database(DB_PATH);
  
  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  
  // Create tables
  db.exec(`
    -- Platform accounts (web sessions and CLI keys)
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      model_name TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('web', 'cli')),
      state_encrypted BLOB,
      last_used_at INTEGER,
      available INTEGER DEFAULT 1
    );

    -- API Keys
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT UNIQUE NOT NULL,
      name TEXT,
      allow_models TEXT,
      rate_limit_rpm INTEGER,
      rate_limit_daily INTEGER,
      created_at INTEGER,
      last_used_at INTEGER,
      revoked INTEGER DEFAULT 0
    );

    -- Call logs
    CREATE TABLE IF NOT EXISTS call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id TEXT,
      model TEXT,
      protocol TEXT CHECK(protocol IN ('openai', 'anthropic')),
      status TEXT CHECK(status IN ('success', 'error', 'timeout')),
      cost_usd REAL,
      duration_ms INTEGER,
      created_at INTEGER
    );

    -- Model configurations
    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      config_json TEXT,
      updated_at INTEGER
    );

    -- Adapter versions for自愈
    CREATE TABLE IF NOT EXISTS adapter_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      version TEXT NOT NULL,
      selectors_json TEXT,
      created_at INTEGER
    );

    -- Comparison sessions for multi-model comparison
    CREATE TABLE IF NOT EXISTS comparison_sessions (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      models_json TEXT NOT NULL,
      system_prompt TEXT,
      temperature REAL,
      max_tokens INTEGER,
      status TEXT CHECK(status IN ('running', 'completed', 'failed')) DEFAULT 'running',
      created_at INTEGER,
      completed_at INTEGER,
      error_message TEXT
    );

    -- Individual comparison results within a session
    CREATE TABLE IF NOT EXISTS comparison_results (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      content TEXT,
      finish_reason TEXT,
      usage_json TEXT,
      cost_usd REAL,
      duration_ms INTEGER,
      status TEXT CHECK(status IN ('success', 'error', 'timeout')) DEFAULT 'success',
      error_message TEXT,
      created_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES comparison_sessions(id) ON DELETE CASCADE
    );

    -- Debate sessions for multi-model debates
    CREATE TABLE IF NOT EXISTS debate_sessions (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      models_json TEXT NOT NULL,
      positions_json TEXT NOT NULL,
      rounds INTEGER DEFAULT 3,
      system_prompt TEXT,
      temperature REAL,
      max_tokens INTEGER,
      status TEXT CHECK(status IN ('running', 'completed', 'failed')) DEFAULT 'running',
      current_round INTEGER DEFAULT 0,
      created_at INTEGER,
      completed_at INTEGER,
      error_message TEXT
    );

    -- Debate rounds within a session
    CREATE TABLE IF NOT EXISTS debate_rounds (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      created_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES debate_sessions(id) ON DELETE CASCADE
    );

    -- Individual arguments within a debate round
    CREATE TABLE IF NOT EXISTS debate_arguments (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL,
      model TEXT NOT NULL,
      position TEXT NOT NULL,
      content TEXT,
      duration_ms INTEGER,
      status TEXT CHECK(status IN ('success', 'error', 'timeout')) DEFAULT 'success',
      error_message TEXT,
      created_at INTEGER,
      FOREIGN KEY (round_id) REFERENCES debate_rounds(id) ON DELETE CASCADE
    );

    -- Collaboration tasks for multi-model collaboration
    CREATE TABLE IF NOT EXISTS collaboration_tasks (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      models_json TEXT NOT NULL,
      workflow TEXT CHECK(workflow IN ('sequential', 'parallel', 'voting')) NOT NULL,
      steps_json TEXT,
      status TEXT CHECK(status IN ('running', 'completed', 'failed')) DEFAULT 'running',
      current_step INTEGER DEFAULT 0,
      result TEXT,
      created_at INTEGER,
      completed_at INTEGER,
      error_message TEXT
    );

    -- Steps within a collaboration task
    CREATE TABLE IF NOT EXISTS collaboration_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      description TEXT NOT NULL,
      assigned_models TEXT,
      status TEXT CHECK(status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
      created_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (task_id) REFERENCES collaboration_tasks(id) ON DELETE CASCADE
    );

    -- Outputs from individual models within a step
    CREATE TABLE IF NOT EXISTS collaboration_outputs (
      id TEXT PRIMARY KEY,
      step_id TEXT NOT NULL,
      model TEXT NOT NULL,
      content TEXT,
      duration_ms INTEGER,
      status TEXT CHECK(status IN ('success', 'error', 'timeout')) DEFAULT 'success',
      error_message TEXT,
      created_at INTEGER,
      FOREIGN KEY (step_id) REFERENCES collaboration_steps(id) ON DELETE CASCADE
    );
  `);

  // Insert default model configs if not exists
  const defaultModels = [
    { id: 'chatgpt', name: 'ChatGPT', type: 'web' },
    { id: 'claude-web', name: 'Claude Web', type: 'web' },
    { id: 'claude-code', name: 'Claude Code CLI', type: 'cli' },
    { id: 'deepseek', name: 'DeepSeek', type: 'web' },
    { id: 'qwen', name: '通义千问', type: 'web' },
    { id: 'glm', name: '智谱清言', type: 'web' },
    { id: 'kimi', name: 'Kimi', type: 'web' },
    { id: 'doubao', name: '豆包', type: 'web' },
    { id: 'yuanbao', name: '腾讯元宝', type: 'web' },
    { id: 'yiyan', name: '文心一言', type: 'web' },
    { id: 'xinghuo', name: '讯飞星火', type: 'web' },
    { id: 'hailuo', name: '海螺 AI', type: 'web' },
    { id: 'coze', name: 'Coze', type: 'web' },
    { id: 'metaso', name: '秘塔 AI', type: 'web' },
    { id: 'tiangong', name: '天工 AI', type: 'web' },
    { id: 'wxiaobai', name: '问小白', type: 'web' },
    { id: 'nano', name: '纳米 AI', type: 'web' },
    { id: 'boai', name: '波尔 AI', type: 'web' }
  ];

  const insertConfig = db.prepare(`
    INSERT OR IGNORE INTO model_configs (id, name, type, enabled, config_json, updated_at)
    VALUES (?, ?, ?, 1, '{}', ?)
  `);

  const now = Date.now();
  for (const model of defaultModels) {
    insertConfig.run(model.id, model.name, model.type, now);
  }

  console.log('Database initialized at:', DB_PATH);
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
