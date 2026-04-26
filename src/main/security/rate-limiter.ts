/**
 * Rate Limiter - Token bucket algorithm implementation
 * For limiting API requests per key
 */

export interface RateLimitConfig {
  rpm?: number;      // Requests per minute
  rpd?: number;      // Requests per day
  burst?: number;    // Burst allowance
}

export interface RateLimitState {
  tokens: number;
  lastRefill: number;
  dailyCount: number;
  dailyReset: number;
}

export class RateLimiter {
  private buckets: Map<string, RateLimitState> = new Map();
  private defaultConfig: RateLimitConfig;

  constructor(defaultConfig: RateLimitConfig = {}) {
    this.defaultConfig = {
      rpm: 60,
      rpd: 10000,
      burst: 10,
      ...defaultConfig
    };
  }

  /**
   * Check if a request is allowed under rate limits
   */
  checkLimit(key: string, config?: RateLimitConfig): { allowed: boolean; remaining?: number; resetAt?: number } {
    const effectiveConfig = { ...this.defaultConfig, ...config };
    let state = this.buckets.get(key);

    if (!state) {
      state = {
        tokens: effectiveConfig.rpm || 60,
        lastRefill: Date.now(),
        dailyCount: 0,
        dailyReset: Date.now() + 24 * 60 * 60 * 1000
      };
      this.buckets.set(key, state);
    }

    // Reset daily count if needed
    if (Date.now() > state.dailyReset) {
      state.dailyCount = 0;
      state.dailyReset = Date.now() + 24 * 60 * 60 * 1000;
    }

    // Refill tokens based on time elapsed
    const now = Date.now();
    const elapsedMinutes = (now - state.lastRefill) / 60000;
    const refillRate = effectiveConfig.rpm || 60;
    const maxTokens = effectiveConfig.rpm || 60;
    const burst = effectiveConfig.burst || 10;

    state.tokens = Math.min(
      maxTokens + burst,
      state.tokens + elapsedMinutes * refillRate
    );
    state.lastRefill = now;

    // Check daily limit
    if (effectiveConfig.rpd && state.dailyCount >= effectiveConfig.rpd) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: state.dailyReset
      };
    }

    // Check token bucket
    if (state.tokens < 1) {
      const msPerToken = 60000 / refillRate;
      return {
        allowed: false,
        remaining: 0,
        resetAt: now + msPerToken
      };
    }

    // Consume a token
    state.tokens -= 1;
    state.dailyCount += 1;
    this.buckets.set(key, state);

    return {
      allowed: true,
      remaining: Math.floor(state.tokens),
      resetAt: state.dailyReset
    };
  }

  /**
   * Get current rate limit status for a key
   */
  getStatus(key: string, config?: RateLimitConfig): { tokens: number; dailyCount: number; dailyReset: number } {
    const state = this.buckets.get(key);
    
    if (!state) {
      return {
        tokens: config?.rpm || this.defaultConfig.rpm || 60,
        dailyCount: 0,
        dailyReset: Date.now() + 24 * 60 * 60 * 1000
      };
    }

    return {
      tokens: Math.floor(state.tokens),
      dailyCount: state.dailyCount,
      dailyReset: state.dailyReset
    };
  }

  /**
   * Clear rate limit state for a key
   */
  clear(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Clear all rate limit states
   */
  clearAll(): void {
    this.buckets.clear();
  }
}
