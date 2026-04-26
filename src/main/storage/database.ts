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
