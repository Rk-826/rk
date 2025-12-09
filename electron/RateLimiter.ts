// RateLimiter.ts
import axios, { AxiosError, AxiosResponse } from 'axios';

export interface RateLimiterConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  requestsPerMinute: number;
}

export class RateLimiter {
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessing = false;
  private lastRequestTime = 0;
  private requestCount = 0;
  private windowStart = Date.now();
  
  private config: RateLimiterConfig = {
    maxRetries: 5,
    baseDelay: 1000, // 1 second
    maxDelay: 60000, // 1 minute
    backoffMultiplier: 2,
    requestsPerMinute: 30 // OpenRouter has higher limits than Gemini
  };

  constructor(config?: Partial<RateLimiterConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Execute a request with rate limiting and retry logic
   */
  async executeRequest<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    context: string = 'API request'
  ): Promise<AxiosResponse<T>> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await this.executeWithRetry(requestFn, context);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processQueue();
    });
  }

  /**
   * Process the request queue with rate limiting
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      // Check if we need to wait due to rate limiting
      await this.enforceRateLimit();
      
      const request = this.requestQueue.shift();
      if (request) {
        try {
          await request();
        } catch (error) {
          console.error('Request failed in queue:', error);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Enforce rate limiting by waiting if necessary
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Reset window if a minute has passed
    if (now - this.windowStart >= 60000) {
      this.requestCount = 0;
      this.windowStart = now;
    }

    // If we've hit the rate limit, wait
    if (this.requestCount >= this.config.requestsPerMinute) {
      const waitTime = 60000 - (now - this.windowStart);
      if (waitTime > 0) {
        console.log(`Rate limit reached. Waiting ${waitTime}ms before next request...`);
        await this.sleep(waitTime);
        this.requestCount = 0;
        this.windowStart = Date.now();
      }
    }

    // Ensure minimum delay between requests
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minDelay = 4000; // 4 seconds between requests for safety
    
    if (timeSinceLastRequest < minDelay) {
      const waitTime = minDelay - timeSinceLastRequest;
      console.log(`Waiting ${waitTime}ms before next request...`);
      await this.sleep(waitTime);
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Execute request with retry logic for 429 errors
   */
  private async executeWithRetry<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    context: string,
    attempt: number = 1
  ): Promise<AxiosResponse<T>> {
    try {
      console.log(`${context} - Attempt ${attempt}`);
      return await requestFn();
    } catch (error) {
      const axiosError = error as AxiosError;
      
      // Handle 429 (Too Many Requests) errors
      if (axiosError.response?.status === 429) {
        if (attempt >= this.config.maxRetries) {
          throw new Error(`Rate limit exceeded after ${this.config.maxRetries} attempts. Please wait before trying again.`);
        }

        const delay = this.calculateBackoffDelay(attempt);
        console.log(`${context} - Rate limited. Retrying in ${delay}ms (attempt ${attempt + 1}/${this.config.maxRetries})`);
        
        await this.sleep(delay);
        return this.executeWithRetry(requestFn, context, attempt + 1);
      }

      // Handle other HTTP errors
      if (axiosError.response?.status >= 400) {
        const errorMessage = `API request failed: ${axiosError.response.status} ${axiosError.response.statusText}`;
        console.error(`${context} - ${errorMessage}`);
        throw new Error(errorMessage);
      }

      // Handle network errors
      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ENOTFOUND') {
        if (attempt >= this.config.maxRetries) {
          throw new Error(`Network error after ${this.config.maxRetries} attempts: ${axiosError.message}`);
        }

        const delay = this.calculateBackoffDelay(attempt);
        console.log(`${context} - Network error. Retrying in ${delay}ms (attempt ${attempt + 1}/${this.config.maxRetries})`);
        
        await this.sleep(delay);
        return this.executeWithRetry(requestFn, context, attempt + 1);
      }

      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    const delay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);
    return Math.min(delay, this.config.maxDelay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current queue status
   */
  getQueueStatus(): { queueLength: number; isProcessing: boolean; requestCount: number } {
    return {
      queueLength: this.requestQueue.length,
      isProcessing: this.isProcessing,
      requestCount: this.requestCount
    };
  }

  /**
   * Clear the request queue
   */
  clearQueue(): void {
    this.requestQueue = [];
    this.isProcessing = false;
  }
}

// Global rate limiter instance
export const rateLimiter = new RateLimiter({
  maxRetries: 5,
  baseDelay: 1000, // Start with 1 second
  maxDelay: 30000, // Max 30 seconds
  backoffMultiplier: 2,
  requestsPerMinute: 20 // More generous for OpenRouter API
});
