import { v4 as uuidv4 } from 'uuid';

export interface OpenAIRequest {
  model: string;
  messages: Array<{ role: string; content: string | any[] }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  [key: string]: any;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
}

export interface InternalRequest {
  model: string;
  messages: Array<{ role: string; content: string | any[] }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  system?: string;
  options?: any;
}

export interface InternalResponse {
  id: string;
  model: string;
  content: string;
  role: string;
  finish_reason: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  cost_usd?: number;
}

/**
 * Convert OpenAI Chat Completions request to internal format
 */
export function convertFromOpenAI(request: OpenAIRequest): InternalRequest {
  const { model, messages, stream, temperature, max_tokens, ...rest } = request;
  
  // Extract system message if present
  let system: string | undefined;
  const filteredMessages = messages.filter(msg => {
    if (msg.role === 'system') {
      system = typeof msg.content === 'string' ? msg.content : 
        msg.content.map((c: any) => c.text || '').join('');
      return false;
    }
    return true;
  });

  return {
    model,
    messages: filteredMessages,
    stream: stream || false,
    temperature,
    max_tokens,
    system,
    options: rest
  };
}

/**
 * Convert internal response to OpenAI Chat Completions format
 */
export function convertToOpenAI(
  response: InternalResponse,
  requestId?: string,
  modelName?: string,
  stream: boolean = false
): OpenAIResponse | OpenAIStreamChunk[] {
  const id = requestId || `web2api-${uuidv4()}`;
  const model = modelName || response.model;
  const created = Math.floor(Date.now() / 1000);

  if (stream) {
    // Return stream chunks
    const chunks: OpenAIStreamChunk[] = [];
    
    // First chunk with role
    chunks.push({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null
      }]
    });

    // Content chunk
    chunks.push({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: { content: response.content },
        finish_reason: null
      }]
    });

    // Final chunk
    chunks.push({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: response.finish_reason
      }]
    });

    return chunks;
  }

  // Non-streaming response
  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: response.content
      },
      finish_reason: response.finish_reason
    }],
    usage: response.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };
}

/**
 * Estimate tokens (simple approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}
