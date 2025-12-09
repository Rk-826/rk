// GeminiApiHelper.ts - Additional utilities for Gemini API management
import { rateLimiter } from "./RateLimiter";
import * as axios from "axios";

export interface ApiKeyStatus {
  isValid: boolean;
  quotaExceeded: boolean;
  rateLimited: boolean;
  errorMessage?: string;
}

export class GeminiApiHelper {
  private static instance: GeminiApiHelper;
  private lastKeyCheck: number = 0;
  private keyCheckCache: Map<string, { status: ApiKeyStatus; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  public static getInstance(): GeminiApiHelper {
    if (!GeminiApiHelper.instance) {
      GeminiApiHelper.instance = new GeminiApiHelper();
    }
    return GeminiApiHelper.instance;
  }

  /**
   * Check if the API key is valid and has quota available
   */
  async checkApiKeyStatus(apiKey: string): Promise<ApiKeyStatus> {
    const now = Date.now();
    const cached = this.keyCheckCache.get(apiKey);
    
    // Return cached result if it's still valid
    if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
      return cached.status;
    }

    try {
      // Make a simple test request to check API key status
      const response = await rateLimiter.executeRequest(
        () => axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            contents: [{
              role: "user",
              parts: [{ text: "Hello" }]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 10
            }
          }
        ),
        "API Key Validation"
      );

      const status: ApiKeyStatus = {
        isValid: true,
        quotaExceeded: false,
        rateLimited: false
      };

      this.keyCheckCache.set(apiKey, { status, timestamp: now });
      return status;

    } catch (error: any) {
      const status: ApiKeyStatus = {
        isValid: false,
        quotaExceeded: false,
        rateLimited: false,
        errorMessage: "Unknown error"
      };

      if (error.response) {
        const statusCode = error.response.status;
        
        if (statusCode === 400) {
          status.errorMessage = "Invalid API key. Please check your Gemini API key.";
        } else if (statusCode === 403) {
          status.errorMessage = "API key access denied. Please check your API key permissions.";
        } else if (statusCode === 429) {
          status.rateLimited = true;
          status.errorMessage = "Rate limit exceeded. Please wait before making more requests.";
        } else if (statusCode === 503) {
          status.errorMessage = "Gemini API is temporarily unavailable. Please try again later.";
        } else {
          status.errorMessage = `API request failed with status ${statusCode}`;
        }
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        status.errorMessage = "Network error. Please check your internet connection.";
      } else {
        status.errorMessage = error.message || "Unknown error occurred";
      }

      this.keyCheckCache.set(apiKey, { status, timestamp: now });
      return status;
    }
  }

  /**
   * Get user-friendly error message for different API errors
   */
  getErrorMessage(error: any): string {
    if (error.response) {
      const statusCode = error.response.status;
      
      switch (statusCode) {
        case 400:
          return "Invalid request. Please check your API key and try again.";
        case 401:
          return "Unauthorized. Please check your API key.";
        case 403:
          return "Access denied. Please check your API key permissions.";
        case 429:
          return "Rate limit exceeded. The app will automatically retry with delays. Please wait...";
        case 500:
          return "Gemini API server error. Please try again later.";
        case 503:
          return "Gemini API is temporarily unavailable. Please try again later.";
        default:
          return `API request failed with status ${statusCode}. Please try again.`;
      }
    }
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return "Network error. Please check your internet connection.";
    }
    
    return error.message || "An unknown error occurred. Please try again.";
  }

  /**
   * Clear the API key cache
   */
  clearCache(): void {
    this.keyCheckCache.clear();
  }

  /**
   * Get rate limiter status
   */
  getRateLimiterStatus() {
    return rateLimiter.getQueueStatus();
  }
}

export const geminiApiHelper = GeminiApiHelper.getInstance();
