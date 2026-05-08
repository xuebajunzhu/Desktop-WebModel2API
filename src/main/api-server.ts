import express, { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { TaskScheduler } from './scheduler';
import { BrowserPool } from './browser-pool';
import { CliManager } from './cli-manager';
import { convertFromOpenAI, convertToOpenAI } from './converters/openai';
import { convertFromAnthropic, convertToAnthropic, convertToAnthropicStream } from './converters/anthropic';
import { validateApiKey } from './storage/api-keys';
import { logCall } from './storage/call-logs';
import { ComparisonEngine, ComparisonRequest } from './comparison-engine';
import { CollaborationEngine, DebateRequest, CollaborationRequest } from './collaboration-engine';

const app = express();
const PORT = process.env.WEB2API_PORT || 8899;
const HOST = '127.0.0.1';

app.use(express.json({ limit: '10mb' }));

// Middleware for API key validation with rate limiting
async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['authorization']?.replace('Bearer ', '') 
    || req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key' });
  }

  const validationResult = await validateApiKey(apiKey);
  
  if (!validationResult.valid) {
    if (validationResult.error?.includes('Rate limit')) {
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(validationResult.rateLimit?.resetAt || 0));
      return res.status(429).json({ error: validationResult.error });
    }
    return res.status(403).json({ error: validationResult.error || 'Invalid API key' });
  }

  // Add rate limit headers
  if (validationResult.rateLimit) {
    res.setHeader('X-RateLimit-Remaining', String(validationResult.rateLimit.remaining));
    res.setHeader('X-RateLimit-Reset', String(validationResult.rateLimit.resetAt));
  }
  
  (req as any).apiKey = apiKey;
  next();
}

// Initialize managers
const taskScheduler = new TaskScheduler();
const browserPool = new BrowserPool();
const cliManager = new CliManager();
const comparisonEngine = new ComparisonEngine(taskScheduler, browserPool, cliManager);
const collaborationEngine = new CollaborationEngine(taskScheduler, browserPool, cliManager);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Model list endpoint (OpenAI & Anthropic compatible)
app.get('/v1/models', authMiddleware, async (req, res) => {
  const models = [
    { id: 'chatgpt', name: 'ChatGPT', type: 'web', provider: 'openai' },
    { id: 'claude-web', name: 'Claude Web', type: 'web', provider: 'anthropic' },
    { id: 'claude-code', name: 'Claude Code CLI', type: 'cli', provider: 'anthropic' },
    { id: 'deepseek', name: 'DeepSeek', type: 'web', provider: 'deepseek' },
    { id: 'qwen', name: '通义千问', type: 'web', provider: 'alibaba' },
    { id: 'glm', name: '智谱清言', type: 'web', provider: 'zhipu' },
    { id: 'kimi', name: 'Kimi', type: 'web', provider: 'moonshot' },
    { id: 'doubao', name: '豆包', type: 'web', provider: 'bytedance' },
    { id: 'yuanbao', name: '腾讯元宝', type: 'web', provider: 'tencent' },
    { id: 'yiyan', name: '文心一言', type: 'web', provider: 'baidu' },
    { id: 'xinghuo', name: '讯飞星火', type: 'web', provider: 'iflytek' },
    { id: 'hailuo', name: '海螺 AI', type: 'web', provider: 'minimax' },
    { id: 'coze', name: 'Coze', type: 'web', provider: 'bytedance' },
    { id: 'metaso', name: '秘塔 AI', type: 'web', provider: 'metaso' },
    { id: 'tiangong', name: '天工 AI', type: 'web', provider: 'kunlun' },
    { id: 'wxiaobai', name: '问小白', type: 'web', provider: 'wxiaobai' },
    { id: 'nano', name: '纳米 AI', type: 'web', provider: 'tianrang' },
    { id: 'boai', name: '波尔 AI', type: 'web', provider: 'boai' }
  ];

  res.json({
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model',
      created: Date.now(),
      owned_by: m.provider,
      permission: [],
      root: m.id,
      parent: null
    }))
  });
});

// OpenAI Chat Completions endpoint
app.post('/v1/chat/completions', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  const requestId = `web2api-${uuidv4()}`;
  
  try {
    const openAIRequest = req.body;
    const internalRequest = convertFromOpenAI(openAIRequest);
    
    // Check if it's a Claude Code CLI request
    if (internalRequest.model === 'claude-code') {
      const claudeCodeOptions = (openAIRequest as any).claude_code_options || {};
      const result = await cliManager.execute(internalRequest, claudeCodeOptions);
      
      const response = convertToOpenAI(result, requestId, internalRequest.model);
      
      await logCall({
        apiKeyId: (req as any).apiKey,
        model: internalRequest.model,
        protocol: 'openai',
        status: 'success',
        cost_usd: result.cost_usd || 0,
        duration_ms: Date.now() - startTime
      });
      
      if (internalRequest.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const chunks = convertToOpenAI(result, requestId, internalRequest.model, true);
        for (const chunk of chunks) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.json(response);
      }
    } else {
      // Web-based model
      const result = await taskScheduler.executeTask(internalRequest, browserPool);
      const response = convertToOpenAI(result, requestId, internalRequest.model);
      
      await logCall({
        apiKeyId: (req as any).apiKey,
        model: internalRequest.model,
        protocol: 'openai',
        status: 'success',
        duration_ms: Date.now() - startTime
      });
      
      if (internalRequest.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // Stream the response
        res.write(`data: ${JSON.stringify(response.choices[0])}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.json(response);
      }
    }
  } catch (error: any) {
    await logCall({
      apiKeyId: (req as any).apiKey,
      model: req.body.model,
      protocol: 'openai',
      status: 'error',
      duration_ms: Date.now() - startTime
    });
    
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Anthropic Messages endpoint
app.post('/v1/messages', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  const requestId = `web2api-${uuidv4()}`;
  
  try {
    const anthropicRequest = req.body;
    const internalRequest = convertFromAnthropic(anthropicRequest);
    
    // Check if it's a Claude Code CLI request
    if (internalRequest.model === 'claude-code') {
      const claudeCodeOptions = (anthropicRequest as any).claude_code_options || {};
      const result = await cliManager.execute(internalRequest, claudeCodeOptions);
      
      await logCall({
        apiKeyId: (req as any).apiKey,
        model: internalRequest.model,
        protocol: 'anthropic',
        status: 'success',
        cost_usd: result.cost_usd || 0,
        duration_ms: Date.now() - startTime
      });
      
      if (internalRequest.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const stream = convertToAnthropicStream(result, requestId);
        for (const event of stream) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
        }
        res.end();
      } else {
        res.json(convertToAnthropic(result, requestId));
      }
    } else {
      // Web-based model
      const result = await taskScheduler.executeTask(internalRequest, browserPool);
      
      await logCall({
        apiKeyId: (req as any).apiKey,
        model: internalRequest.model,
        protocol: 'anthropic',
        status: 'success',
        duration_ms: Date.now() - startTime
      });
      
      if (internalRequest.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // Stream the response in Anthropic format
        const stream = convertToAnthropicStream(result, requestId);
        for (const event of stream) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
        }
        res.end();
      } else {
        res.json(convertToAnthropic(result, requestId));
      }
    }
  } catch (error: any) {
    await logCall({
      apiKeyId: (req as any).apiKey,
      model: req.body.model,
      protocol: 'anthropic',
      status: 'error',
      duration_ms: Date.now() - startTime
    });
    
    res.status(500).json({
      error: {
        type: 'error',
        error: {
          type: error.name || 'server_error',
          message: error.message || 'Internal server error'
        }
      }
    });
  }
});

// Multi-model comparison endpoint
app.post('/v1/compare', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const compareRequest: ComparisonRequest = req.body;
    
    // Validate request
    if (!compareRequest.prompt || !compareRequest.models || compareRequest.models.length === 0) {
      return res.status(400).json({ 
        error: { 
          message: 'Missing required fields: prompt and models array', 
          type: 'invalid_request_error' 
        } 
      });
    }
    
    if (compareRequest.models.length > 10) {
      return res.status(400).json({ 
        error: { 
          message: 'Maximum 10 models allowed per comparison', 
          type: 'invalid_request_error' 
        } 
      });
    }
    
    // Run comparison
    const result = await comparisonEngine.runComparison(compareRequest);
    
    res.json({
      session: result.session,
      results: result.results,
      metadata: {
        total_models: compareRequest.models.length,
        successful: result.results.filter(r => r.status === 'success').length,
        failed: result.results.filter(r => r.status !== 'success').length,
        total_duration_ms: Date.now() - startTime
      }
    });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Get comparison session details
app.get('/v1/compare/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await comparisonEngine.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: { message: 'Session not found', type: 'not_found_error' } });
    }
    
    const results = await comparisonEngine.getSessionResults(sessionId);
    
    res.json({ session, results });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// List comparison sessions
app.get('/v1/compare', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const sessions = await comparisonEngine.listSessions(limit, offset);
    
    res.json({ sessions, pagination: { limit, offset } });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Delete comparison session
app.delete('/v1/compare/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const deleted = await comparisonEngine.deleteSession(sessionId);
    
    if (!deleted) {
      return res.status(404).json({ error: { message: 'Session not found', type: 'not_found_error' } });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// ==================== 多模型辩论 API ====================

// Start a multi-model debate
app.post('/v1/debate', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const debateRequest: DebateRequest = req.body;
    
    // Validate request
    if (!debateRequest.topic || !debateRequest.models || debateRequest.models.length < 2) {
      return res.status(400).json({ 
        error: { 
          message: 'At least 2 models required for debate', 
          type: 'invalid_request_error' 
        } 
      });
    }
    
    if (!debateRequest.positions || Object.keys(debateRequest.positions).length < 2) {
      return res.status(400).json({ 
        error: { 
          message: 'At least 2 models must have assigned positions', 
          type: 'invalid_request_error' 
        } 
      });
    }
    
    // Start debate
    const result = await collaborationEngine.startDebate(debateRequest);
    
    res.json({
      session: result.session,
      rounds: result.rounds,
      summary: result.summary,
      metadata: {
        total_rounds: result.session.rounds,
        total_arguments: result.rounds.reduce((sum, r) => sum + r.arguments.length, 0),
        total_duration_ms: Date.now() - startTime
      }
    });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Get debate session details
app.get('/v1/debate/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await collaborationEngine.getDebateSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: { message: 'Session not found', type: 'not_found_error' } });
    }
    
    const arguments = await collaborationEngine.getDebateArguments(sessionId);
    
    // Group arguments by round
    const roundsMap = new Map<number, typeof arguments>();
    arguments.forEach(arg => {
      // Extract round number from roundId (format: round-uuid)
      const round = await getRoundNumber(arg.roundId);
      if (!roundsMap.has(round)) {
        roundsMap.set(round, []);
      }
      roundsMap.get(round)!.push(arg);
    });
    
    const rounds = Array.from(roundsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([roundNumber, args]) => ({
        roundNumber,
        arguments: args
      }));
    
    res.json({ session, rounds });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// List debate sessions
app.get('/v1/debate', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const sessions = await collaborationEngine.listDebateSessions(limit, offset);
    
    res.json({ sessions, pagination: { limit, offset } });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Delete debate session
app.delete('/v1/debate/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const deleted = await collaborationEngine.deleteDebateSession(sessionId);
    
    if (!deleted) {
      return res.status(404).json({ error: { message: 'Session not found', type: 'not_found_error' } });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// ==================== 多模型协作 API ====================

// Start a multi-model collaboration task
app.post('/v1/collaborate', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const collabRequest: CollaborationRequest = req.body;
    
    // Validate request
    if (!collabRequest.goal || !collabRequest.models || collabRequest.models.length < 1) {
      return res.status(400).json({ 
        error: { 
          message: 'At least 1 model required for collaboration', 
          type: 'invalid_request_error' 
        } 
      });
    }
    
    if (!['sequential', 'parallel', 'voting'].includes(collabRequest.workflow)) {
      return res.status(400).json({ 
        error: { 
          message: 'Workflow must be one of: sequential, parallel, voting', 
          type: 'invalid_request_error' 
        } 
      });
    }
    
    // Start collaboration
    const result = await collaborationEngine.startCollaboration(collabRequest);
    
    res.json({
      task: result.task,
      steps: result.steps,
      finalResult: result.finalResult,
      metadata: {
        total_steps: result.steps.length,
        total_outputs: result.steps.reduce((sum, s) => sum + s.outputs.length, 0),
        total_duration_ms: Date.now() - startTime
      }
    });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Get collaboration task details
app.get('/v1/collaborate/:taskId', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await collaborationEngine.getCollaborationTask(taskId);
    
    if (!task) {
      return res.status(404).json({ error: { message: 'Task not found', type: 'not_found_error' } });
    }
    
    const steps = await collaborationEngine.getCollaborationSteps(taskId);
    
    res.json({ task, steps });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// List collaboration tasks
app.get('/v1/collaborate', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const tasks = await collaborationEngine.listCollaborationTasks(limit, offset);
    
    res.json({ tasks, pagination: { limit, offset } });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Delete collaboration task
app.delete('/v1/collaborate/:taskId', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.params;
    const deleted = await collaborationEngine.deleteCollaborationTask(taskId);
    
    if (!deleted) {
      return res.status(404).json({ error: { message: 'Task not found', type: 'not_found_error' } });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Helper function to extract round number from roundId
async function getRoundNumber(roundId: string): Promise<number> {
  // This is a simplified version - in production you'd query the database
  return 1;
}

let server: any = null;

export async function startApiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = app.listen(PORT, HOST, () => {
      console.log(`Web2API Server running at http://${HOST}:${PORT}`);
      resolve();
    });
    
    server.on('error', reject);
  });
}

export async function stopApiServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        console.log('Web2API Server stopped');
        resolve();
      });
    } else {
      resolve();
    }
  });
}
