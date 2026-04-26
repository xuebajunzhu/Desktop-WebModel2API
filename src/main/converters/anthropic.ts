import { v4 as uuidv4 } from 'uuid';

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string | any[] }>;
  system?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  metadata?: any;
  [key: string]: any;
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicStreamEvent {
  type: string;
  data: any;
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
 * Convert Anthropic Messages API request to internal format
 */
export function convertFromAnthropic(request: AnthropicRequest): InternalRequest {
  const { model, max_tokens, messages, system, stream, temperature, ...rest } = request;

  // Merge system into messages if provided
  let processedMessages = [...messages];
  if (system) {
    processedMessages = [
      { role: 'system', content: system },
      ...processedMessages
    ];
  }

  return {
    model,
    messages: processedMessages,
    stream: stream || false,
    temperature,
    max_tokens,
    options: rest
  };
}

/**
 * Convert internal response to Anthropic Messages API format
 */
export function convertToAnthropic(
  response: InternalResponse,
  requestId?: string
): AnthropicResponse {
  const id = requestId || `msg_${uuidv4().replace(/-/g, '')}`;
  
  return {
    id,
    type: 'message',
    role: 'assistant',
    content: [{
      type: 'text',
      text: response.content
    }],
    model: response.model,
    stop_reason: mapFinishReason(response.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens || 0,
      output_tokens: response.usage?.completion_tokens || 0
    }
  };
}

/**
 * Generate Anthropic SSE stream events
 */
export function* convertToAnthropicStream(
  response: InternalResponse,
  requestId?: string
): Generator<AnthropicStreamEvent> {
  const id = requestId || `msg_${uuidv4().replace(/-/g, '')}`;

  // message_start
  yield {
    type: 'message_start',
    data: {
      message: {
        id,
        type: 'message',
        role: 'assistant',
        content: [],
        model: response.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: 0
        }
      }
    }
  };

  // content_block_start
  yield {
    type: 'content_block_start',
    data: {
      index: 0,
      content_block: {
        type: 'text',
        text: ''
      }
    }
  };

  // content_block_delta (one or more)
  yield {
    type: 'content_block_delta',
    data: {
      index: 0,
      delta: {
        type: 'text_delta',
        text: response.content
      }
    }
  };

  // content_block_stop
  yield {
    type: 'content_block_stop',
    data: {
      index: 0
    }
  };

  // message_delta
  yield {
    type: 'message_delta',
    data: {
      delta: {
        stop_reason: mapFinishReason(response.finish_reason),
        stop_sequence: null
      },
      usage: {
        output_tokens: response.usage?.completion_tokens || 0
      }
    }
  };

  // message_stop
  yield {
    type: 'message_stop',
    data: {}
  };
}

/**
 * Map internal finish_reason to Anthropic stop_reason
 */
function mapFinishReason(finishReason: string): string {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

/**
 * Map Anthropic model names to internal model IDs
 */
export function mapAnthropicModel(model: string): string {
  const mapping: Record<string, string> = {
    'claude-3-opus-20240229': 'claude-web',
    'claude-3-sonnet-20240229': 'claude-web',
    'claude-3-haiku-20240307': 'claude-web',
    'claude-opus-4': 'claude-web',
    'claude-sonnet-4': 'claude-web',
    'claude-code': 'claude-code'
  };

  return mapping[model] || 'claude-web';
}

/**
 * Estimate tokens for Anthropic (similar to OpenAI but may vary)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
