import { v4 as uuidv4 } from 'uuid';
import { TaskScheduler, InternalRequest, InternalResponse } from './scheduler';
import { BrowserPool } from './browser-pool';
import { CliManager } from './cli-manager';
import { getDatabase } from './storage/database';

export interface ComparisonSession {
  id: string;
  prompt: string;
  models: string[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  status: 'running' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
  errorMessage?: string;
}

export interface ComparisonResult {
  id: string;
  sessionId: string;
  model: string;
  content: string;
  finishReason?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  costUsd?: number;
  durationMs: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  createdAt: number;
}

export interface ComparisonRequest {
  prompt: string;
  models: string[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ComparisonResponse {
  session: ComparisonSession;
  results: ComparisonResult[];
}

export class ComparisonEngine {
  private taskScheduler: TaskScheduler;
  private browserPool: BrowserPool;
  private cliManager: CliManager;

  constructor(
    taskScheduler: TaskScheduler,
    browserPool: BrowserPool,
    cliManager: CliManager
  ) {
    this.taskScheduler = taskScheduler;
    this.browserPool = browserPool;
    this.cliManager = cliManager;
  }

  async runComparison(request: ComparisonRequest): Promise<ComparisonResponse> {
    const sessionId = `cmp-${uuidv4()}`;
    const db = getDatabase();

    // Create session record
    const session: ComparisonSession = {
      id: sessionId,
      prompt: request.prompt,
      models: request.models,
      systemPrompt: request.systemPrompt,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      status: 'running',
      createdAt: Date.now()
    };

    const insertSession = db.prepare(`
      INSERT INTO comparison_sessions 
      (id, prompt, models_json, system_prompt, temperature, max_tokens, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
    `);

    insertSession.run(
      sessionId,
      request.prompt,
      JSON.stringify(request.models),
      request.systemPrompt || null,
      request.temperature || null,
      request.maxTokens || null,
      Date.now()
    );

    const results: ComparisonResult[] = [];
    let hasError = false;
    let errorMessage: string | undefined;

    // Execute all models in parallel
    const promises = request.models.map(async (modelId) => {
      const resultId = `res-${uuidv4()}`;
      const startTime = Date.now();

      try {
        const internalRequest: InternalRequest = {
          model: modelId,
          messages: [
            ...(request.systemPrompt ? [{ role: 'system' as const, content: request.systemPrompt }] : []),
            { role: 'user' as const, content: request.prompt }
          ],
          temperature: request.temperature,
          max_tokens: request.maxTokens
        };

        let response: InternalResponse;

        // Use CLI manager for Claude Code, otherwise use task scheduler
        if (modelId === 'claude-code') {
          response = await this.cliManager.execute(internalRequest, {});
        } else {
          response = await this.taskScheduler.executeTask(internalRequest, this.browserPool);
        }

        const result: ComparisonResult = {
          id: resultId,
          sessionId,
          model: modelId,
          content: response.content,
          finishReason: response.finish_reason,
          usage: response.usage,
          costUsd: response.cost_usd,
          durationMs: Date.now() - startTime,
          status: 'success',
          createdAt: Date.now()
        };

        // Save to database
        this.saveResult(result);

        return result;
      } catch (error: any) {
        const errorResult: ComparisonResult = {
          id: resultId,
          sessionId,
          model: modelId,
          content: '',
          durationMs: Date.now() - startTime,
          status: 'error',
          errorMessage: error.message,
          createdAt: Date.now()
        };

        this.saveResult(errorResult);
        hasError = true;
        if (!errorMessage) {
          errorMessage = `Model ${modelId}: ${error.message}`;
        } else {
          errorMessage += `; ${modelId}: ${error.message}`;
        }

        return errorResult;
      }
    });

    // Wait for all models to complete
    const allResults = await Promise.all(promises);
    results.push(...allResults);

    // Update session status
    const finalStatus: 'completed' | 'failed' = hasError ? 'failed' : 'completed';
    const updateSession = db.prepare(`
      UPDATE comparison_sessions 
      SET status = ?, completed_at = ?, error_message = ?
      WHERE id = ?
    `);
    updateSession.run(finalStatus, Date.now(), errorMessage || null, sessionId);

    session.status = finalStatus;
    session.completedAt = Date.now();
    session.errorMessage = errorMessage;

    return {
      session,
      results
    };
  }

  private saveResult(result: ComparisonResult): void {
    const db = getDatabase();
    const insertResult = db.prepare(`
      INSERT INTO comparison_results 
      (id, session_id, model, content, finish_reason, usage_json, cost_usd, duration_ms, status, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertResult.run(
      result.id,
      result.sessionId,
      result.model,
      result.content || null,
      result.finishReason || null,
      result.usage ? JSON.stringify(result.usage) : null,
      result.costUsd || null,
      result.durationMs,
      result.status,
      result.errorMessage || null,
      result.createdAt
    );
  }

  async getSession(sessionId: string): Promise<ComparisonSession | null> {
    const db = getDatabase();
    const select = db.prepare('SELECT * FROM comparison_sessions WHERE id = ?');
    const row: any = select.get(sessionId);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      prompt: row.prompt,
      models: JSON.parse(row.models_json),
      systemPrompt: row.system_prompt,
      temperature: row.temperature,
      maxTokens: row.max_tokens,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message
    };
  }

  async getSessionResults(sessionId: string): Promise<ComparisonResult[]> {
    const db = getDatabase();
    const select = db.prepare(
      'SELECT * FROM comparison_results WHERE session_id = ? ORDER BY created_at'
    );
    const rows: any[] = select.all(sessionId);

    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      model: row.model,
      content: row.content || '',
      finishReason: row.finish_reason,
      usage: row.usage_json ? JSON.parse(row.usage_json) : undefined,
      costUsd: row.cost_usd,
      durationMs: row.duration_ms,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at
    }));
  }

  async listSessions(limit: number = 50, offset: number = 0): Promise<ComparisonSession[]> {
    const db = getDatabase();
    const select = db.prepare(
      'SELECT * FROM comparison_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?'
    );
    const rows: any[] = select.all(limit, offset);

    return rows.map(row => ({
      id: row.id,
      prompt: row.prompt,
      models: JSON.parse(row.models_json),
      systemPrompt: row.system_prompt,
      temperature: row.temperature,
      maxTokens: row.max_tokens,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message
    }));
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const db = getDatabase();
    const del = db.prepare('DELETE FROM comparison_sessions WHERE id = ?');
    const result = del.run(sessionId);
    return result.changes > 0;
  }
}
