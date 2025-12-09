// OpenRouterTest.ts - Test OpenRouter API integration
import { OpenAI } from "openai";

export async function testOpenRouterAPI(apiKey: string): Promise<{ success: boolean; message: string }> {
  try {
    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://your-app.com',
        'X-Title': 'Coding Assistant App',
      }
    });

    console.log("Testing OpenRouter API connection...");
    
    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o",
      messages: [
        {
          role: "user",
          content: "Hello! Please respond with 'OpenRouter API is working correctly.'"
        }
      ],
      max_tokens: 50,
      temperature: 0.1
    });

    const content = response.choices[0].message.content;
    console.log("OpenRouter API Response:", content);

    return {
      success: true,
      message: "OpenRouter API is working correctly!"
    };

  } catch (error: any) {
    console.error("OpenRouter API Test Error:", error);
    
    let errorMessage = "Unknown error occurred";
    
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      
      switch (status) {
        case 401:
          errorMessage = "Invalid API key. Please check your OpenRouter API key.";
          break;
        case 403:
          errorMessage = "Access denied. Please check your API key permissions.";
          break;
        case 429:
          errorMessage = "Rate limit exceeded. Please wait before trying again.";
          break;
        case 500:
          errorMessage = "OpenRouter server error. Please try again later.";
          break;
        default:
          errorMessage = `API request failed: ${status} ${statusText}`;
      }
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorMessage = "Network error. Please check your internet connection.";
    } else {
      errorMessage = error.message || "Unknown error occurred";
    }

    return {
      success: false,
      message: errorMessage
    };
  }
}
