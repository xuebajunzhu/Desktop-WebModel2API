/**
 * Web2API Test Suite
 * Tests for core functionality not explicitly covered in the technical document
 */

import { encrypt, decrypt, generateSecureToken, hashValue } from '../src/main/security/encryption';
import { RateLimiter } from '../src/main/security/rate-limiter';
import { loadAdapterConfig, validateAdapter, getAvailableAdapters } from '../src/main/adapters/adapter-loader';
import { convertFromOpenAI, convertToOpenAI } from '../src/main/converters/openai';
import { convertFromAnthropic, convertToAnthropic, convertToAnthropicStream } from '../src/main/converters/anthropic';

describe('Security Module Tests', () => {
  describe('Encryption', () => {
    it('should encrypt and decrypt data correctly', () => {
      const originalData = 'sensitive-session-data-12345';
      const encrypted = encrypt(originalData);
      
      expect(encrypted).toHaveProperty('encrypted');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');
      expect(encrypted.encrypted).not.toBe(originalData);
      
      const decrypted = decrypt(encrypted.encrypted, encrypted.iv, encrypted.authTag);
      expect(decrypted).toBe(originalData);
    });

    it('should produce different encryption results for same input', () => {
      const data = 'test-data';
      const encrypted1 = encrypt(data);
      const encrypted2 = encrypt(data);
      
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
      
      const decrypted1 = decrypt(encrypted1.encrypted, encrypted1.iv, encrypted1.authTag);
      const decrypted2 = decrypt(encrypted2.encrypted, encrypted2.iv, encrypted2.authTag);
      expect(decrypted1).toBe(data);
      expect(decrypted2).toBe(data);
    });
  });

  describe('Token Generation', () => {
    it('should generate secure tokens with correct prefix', () => {
      const token1 = generateSecureToken('sk-test');
      const token2 = generateSecureToken('sk-web2api');
      
      expect(token1).toMatch(/^sk-test-[0-9a-f]{48}$/);
      expect(token2).toMatch(/^sk-web2api-[0-9a-f]{48}$/);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateSecureToken('test'));
      }
      expect(tokens.size).toBe(100);
    });
  });

  describe('Hash Function', () => {
    it('should produce consistent hashes', () => {
      const hash1 = hashValue('test-input');
      const hash2 = hashValue('test-input');
      expect(hash1).toBe(hash2);
    });
  });
});

describe('Rate Limiter Tests', () => {
  it('should allow requests within limit', () => {
    const limiter = new RateLimiter({ rpm: 10, rpd: 1000, burst: 5 });
    
    for (let i = 0; i < 10; i++) {
      const result = limiter.checkLimit('test-key');
      expect(result.allowed).toBe(true);
    }
  });

  it('should block requests exceeding limit', () => {
    const limiter = new RateLimiter({ rpm: 5, rpd: 1000, burst: 0 });
    
    for (let i = 0; i < 5; i++) {
      limiter.checkLimit('rate-test-key');
    }
    
    const result = limiter.checkLimit('rate-test-key');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should enforce daily limits', () => {
    const limiter = new RateLimiter({ rpm: 100, rpd: 5, burst: 10 });
    
    for (let i = 0; i < 5; i++) {
      limiter.checkLimit('daily-test');
    }
    
    const result = limiter.checkLimit('daily-test');
    expect(result.allowed).toBe(false);
  });

  it('should track separate keys independently', () => {
    const limiter = new RateLimiter({ rpm: 3, rpd: 1000 });
    
    for (let i = 0; i < 3; i++) {
      limiter.checkLimit('key1');
    }
    
    expect(limiter.checkLimit('key1').allowed).toBe(false);
    expect(limiter.checkLimit('key2').allowed).toBe(true);
  });
});

describe('Adapter Loader Tests', () => {
  it('should load valid adapter configurations', () => {
    const adapters = ['chatgpt', 'claude-web', 'deepseek', 'qwen', 'glm', 'kimi'];
    
    for (const adapterName of adapters) {
      const config = loadAdapterConfig(adapterName);
      expect(config).toBeTruthy();
      expect(config?.name).toBe(adapterName);
      expect(config?.type).toBe('web');
      expect(config?.base_url).toBeTruthy();
    }
  });

  it('should return null for non-existent adapter', () => {
    const config = loadAdapterConfig('non-existent-adapter');
    expect(config).toBeNull();
  });

  it('should load CLI adapter correctly', () => {
    const config = loadAdapterConfig('claude-code');
    expect(config).toBeTruthy();
    expect(config?.type).toBe('cli');
  });

  it('should validate correct adapter config', () => {
    const config = {
      name: 'test-adapter',
      type: 'web' as const,
      base_url: 'https://example.com',
      input_selector: '#input',
      send_button: '#send',
      response_container: '.response'
    };
    
    const result = validateAdapter(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect missing required fields', () => {
    const config = {
      name: 'incomplete-adapter',
      type: 'web' as const
    };
    
    const result = validateAdapter(config as any);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should return list of available adapters', () => {
    const adapters = getAvailableAdapters();
    expect(adapters.length).toBeGreaterThan(0);
    expect(adapters).toContain('chatgpt');
  });
});

describe('Protocol Converter Tests', () => {
  describe('OpenAI Converter', () => {
    it('should convert OpenAI request to internal format', () => {
      const openAIRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' }
        ],
        temperature: 0.7,
        max_tokens: 100,
        stream: true
      };
      
      const internal = convertFromOpenAI(openAIRequest);
      
      expect(internal.model).toBe('gpt-4');
      expect(internal.messages).toHaveLength(1);
      expect(internal.system).toBe('You are helpful');
      expect(internal.temperature).toBe(0.7);
    });

    it('should convert internal response to OpenAI format', () => {
      const internalResponse = {
        id: 'test-123',
        model: 'chatgpt',
        content: 'Hello! How can I help you?',
        role: 'assistant',
        finish_reason: 'stop' as const,
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        }
      };
      
      const openAIResponse = convertToOpenAI(internalResponse, 'req-456', 'chatgpt', false);
      
      expect(openAIResponse.id).toBe('req-456');
      expect(openAIResponse.model).toBe('chatgpt');
      expect(openAIResponse.choices).toHaveLength(1);
      expect(openAIResponse.choices[0].message.content).toBe('Hello! How can I help you?');
    });

    it('should generate stream chunks correctly', () => {
      const internalResponse = {
        id: 'stream-123',
        model: 'chatgpt',
        content: 'Streaming response',
        role: 'assistant',
        finish_reason: 'stop' as const
      };
      
      const chunks = convertToOpenAI(internalResponse, 'stream-req', 'chatgpt', true);
      
      expect(Array.isArray(chunks)).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].choices[0].delta.role).toBe('assistant');
    });
  });

  describe('Anthropic Converter', () => {
    it('should convert Anthropic request to internal format', () => {
      const anthropicRequest = {
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello, Claude' }],
        system: 'You are Claude',
        stream: false,
        temperature: 0.5
      };
      
      const internal = convertFromAnthropic(anthropicRequest);
      
      expect(internal.model).toBe('claude-3-opus-20240229');
      expect(internal.messages).toHaveLength(2);
      expect(internal.messages[0].role).toBe('system');
    });

    it('should convert internal response to Anthropic format', () => {
      const internalResponse = {
        id: 'test-anthropic',
        model: 'claude-web',
        content: 'Hello! I am Claude.',
        role: 'assistant',
        finish_reason: 'stop' as const,
        usage: {
          prompt_tokens: 15,
          completion_tokens: 25,
          total_tokens: 40
        }
      };
      
      const anthropicResponse = convertToAnthropic(internalResponse, 'msg_test123');
      
      expect(anthropicResponse.type).toBe('message');
      expect(anthropicResponse.content[0].text).toBe('Hello! I am Claude.');
      expect(anthropicResponse.stop_reason).toBe('end_turn');
    });

    it('should generate Anthropic stream events in correct order', () => {
      const internalResponse = {
        id: 'stream-anthropic',
        model: 'claude-web',
        content: 'Streaming content',
        role: 'assistant',
        finish_reason: 'stop' as const
      };
      
      const events = Array.from(convertToAnthropicStream(internalResponse, 'msg_stream'));
      
      expect(events).toHaveLength(6);
      expect(events[0].type).toBe('message_start');
      expect(events[5].type).toBe('message_stop');
    });
  });
});
