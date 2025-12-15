// ForceOpenRouterConfig.ts - Force the app to use OpenRouter configuration
import { configHelper } from "./ConfigHelper";

export function forceOpenRouterConfig(): void {
  try {
    console.log("Forcing OpenRouter configuration...");
    
    // Force update the config to use OpenRouter
    const result = configHelper.updateConfig({
      apiKey: "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",
      apiProvider: "openai",
      extractionModel: "gemini-2.5-flash",
      solutionModel: "gemini-2.5-flash",
      debuggingModel: "gemini-2.5-flash"
    });
    
    console.log("OpenRouter configuration forced successfully:", result);
    
    // Emit config update event to reinitialize clients
    configHelper.emit('config-updated');
    
  } catch (error) {
    console.error("Failed to force OpenRouter configuration:", error);
  }
}

export function clearConfigAndUseDefaults(): void {
  try {
    console.log("Clearing existing config to use defaults...");
    
    // Load current config to get the path
    const currentConfig = configHelper.loadConfig();
    console.log("Current config:", currentConfig);
    
    // Force save the default config (which now has OpenRouter settings)
    configHelper.saveConfig({
      apiKey: "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",
      apiProvider: "openai",
      extractionModel: "gemini-2.5-flash",
      solutionModel: "gemini-2.5-flash",
      debuggingModel: "gemini-2.5-flash",
      language: "python",
      opacity: 1.0
    });
    
    console.log("Config cleared and set to OpenRouter defaults");
    
    // Emit config update event
    configHelper.emit('config-updated');
    
  } catch (error) {
    console.error("Failed to clear config:", error);
  }
}
