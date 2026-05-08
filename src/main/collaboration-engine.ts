import { v4 as uuidv4 } from 'uuid';
import { TaskScheduler, InternalRequest, InternalResponse } from './scheduler';
import { BrowserPool } from './browser-pool';
import { CliManager } from './cli-manager';
import { getDatabase } from './storage/database';

// ==================== 辩论相关类型 ====================

export interface DebateSession {
  id: string;
  topic: string;
  models: string[];
  positions: Record<string, string>; // model -> position (e.g., "支持", "反对")
  rounds: number;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  status: 'running' | 'completed' | 'failed';
  currentRound: number;
  createdAt: number;
  completedAt?: number;
  errorMessage?: string;
}

export interface DebateRound {
  id: string;
  sessionId: string;
  roundNumber: number;
  arguments: DebateArgument[];
  createdAt: number;
}

export interface DebateArgument {
  id: string;
  roundId: string;
  model: string;
  position: string;
  content: string;
  references?: string[]; // 引用之前的论点 ID
  durationMs: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  createdAt: number;
}

export interface DebateRequest {
  topic: string;
  models: string[];
  positions: Record<string, string>; // 每个模型的立场
  rounds?: number;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface DebateResponse {
  session: DebateSession;
  rounds: DebateRound[];
  summary?: string;
}

// ==================== 协作相关类型 ====================

export interface CollaborationTask {
  id: string;
  goal: string;
  models: string[];
  workflow: 'sequential' | 'parallel' | 'voting';
  steps?: CollaborationStep[];
  status: 'running' | 'completed' | 'failed';
  currentStep: number;
  createdAt: number;
  completedAt?: number;
  result?: string;
  errorMessage?: string;
}

export interface CollaborationStep {
  id: string;
  taskId: string;
  stepNumber: number;
  description: string;
  assignedModels: string[];
  outputs: CollaborationOutput[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}

export interface CollaborationOutput {
  id: string;
  stepId: string;
  model: string;
  content: string;
  durationMs: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  createdAt: number;
}

export interface CollaborationRequest {
  goal: string;
  models: string[];
  workflow: 'sequential' | 'parallel' | 'voting';
  steps?: Array<{
    description: string;
    assignedModels?: string[];
  }>;
  temperature?: number;
  maxTokens?: number;
}

export interface CollaborationResponse {
  task: CollaborationTask;
  steps: CollaborationStep[];
  finalResult?: string;
}

// ==================== 协作引擎类 ====================

export class CollaborationEngine {
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

  // ==================== 辩论功能 ====================

  async startDebate(request: DebateRequest): Promise<DebateResponse> {
    const sessionId = `deb-${uuidv4()}`;
    const db = getDatabase();

    // 验证请求
    if (!request.topic || !request.models || request.models.length < 2) {
      throw new Error('至少需要 2 个模型进行辩论');
    }
    if (!request.positions || Object.keys(request.positions).length < 2) {
      throw new Error('至少需要为 2 个模型分配立场');
    }

    const roundsCount = request.rounds || 3;

    // 创建辩论会话
    const session: DebateSession = {
      id: sessionId,
      topic: request.topic,
      models: request.models,
      positions: request.positions,
      rounds: roundsCount,
      systemPrompt: request.systemPrompt,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      status: 'running',
      currentRound: 0,
      createdAt: Date.now()
    };

    const insertSession = db.prepare(`
      INSERT INTO debate_sessions 
      (id, topic, models_json, positions_json, rounds, system_prompt, temperature, max_tokens, status, current_round, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', 0, ?)
    `);

    insertSession.run(
      sessionId,
      request.topic,
      JSON.stringify(request.models),
      JSON.stringify(request.positions),
      roundsCount,
      request.systemPrompt || null,
      request.temperature || null,
      request.maxTokens || null,
      Date.now()
    );

    const allRounds: DebateRound[] = [];

    // 执行多轮辩论
    for (let roundNum = 1; roundNum <= roundsCount; roundNum++) {
      session.currentRound = roundNum;
      
      const roundId = `round-${uuidv4()}`;
      const round: DebateRound = {
        id: roundId,
        sessionId,
        roundNumber: roundNum,
        arguments: [],
        createdAt: Date.now()
      };

      // 保存轮次记录
      const insertRound = db.prepare(`
        INSERT INTO debate_rounds (id, session_id, round_number, created_at)
        VALUES (?, ?, ?, ?)
      `);
      insertRound.run(roundId, sessionId, roundNum, Date.now());

      const argumentsPromises = request.models.map(async (modelId) => {
        const argumentId = `arg-${uuidv4()}`;
        const startTime = Date.now();
        const position = request.positions[modelId] || '中立';

        try {
          // 构建上下文：获取之前所有轮次的论点
          const previousArguments = await this.getDebateArguments(sessionId, roundNum - 1);
          
          let contextPrompt = `辩论主题：${request.topic}\n`;
          contextPrompt += `你的立场：${position}\n`;
          contextPrompt += `当前轮次：${roundNum}/${roundsCount}\n\n`;

          if (previousArguments.length > 0) {
            contextPrompt += '之前的论点：\n';
            previousArguments.forEach((arg, idx) => {
              contextPrompt += `${idx + 1}. [${arg.model}] (${arg.position}): ${arg.content.substring(0, 200)}...\n`;
            });
            contextPrompt += '\n请基于以上论点，进一步阐述你的观点，可以反驳对方或补充论证。\n';
          } else {
            contextPrompt += '请阐述你的观点和论据。\n';
          }

          const internalRequest: InternalRequest = {
            model: modelId,
            messages: [
              ...(request.systemPrompt ? [{ role: 'system' as const, content: request.systemPrompt }] : []),
              { role: 'user' as const, content: contextPrompt }
            ],
            temperature: request.temperature,
            max_tokens: request.maxTokens
          };

          let response: InternalResponse;
          if (modelId === 'claude-code') {
            response = await this.cliManager.execute(internalRequest, {});
          } else {
            response = await this.taskScheduler.executeTask(internalRequest, this.browserPool);
          }

          const argument: DebateArgument = {
            id: argumentId,
            roundId,
            model: modelId,
            position,
            content: response.content,
            durationMs: Date.now() - startTime,
            status: 'success',
            createdAt: Date.now()
          };

          this.saveDebateArgument(argument);
          return argument;
        } catch (error: any) {
          const errorArgument: DebateArgument = {
            id: argumentId,
            roundId,
            model: modelId,
            position,
            content: '',
            durationMs: Date.now() - startTime,
            status: 'error',
            errorMessage: error.message,
            createdAt: Date.now()
          };
          this.saveDebateArgument(errorArgument);
          return errorArgument;
        }
      });

      const roundArguments = await Promise.all(argumentsPromises);
      round.arguments = roundArguments;
      allRounds.push(round);

      // 更新当前轮次
      const updateSession = db.prepare(`
        UPDATE debate_sessions SET current_round = ? WHERE id = ?
      `);
      updateSession.run(roundNum, sessionId);
    }

    // 生成辩论总结
    let summary: string | undefined;
    try {
      const allArguments = await this.getDebateArguments(sessionId, roundsCount);
      summary = await this.generateDebateSummary(request.topic, allArguments);
      
      const updateSession = db.prepare(`
        UPDATE debate_sessions 
        SET status = 'completed', completed_at = ?
        WHERE id = ?
      `);
      updateSession.run(Date.now(), sessionId);
      session.status = 'completed';
      session.completedAt = Date.now();
    } catch (error: any) {
      const updateSession = db.prepare(`
        UPDATE debate_sessions 
        SET status = 'failed', completed_at = ?, error_message = ?
        WHERE id = ?
      `);
      updateSession.run(Date.now(), error.message, sessionId);
      session.status = 'failed';
      session.completedAt = Date.now();
      session.errorMessage = error.message;
    }

    return {
      session,
      rounds: allRounds,
      summary
    };
  }

  private async generateDebateSummary(topic: string, arguments: DebateArgument[]): Promise<string> {
    // 使用第一个成功的模型来生成总结
    const successfulArg = arguments.find(arg => arg.status === 'success' && arg.content.length > 0);
    if (!successfulArg) {
      return '无法生成总结：没有成功的论点';
    }

    const summaryPrompt = `请为以下辩论生成一个客观中立的总结：

辩论主题：${topic}

论点列表：
${arguments.filter(a => a.status === 'success').map((a, i) => 
  `${i + 1}. [${a.model}] (${a.position}): ${a.content.substring(0, 300)}`
).join('\n')}

请总结：
1. 各方的主要观点
2. 核心分歧点
3. 可能的共识
4. 未解决的问题

总结应简洁明了，不超过 500 字。`;

    const internalRequest: InternalRequest = {
      model: successfulArg.model,
      messages: [
        { role: 'user' as const, content: summaryPrompt }
      ],
      temperature: 0.7
    };

    let response: InternalResponse;
    if (successfulArg.model === 'claude-code') {
      response = await this.cliManager.execute(internalRequest, {});
    } else {
      response = await this.taskScheduler.executeTask(internalRequest, this.browserPool);
    }

    return response.content;
  }

  private saveDebateArgument(argument: DebateArgument): void {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO debate_arguments 
      (id, round_id, model, position, content, duration_ms, status, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      argument.id,
      argument.roundId,
      argument.model,
      argument.position,
      argument.content || null,
      argument.durationMs,
      argument.status,
      argument.errorMessage || null,
      argument.createdAt
    );
  }

  async getDebateSession(sessionId: string): Promise<DebateSession | null> {
    const db = getDatabase();
    const select = db.prepare('SELECT * FROM debate_sessions WHERE id = ?');
    const row: any = select.get(sessionId);

    if (!row) return null;

    return {
      id: row.id,
      topic: row.topic,
      models: JSON.parse(row.models_json),
      positions: JSON.parse(row.positions_json),
      rounds: row.rounds,
      systemPrompt: row.system_prompt,
      temperature: row.temperature,
      maxTokens: row.max_tokens,
      status: row.status,
      currentRound: row.current_round,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message
    };
  }

  async getDebateArguments(sessionId: string, upToRound?: number): Promise<DebateArgument[]> {
    const db = getDatabase();
    
    let query = `
      SELECT da.* FROM debate_arguments da
      JOIN debate_rounds dr ON da.round_id = dr.id
      WHERE dr.session_id = ?
    `;
    
    const params: any[] = [sessionId];
    
    if (upToRound) {
      query += ' AND dr.round_number <= ?';
      params.push(upToRound);
    }
    
    query += ' ORDER BY dr.round_number, da.created_at';
    
    const select = db.prepare(query);
    const rows: any[] = select.all(...params);

    return rows.map(row => ({
      id: row.id,
      roundId: row.round_id,
      model: row.model,
      position: row.position,
      content: row.content || '',
      durationMs: row.duration_ms,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at
    }));
  }

  async listDebateSessions(limit: number = 50, offset: number = 0): Promise<DebateSession[]> {
    const db = getDatabase();
    const select = db.prepare(
      'SELECT * FROM debate_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?'
    );
    const rows: any[] = select.all(limit, offset);

    return rows.map(row => ({
      id: row.id,
      topic: row.topic,
      models: JSON.parse(row.models_json),
      positions: JSON.parse(row.positions_json),
      rounds: row.rounds,
      systemPrompt: row.system_prompt,
      temperature: row.temperature,
      maxTokens: row.max_tokens,
      status: row.status,
      currentRound: row.current_round,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message
    }));
  }

  async deleteDebateSession(sessionId: string): Promise<boolean> {
    const db = getDatabase();
    const del = db.prepare('DELETE FROM debate_sessions WHERE id = ?');
    const result = del.run(sessionId);
    return result.changes > 0;
  }

  // ==================== 协作功能 ====================

  async startCollaboration(request: CollaborationRequest): Promise<CollaborationResponse> {
    const taskId = `col-${uuidv4()}`;
    const db = getDatabase();

    // 验证请求
    if (!request.goal || !request.models || request.models.length < 1) {
      throw new Error('至少需要 1 个模型进行协作');
    }

    const workflow = request.workflow;
    let steps: CollaborationStep[] = [];

    // 根据工作流类型生成步骤
    if (request.steps && request.steps.length > 0) {
      // 用户自定义步骤
      steps = request.steps.map((step, index) => ({
        id: `step-${uuidv4()}`,
        taskId,
        stepNumber: index + 1,
        description: step.description,
        assignedModels: step.assignedModels || request.models,
        outputs: [],
        status: 'pending' as const,
        createdAt: Date.now()
      }));
    } else {
      // 自动生成步骤
      if (workflow === 'sequential') {
        steps = [
          {
            id: `step-${uuidv4()}`,
            taskId,
            stepNumber: 1,
            description: '分析任务并制定计划',
            assignedModels: [request.models[0]],
            outputs: [],
            status: 'pending' as const,
            createdAt: Date.now()
          },
          {
            id: `step-${uuidv4()}`,
            taskId,
            stepNumber: 2,
            description: '执行任务',
            assignedModels: request.models,
            outputs: [],
            status: 'pending' as const,
            createdAt: Date.now()
          },
          {
            id: `step-${uuidv4()}`,
            taskId,
            stepNumber: 3,
            description: '汇总结果并输出最终答案',
            assignedModels: [request.models[0]],
            outputs: [],
            status: 'pending' as const,
            createdAt: Date.now()
          }
        ];
      } else if (workflow === 'parallel') {
        steps = [
          {
            id: `step-${uuidv4()}`,
            taskId,
            stepNumber: 1,
            description: '并行独立分析',
            assignedModels: request.models,
            outputs: [],
            status: 'pending' as const,
            createdAt: Date.now()
          },
          {
            id: `step-${uuidv4()}`,
            taskId,
            stepNumber: 2,
            description: '整合所有分析结果',
            assignedModels: [request.models[0]],
            outputs: [],
            status: 'pending' as const,
            createdAt: Date.now()
          }
        ];
      } else if (workflow === 'voting') {
        steps = [
          {
            id: `step-${uuidv4()}`,
            taskId,
            stepNumber: 1,
            description: '各自给出答案',
            assignedModels: request.models,
            outputs: [],
            status: 'pending' as const,
            createdAt: Date.now()
          },
          {
            id: `step-${uuidv4()}`,
            taskId,
            stepNumber: 2,
            description: '互相评估并投票',
            assignedModels: request.models,
            outputs: [],
            status: 'pending' as const,
            createdAt: Date.now()
          },
          {
            id: `step-${uuidv4()}`,
            taskId,
            stepNumber: 3,
            description: '根据投票结果确定最终答案',
            assignedModels: [request.models[0]],
            outputs: [],
            status: 'pending' as const,
            createdAt: Date.now()
          }
        ];
      }
    }

    // 创建协作任务
    const task: CollaborationTask = {
      id: taskId,
      goal: request.goal,
      models: request.models,
      workflow,
      steps,
      status: 'running',
      currentStep: 0,
      createdAt: Date.now()
    };

    const insertTask = db.prepare(`
      INSERT INTO collaboration_tasks 
      (id, goal, models_json, workflow, steps_json, status, current_step, created_at)
      VALUES (?, ?, ?, ?, ?, 'running', 0, ?)
    `);

    insertTask.run(
      taskId,
      request.goal,
      JSON.stringify(request.models),
      workflow,
      JSON.stringify(steps.map(s => ({ id: s.id, stepNumber: s.stepNumber, description: s.description, assignedModels: s.assignedModels }))),
      Date.now()
    );

    // 执行各个步骤
    let finalResult: string | undefined;

    for (const step of steps) {
      task.currentStep = step.stepNumber;
      step.status = 'running';

      const updateStep = db.prepare(`
        UPDATE collaboration_steps SET status = 'running' WHERE id = ?
      `);
      updateStep.run(step.id);

      const updateTask = db.prepare(`
        UPDATE collaboration_tasks SET current_step = ? WHERE id = ?
      `);
      updateTask.run(step.stepNumber, taskId);

      // 执行当前步骤的所有模型
      const outputsPromises = step.assignedModels.map(async (modelId) => {
        const outputId = `out-${uuidv4()}`;
        const startTime = Date.now();

        try {
          // 构建上下文
          let contextPrompt = `任务目标：${request.goal}\n`;
          contextPrompt += `当前步骤：${step.stepNumber}/${steps.length}\n`;
          contextPrompt += `步骤描述：${step.description}\n\n`;

          // 添加之前步骤的输出作为上下文
          const previousOutputs = await this.getCollaborationOutputs(taskId, step.stepNumber - 1);
          if (previousOutputs.length > 0) {
            contextPrompt += '之前的输出：\n';
            previousOutputs.forEach((out, idx) => {
              contextPrompt += `${idx + 1}. [${out.model}]: ${out.content.substring(0, 200)}...\n`;
            });
            contextPrompt += '\n';
          }

          if (workflow === 'voting' && step.stepNumber === 2) {
            // 投票阶段：提供所有答案供评估
            const step1Outputs = await this.getCollaborationOutputsForStep(steps[0].id);
            contextPrompt += '请评估以下答案并投票：\n\n';
            step1Outputs.forEach((out, idx) => {
              contextPrompt += `答案 ${idx + 1} (由 ${out.model} 提供):\n${out.content}\n\n`;
            });
            contextPrompt += '请对每个答案进行评分 (1-10 分)，并说明理由。最后指出你认为最好的答案。';
          }

          const internalRequest: InternalRequest = {
            model: modelId,
            messages: [
              { role: 'user' as const, content: contextPrompt }
            ],
            temperature: request.temperature,
            max_tokens: request.maxTokens
          };

          let response: InternalResponse;
          if (modelId === 'claude-code') {
            response = await this.cliManager.execute(internalRequest, {});
          } else {
            response = await this.taskScheduler.executeTask(internalRequest, this.browserPool);
          }

          const output: CollaborationOutput = {
            id: outputId,
            stepId: step.id,
            model: modelId,
            content: response.content,
            durationMs: Date.now() - startTime,
            status: 'success',
            createdAt: Date.now()
          };

          this.saveCollaborationOutput(output);
          return output;
        } catch (error: any) {
          const errorOutput: CollaborationOutput = {
            id: outputId,
            stepId: step.id,
            model: modelId,
            content: '',
            durationMs: Date.now() - startTime,
            status: 'error',
            errorMessage: error.message,
            createdAt: Date.now()
          };
          this.saveCollaborationOutput(errorOutput);
          return errorOutput;
        }
      });

      const stepOutputs = await Promise.all(outputsPromises);
      step.outputs = stepOutputs;

      // 更新步骤状态
      const hasError = stepOutputs.some(o => o.status === 'error');
      step.status = hasError ? 'failed' : 'completed';
      step.completedAt = Date.now();

      const updateStepComplete = db.prepare(`
        UPDATE collaboration_steps 
        SET status = ?, completed_at = ?
        WHERE id = ?
      `);
      updateStepComplete.run(step.status, step.completedAt, step.id);

      // 如果是最后一步，生成最终结果
      if (step.stepNumber === steps.length) {
        try {
          finalResult = await this.generateCollaborationResult(request.goal, stepOutputs);
        } catch (error: any) {
          finalResult = `协作完成，但生成最终结果时出错：${error.message}`;
        }
      }
    }

    // 更新任务状态
    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = finalResult;

    const updateTaskComplete = db.prepare(`
      UPDATE collaboration_tasks 
      SET status = 'completed', completed_at = ?, result = ?
      WHERE id = ?
    `);
    updateTaskComplete.run(Date.now(), finalResult || null, taskId);

    // 重新获取完整的步骤列表
    const completeSteps = await this.getCollaborationSteps(taskId);

    return {
      task,
      steps: completeSteps,
      finalResult
    };
  }

  private async generateCollaborationResult(goal: string, outputs: CollaborationOutput[]): Promise<string> {
    const successfulOutputs = outputs.filter(o => o.status === 'success' && o.content.length > 0);
    
    if (successfulOutputs.length === 0) {
      return '无法生成结果：没有成功的输出';
    }

    const resultPrompt = `请基于以下协作输出，生成最终结果：

任务目标：${goal}

协作输出：
${successfulOutputs.map((o, i) => 
  `${i + 1}. [${o.model}]:\n${o.content.substring(0, 500)}`
).join('\n\n')}

请综合以上所有输出，生成一个完整、一致的最终结果。结果应该清晰、有条理，并直接回应任务目标。`;

    const internalRequest: InternalRequest = {
      model: successfulOutputs[0].model,
      messages: [
        { role: 'user' as const, content: resultPrompt }
      ],
      temperature: 0.7
    };

    let response: InternalResponse;
    if (successfulOutputs[0].model === 'claude-code') {
      response = await this.cliManager.execute(internalRequest, {});
    } else {
      response = await this.taskScheduler.executeTask(internalRequest, this.browserPool);
    }

    return response.content;
  }

  private saveCollaborationOutput(output: CollaborationOutput): void {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO collaboration_outputs 
      (id, step_id, model, content, duration_ms, status, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      output.id,
      output.stepId,
      output.model,
      output.content || null,
      output.durationMs,
      output.status,
      output.errorMessage || null,
      output.createdAt
    );
  }

  async getCollaborationTask(taskId: string): Promise<CollaborationTask | null> {
    const db = getDatabase();
    const select = db.prepare('SELECT * FROM collaboration_tasks WHERE id = ?');
    const row: any = select.get(taskId);

    if (!row) return null;

    return {
      id: row.id,
      goal: row.goal,
      models: JSON.parse(row.models_json),
      workflow: row.workflow,
      steps: row.steps_json ? JSON.parse(row.steps_json) : [],
      status: row.status,
      currentStep: row.current_step,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      result: row.result,
      errorMessage: row.error_message
    };
  }

  async getCollaborationSteps(taskId: string): Promise<CollaborationStep[]> {
    const db = getDatabase();
    const select = db.prepare(
      'SELECT * FROM collaboration_steps WHERE task_id = ? ORDER BY step_number'
    );
    const rows: any[] = select.all(taskId);

    const steps: CollaborationStep[] = [];
    for (const row of rows) {
      const outputs = await this.getCollaborationOutputsForStep(row.id);
      steps.push({
        id: row.id,
        taskId: row.task_id,
        stepNumber: row.step_number,
        description: row.description,
        assignedModels: row.assigned_models ? JSON.parse(row.assigned_models) : [],
        outputs,
        status: row.status,
        createdAt: row.created_at,
        completedAt: row.completed_at
      });
    }

    return steps;
  }

  async getCollaborationOutputs(taskId: string, upToStep?: number): Promise<CollaborationOutput[]> {
    const db = getDatabase();
    
    let query = `
      SELECT co.* FROM collaboration_outputs co
      JOIN collaboration_steps cs ON co.step_id = cs.id
      WHERE cs.task_id = ?
    `;
    
    const params: any[] = [taskId];
    
    if (upToStep) {
      query += ' AND cs.step_number <= ?';
      params.push(upToStep);
    }
    
    query += ' ORDER BY cs.step_number, co.created_at';
    
    const select = db.prepare(query);
    const rows: any[] = select.all(...params);

    return rows.map(row => ({
      id: row.id,
      stepId: row.step_id,
      model: row.model,
      content: row.content || '',
      durationMs: row.duration_ms,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at
    }));
  }

  async getCollaborationOutputsForStep(stepId: string): Promise<CollaborationOutput[]> {
    const db = getDatabase();
    const select = db.prepare(
      'SELECT * FROM collaboration_outputs WHERE step_id = ? ORDER BY created_at'
    );
    const rows: any[] = select.all(stepId);

    return rows.map(row => ({
      id: row.id,
      stepId: row.step_id,
      model: row.model,
      content: row.content || '',
      durationMs: row.duration_ms,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at
    }));
  }

  async listCollaborationTasks(limit: number = 50, offset: number = 0): Promise<CollaborationTask[]> {
    const db = getDatabase();
    const select = db.prepare(
      'SELECT * FROM collaboration_tasks ORDER BY created_at DESC LIMIT ? OFFSET ?'
    );
    const rows: any[] = select.all(limit, offset);

    return rows.map(row => ({
      id: row.id,
      goal: row.goal,
      models: JSON.parse(row.models_json),
      workflow: row.workflow,
      steps: row.steps_json ? JSON.parse(row.steps_json) : [],
      status: row.status,
      currentStep: row.current_step,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      result: row.result,
      errorMessage: row.error_message
    }));
  }

  async deleteCollaborationTask(taskId: string): Promise<boolean> {
    const db = getDatabase();
    const del = db.prepare('DELETE FROM collaboration_tasks WHERE id = ?');
    const result = del.run(taskId);
    return result.changes > 0;
  }
}
