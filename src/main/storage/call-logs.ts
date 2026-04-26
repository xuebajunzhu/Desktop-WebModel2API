import { getDatabase } from './database';

export interface CallLogRecord {
  id?: number;
  api_key_id: string;
  model: string;
  protocol: 'openai' | 'anthropic';
  status: 'success' | 'error' | 'timeout';
  cost_usd?: number | null;
  duration_ms: number;
  created_at?: number;
}

export async function logCall(log: CallLogRecord): Promise<void> {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO call_logs (api_key_id, model, protocol, status, cost_usd, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    log.api_key_id,
    log.model,
    log.protocol,
    log.status,
    log.cost_usd || null,
    log.duration_ms,
    Date.now()
  );
}

export async function getCallLogs(options?: {
  limit?: number;
  model?: string;
  protocol?: string;
  status?: string;
}): Promise<CallLogRecord[]> {
  const db = getDatabase();
  
  let query = 'SELECT * FROM call_logs WHERE 1=1';
  const params: any[] = [];
  
  if (options?.model) {
    query += ' AND model = ?';
    params.push(options.model);
  }
  
  if (options?.protocol) {
    query += ' AND protocol = ?';
    params.push(options.protocol);
  }
  
  if (options?.status) {
    query += ' AND status = ?';
    params.push(options.status);
  }
  
  query += ' ORDER BY created_at DESC';
  
  const limit = options?.limit || 100;
  query += ' LIMIT ?';
  params.push(limit);
  
  const stmt = db.prepare(query);
  return stmt.all(...params) as CallLogRecord[];
}

export async function getCallStats(days?: number): Promise<{
  total_calls: number;
  success_count: number;
  error_count: number;
  avg_duration_ms: number;
  total_cost_usd: number;
}> {
  const db = getDatabase();
  
  let whereClause = '';
  if (days) {
    const since = Date.now() - (days * 24 * 60 * 60 * 1000);
    whereClause = `WHERE created_at >= ${since}`;
  }
  
  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as total_calls,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status = 'error' OR status = 'timeout' THEN 1 ELSE 0 END) as error_count,
      AVG(duration_ms) as avg_duration_ms,
      COALESCE(SUM(cost_usd), 0) as total_cost_usd
    FROM call_logs
    ${whereClause}
  `);
  
  return stmt.get() as any;
}

export async function clearOldLogs(daysOlderThan: number): Promise<void> {
  const db = getDatabase();
  const cutoff = Date.now() - (daysOlderThan * 24 * 60 * 60 * 1000);
  
  const stmt = db.prepare('DELETE FROM call_logs WHERE created_at < ?');
  stmt.run(cutoff);
}
