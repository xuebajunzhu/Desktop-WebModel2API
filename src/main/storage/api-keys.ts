import crypto from 'crypto';
import { getDatabase } from './database';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits

// Generate a machine-specific key for encryption
function getEncryptionKey(): Buffer {
  // Use a combination of machine identifiers
  const machineId = process.platform + '-' + process.arch + '-' + process.env.COMPUTERNAME || 'unknown';
  return crypto.createHash('sha256').update(machineId).digest().slice(0, KEY_LENGTH);
}

export function encrypt(data: string): { encrypted: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag
  };
}

export function decrypt(encrypted: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// API Key management
export interface ApiKeyRecord {
  id: string;
  key_hash: string;
  name: string | null;
  allow_models: string | null;
  rate_limit_rpm: number | null;
  rate_limit_daily: number | null;
  created_at: number;
  last_used_at: number | null;
  revoked: number;
}

export interface ApiKeyInfo {
  id: string;
  key: string;
  name: string | null;
  allow_models: string[];
  rate_limit_rpm: number | null;
  rate_limit_daily: number | null;
}

export function generateApiKey(): string {
  return 'sk-web2api-' + crypto.randomBytes(24).toString('hex');
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function createApiKey(name: string | null, options?: {
  allow_models?: string[];
  rate_limit_rpm?: number;
  rate_limit_daily?: number;
}): Promise<ApiKeyInfo> {
  const db = getDatabase();
  const key = generateApiKey();
  const keyHash = hashApiKey(key);
  const id = crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  
  const allowModelsJson = options?.allow_models ? JSON.stringify(options.allow_models) : null;
  
  const stmt = db.prepare(`
    INSERT INTO api_keys (id, key_hash, name, allow_models, rate_limit_rpm, rate_limit_daily, created_at, last_used_at, revoked)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)
  `);
  
  stmt.run(id, keyHash, name, allowModelsJson, options?.rate_limit_rpm || null, options?.rate_limit_daily || null, now);
  
  return {
    id,
    key,
    name,
    allow_models: options?.allow_models || [],
    rate_limit_rpm: options?.rate_limit_rpm || null,
    rate_limit_daily: options?.rate_limit_daily || null
  };
}

export async function validateApiKey(key: string): Promise<boolean> {
  const db = getDatabase();
  const keyHash = hashApiKey(key);
  
  const stmt = db.prepare('SELECT id, revoked FROM api_keys WHERE key_hash = ?');
  const result = stmt.get(keyHash) as { id: string; revoked: number } | undefined;
  
  if (!result || result.revoked === 1) {
    return false;
  }
  
  // Update last_used_at
  const updateStmt = db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?');
  updateStmt.run(Date.now(), result.id);
  
  return true;
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC');
  return stmt.all() as ApiKeyRecord[];
}

export async function revokeApiKey(keyId: string): Promise<void> {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?');
  stmt.run(keyId);
}

export async function deleteApiKey(keyId: string): Promise<void> {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM api_keys WHERE id = ?');
  stmt.run(keyId);
}

// Initialize a default API key if none exists
export async function ensureDefaultApiKey(): Promise<string> {
  const db = getDatabase();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE revoked = 0');
  const result = stmt.get() as { count: number };
  
  if (result.count === 0) {
    const keyInfo = await createApiKey('Default Key');
    return keyInfo.key;
  }
  
  // Return existing key (in production, you'd want to handle this differently)
  return 'Default key already exists';
}
