import { BrowserPool } from './browser-pool';
import { Page } from 'playwright';

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

export interface TaskState {
  id: string;
  model: string;
  request: InternalRequest;
  status: 'QUEUED' | 'FIND_RESOURCE' | 'EXECUTING' | 'WAITING_RESPONSE' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export class TaskScheduler {
  private queue: TaskState[] = [];
  private processing: Map<string, TaskState> = new Map();
  private readonly TIMEOUT_MS = 120000; // 2 minutes

  async executeTask(request: InternalRequest, browserPool: BrowserPool): Promise<InternalResponse> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const task: TaskState = {
      id: taskId,
      model: request.model,
      request,
      status: 'QUEUED',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.queue.push(task);

    return this.processQueue(browserPool);
  }

  private async processQueue(browserPool: BrowserPool): Promise<InternalResponse> {
    // Process tasks in queue
    while (this.queue.length > 0) {
      const task = this.queue[0];
      
      if (browserPool.isBusy(task.model)) {
        // Wait and retry
        await this.sleep(500);
        continue;
      }

      this.queue.shift();
      this.processing.set(task.id, task);
      
      try {
        const result = await this.executeWithTimeout(task, browserPool);
        task.status = 'COMPLETED';
        task.updatedAt = Date.now();
        this.processing.delete(task.id);
        return result;
      } catch (error: any) {
        task.status = 'FAILED';
        task.error = error.message;
        task.updatedAt = Date.now();
        this.processing.delete(task.id);
        browserPool.markFree(task.model);
        throw error;
      }
    }

    throw new Error('No tasks to process');
  }

  private async executeWithTimeout(task: TaskState, browserPool: BrowserPool): Promise<InternalResponse> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Task timeout')), this.TIMEOUT_MS);
    });

    const executionPromise = this.executeTaskInternal(task, browserPool);

    return Promise.race([executionPromise, timeoutPromise]);
  }

  private async executeTaskInternal(task: TaskState, browserPool: BrowserPool): Promise<InternalResponse> {
    task.status = 'FIND_RESOURCE';
    task.updatedAt = Date.now();

    // Get adapter for this model
    const adapter = await this.getAdapter(task.model);
    if (!adapter) {
      throw new Error(`No adapter found for model: ${task.model}`);
    }

    task.status = 'EXECUTING';
    task.updatedAt = Date.now();

    // Mark model as busy
    await browserPool.markBusy(task.model);

    try {
      // Load or create browser context
      const page = await browserPool.getPage(task.model, adapter.base_url);
      
      task.status = 'WAITING_RESPONSE';
      task.updatedAt = Date.now();

      // Execute the adapter logic
      const response = await this.executeAdapter(adapter, page, task.request);

      // Save session state
      await browserPool.saveSessionState(task.model);

      return {
        id: task.id,
        model: task.model,
        content: response.content,
        role: 'assistant',
        finish_reason: response.finish_reason || 'stop',
        usage: response.usage
      };
    } finally {
      await browserPool.markFree(task.model);
    }
  }

  private async getAdapter(modelId: string): Promise<any> {
    // Import adapter configurations
    const adapters: Record<string, any> = {
      'chatgpt': {
        name: 'chatgpt',
        type: 'web',
        base_url: 'https://chat.openai.com',
        input_selector: '#prompt-textarea',
        send_button: 'button[data-testid="send-button"]',
        response_container: '.markdown:last-of-type'
      },
      'claude-web': {
        name: 'claude-web',
        type: 'web',
        base_url: 'https://claude.ai',
        input_selector: 'div.ProseMirror',
        send_button: 'button[aria-label*="Send"]',
        response_container: 'article:last-of-type'
      },
      'deepseek': {
        name: 'deepseek',
        type: 'web',
        base_url: 'https://chat.deepseek.com',
        input_selector: '#chat-input',
        send_button: 'button.send-btn',
        response_container: '.message-assistant:last-of-type'
      },
      'qwen': {
        name: 'qwen',
        type: 'web',
        base_url: 'https://tongyi.aliyun.com/qianwen',
        input_selector: 'textarea#input-box',
        send_button: 'button.send-btn',
        response_container: '.conversation-item:last-child .assistant-content'
      },
      'glm': {
        name: 'glm',
        type: 'web',
        base_url: 'https://chatglm.cn',
        input_selector: '#user-input',
        send_button: 'button[type="submit"]',
        response_container: '.chat-item:last-child .assistant-message'
      },
      'kimi': {
        name: 'kimi',
        type: 'web',
        base_url: 'https://kimi.moonshot.cn',
        input_selector: '#inputbox',
        send_button: 'button[aria-label="发送"]',
        response_container: '.reply-item:last-child .content'
      },
      'doubao': {
        name: 'doubao',
        type: 'web',
        base_url: 'https://www.doubao.com',
        input_selector: '#flow-input-chat',
        send_button: 'button[class*="send"]',
        response_container: '.chat-item:last-child .user-info + div'
      },
      'yuanbao': {
        name: 'yuanbao',
        type: 'web',
        base_url: 'https://yuanbao.tencent.com',
        input_selector: 'textarea[placeholder*="输入"]',
        send_button: 'i[class*="send"]',
        response_container: '.message-row:last-child .bubble-content'
      },
      'yiyan': {
        name: 'yiyan',
        type: 'web',
        base_url: 'https://yiyan.baidu.com',
        input_selector: 'textarea[placeholder*="输入"]',
        send_button: 'button[class*="send"]',
        response_container: '.last-reply .content'
      },
      'xinghuo': {
        name: 'xinghuo',
        type: 'web',
        base_url: 'https://xinghuo.xfyun.cn',
        input_selector: 'textarea[placeholder*="输入"]',
        send_button: 'a[class*="send"]',
        response_container: '.question-list:last-child .answer'
      }
    };

    return adapters[modelId] || null;
  }

  private async executeAdapter(
    adapter: any,
    page: Page,
    request: InternalRequest
  ): Promise<{ content: string; finish_reason?: string; usage?: any }> {
    // Wait for page to be ready
    await page.waitForLoadState('networkidle');

    // Extract prompt from messages
    const lastMessage = request.messages[request.messages.length - 1];
    const prompt = typeof lastMessage.content === 'string' 
      ? lastMessage.content 
      : lastMessage.content.map((c: any) => c.text || '').join('');

    // Find and fill input
    const inputSelector = adapter.input_selector;
    const inputElement = await page.$(inputSelector);
    
    if (!inputElement) {
      throw new Error(`Input element not found: ${inputSelector}`);
    }

    // Clear existing input
    await inputElement.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');

    // Type the prompt (with human-like delay)
    await this.humanType(page, prompt);

    // Click send button
    const sendButton = await page.$(adapter.send_button);
    if (sendButton) {
      await sendButton.click();
    } else {
      await page.keyboard.press('Enter');
    }

    // Wait for response
    const responseContainer = adapter.response_container;
    await page.waitForSelector(responseContainer, { timeout: 60000 });

    // Extract response text
    const responseElement = await page.$(responseContainer);
    const content = responseElement 
      ? await responseElement.textContent() || ''
      : '';

    return {
      content: content.trim(),
      finish_reason: 'stop'
    };
  }

  private async humanType(page: Page, text: string): Promise<void> {
    // Type with random delays to simulate human behavior
    const words = text.split(' ');
    for (const word of words) {
      await page.keyboard.type(word + ' ');
      // Random delay between words (50-200ms)
      await this.sleep(50 + Math.random() * 150);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getQueueStatus(): { queued: number; processing: number } {
    return {
      queued: this.queue.length,
      processing: this.processing.size
    };
  }
}
