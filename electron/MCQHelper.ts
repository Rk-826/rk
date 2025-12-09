// MCQHelper.ts - Handles MCQ detection and answer overlay
import { BrowserWindow, screen } from "electron"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { configHelper } from "./ConfigHelper"
import { OpenAI } from "openai"

export class MCQHelper {
  private overlayWindow: BrowserWindow | null = null;
  private isOverlayHidden: boolean = false;
  private screenshotHelper: ScreenshotHelper;

  constructor(screenshotHelper: ScreenshotHelper) {
    this.screenshotHelper = screenshotHelper;
  }

  /**
   * Ensure popup (overlayWindow) exists and is loaded once
   */
  private async ensurePopup(): Promise<void> {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: _screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const overlayX = 20;
    const overlayY = screenHeight - 70;

    this.overlayWindow = new BrowserWindow({
      width: 140,
      height: 56,
      x: overlayX,
      y: overlayY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      show: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      type: "toolbar",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: true,
        webSecurity: true
      }
    });

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      html,body{margin:0;padding:0;background:transparent;height:100%;}
      .wrap{display:flex;align-items:center;justify-content:center;height:100%}
      .answer{background:rgba(0,0,0,.75);color:#00ff88;font:600 16px/1.2 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:6px 10px;border-radius:6px;border:1px solid rgba(0,0,0,.2);min-width:64px;text-align:center}
    </style></head><body>
      <div class="wrap"><div id="answer" class="answer">--</div></div>
      <script>
        window.__setAnswer = (text) => {
          const el = document.getElementById('answer');
          if (el) el.textContent = (text || '--').toLowerCase();
        }
      </script>
    </body></html>`;

    await this.overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    this.overlayWindow.setAlwaysOnTop(true, "screen-saver");
    // Start fully hidden and non-interactive
    this.overlayWindow.setIgnoreMouseEvents(true);
    this.overlayWindow.setOpacity(0);
    this.overlayWindow.setVisibleOnAllWorkspaces(false);
    this.isOverlayHidden = true;
  }

  /** Toggle popup visibility (Ctrl+/) */
  public async togglePopup(): Promise<void> {
    await this.ensurePopup();
    if (!this.overlayWindow) return;

    if (this.isOverlayHidden) {
      await this.showPopup();
    } else {
      await this.hidePopup();
    }
  }

  private async showPopup(): Promise<void> {
    if (!this.overlayWindow) return;
    // visible + interactive + kept transparent window
    this.overlayWindow.setContentProtection(true); // prevent screen recording capture
    this.overlayWindow.setIgnoreMouseEvents(false);
    this.overlayWindow.setOpacity(1);
    this.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.overlayWindow.showInactive();
    this.isOverlayHidden = false;
  }

  private async hidePopup(): Promise<void> {
    if (!this.overlayWindow) return;
    // completely invisible + non-interactive + not captured
    this.overlayWindow.setContentProtection(true); // enforce protection while hidden
    this.overlayWindow.setIgnoreMouseEvents(true);
    this.overlayWindow.setOpacity(0);
    this.overlayWindow.setVisibleOnAllWorkspaces(false);
    this.overlayWindow.hide();
    this.isOverlayHidden = true;
  }

  /** Update answer inside popup (Ctrl+.) */
  public async showAnswerInPopup(answer: string): Promise<void> {
    await this.ensurePopup();
    if (!this.overlayWindow) return;

    if (this.isOverlayHidden) await this.showPopup();
    const text = (answer || "").toLowerCase();
    await this.overlayWindow.webContents.executeJavaScript(`window.__setAnswer(${JSON.stringify(text)})`);

    // Auto-hide quickly like the screenshot HUD (brief on-screen flash)
    clearTimeout((this as any).__autoHideTimer);
    (this as any).__autoHideTimer = setTimeout(() => {
      this.hidePopup().catch(() => {});
    }, 900);
  }

  /** Update silently without showing (like Ctrl+B behaviour) */
  private async setAnswerSilently(answer: string): Promise<void> {
    await this.ensurePopup();
    if (!this.overlayWindow) return;
    // enforce hidden state
    await this.hidePopup();
    const text = (answer || "").toLowerCase();
    await this.overlayWindow.webContents.executeJavaScript(`window.__setAnswer(${JSON.stringify(text)})`);
  }

  /**
   * Capture screen and analyze MCQ, then show answer overlay
   */
  public async captureMCQAndShowAnswer(): Promise<void> {
    try {
      console.log("Starting MCQ capture and analysis...");
      
      const mainWindow = this.getMainWindow();
      let wasMainWindowVisible = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        wasMainWindowVisible = mainWindow.isVisible();
        if (wasMainWindowVisible) {
          mainWindow.hide();
        }
      }

      this.hideOverlay();

      await new Promise(resolve => setTimeout(resolve, 500));

      const screenshotPath = await this.screenshotHelper.takeScreenshot(() => {}, () => {});
      console.log("Screenshot taken:", screenshotPath);

      let answer = await this.analyzeMCQ(screenshotPath);

      // ✅ If no answer or error, show "N"
      if (!answer) {
        answer = "N";
      }

      // Update the popup silently (mimic Ctrl+B behavior: compute while hidden)
      await this.setAnswerSilently(answer);

      if (wasMainWindowVisible && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }

    } catch (error) {
      console.error("Error in MCQ capture and analysis:", error);
      // ✅ Show "N" in case of any error
      await this.showAnswerOverlay("N");
    }
  }

  /**
   * Analyze screenshot for MCQ and return the answer
   */
  private async analyzeMCQ(screenshotPath: string): Promise<string | null> {
    try {
      const config = configHelper.loadConfig();
      if (!config.apiKey) {
        console.error("No API key configured");
        return null;
      }

      // Initialize OpenRouter client
      const openai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: config.apiKey,
        defaultHeaders: {
          'HTTP-Referer': 'https://your-app.com',
          'X-Title': 'Coding Assistant App',
        }
      });

      const fs = require('fs');
      const screenshotData = fs.readFileSync(screenshotPath).toString('base64');

      const prompt = `
You are an expert at analyzing multiple choice questions (MCQs).

From the screenshot:
1. Identify ONLY the very first complete MCQ that appears from top to bottom in the image.
2. Extract the full MCQ question text and all available options exactly as seen.
3. Determine the correct answer.
4. Respond in the format:
QUESTION: <question text>
OPTIONS:
a) <option text>
b) <option text>
c) <option text>
d) <option text>
ANSWER: <answer letter/number>

If no MCQ is found, respond only with "NO_MCQ".
Do NOT include more than one MCQ in your response.
`;

      const response = await openai.chat.completions.create({
        model: "openai/gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${screenshotData}`
                }
              }
            ]
          }
        ],
        max_tokens: 200,
        temperature: 0.1
      });

      const responseText = response.choices[0].message.content?.trim() || "";
      console.log("OpenRouter full response:\n", responseText);

      if (responseText === "NO_MCQ") {
        return null;
      }

      // Extract the answer letter
      const answerMatch = responseText.match(/ANSWER:\s*([A-Da-d1-4])/);
      if (answerMatch) {
        const answerLetter = answerMatch[1].toLowerCase();
        
        // Extract the option text for the correct answer
        const optionPattern = new RegExp(`${answerLetter}\\)\\s*([^\\n]+)`, 'i');
        const optionMatch = responseText.match(optionPattern);
        
        if (optionMatch) {
          const optionText = optionMatch[1].trim();
          // Return the answer letter and first 2-3 letters of the option
          const shortText = optionText.substring(0, 3).toLowerCase();
          return `${answerLetter}) ${shortText}`;
        }
        
        return answerLetter;
      }
      
      return null;

    } catch (error) {
      console.error("Error analyzing MCQ:", error);
      console.error("OpenRouter API error:", error);
      return null;
    }
  }

  // Deprecated overlay path retained for compatibility (not used)
  private async showAnswerOverlay(_answer: string): Promise<void> {}

  /**
   * Write answer to a temporary file for easy access
   */
  private writeAnswerToFile(answer: string): void {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      
      const tempDir = os.tmpdir();
      const answerFile = path.join(tempDir, 'mcq_answer.txt');
      
      const content = `MCQ ANSWER: ${answer.toUpperCase()}\nTimestamp: ${new Date().toLocaleTimeString()}`;
      fs.writeFileSync(answerFile, content);
      
      console.log(`📝 Answer written to: ${answerFile}`);
    } catch (error) {
      console.error("Failed to write answer to file:", error);
    }
  }

  // Removed Notification path per requirement
  private showNotificationFallback(_answer: string): void {}

  public hideOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.close();
      this.overlayWindow = null;
    }
  }

  private getMainWindow(): BrowserWindow | null {
    try {
      const allWindows = BrowserWindow.getAllWindows();
      return allWindows.find(window => 
        !window.isDestroyed() && 
        (window.webContents.getURL().includes('localhost') || window.webContents.getURL().includes('file:'))
      ) || null;
    } catch (error) {
      console.warn("Error getting main window:", error);
      return null;
    }
  }

  public cleanup(): void {
    this.hideOverlay();
  }
}
