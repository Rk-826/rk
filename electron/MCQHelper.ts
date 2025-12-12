// MCQHelper.ts - Handles room chat overlay (formerly MCQ detection)
import { BrowserWindow, screen } from "electron"
import { ScreenshotHelper } from "./ScreenshotHelper"
import WebSocket from "ws"

export class MCQHelper {
  private overlayWindow: BrowserWindow | null = null;
  private isOverlayHidden: boolean = false;
  private screenshotHelper: ScreenshotHelper;
  private roomWs: WebSocket | null = null;
  public currentRoomInfo: { code: string; userId: string; roomServer: string } | null = null;
  private messagesEnabled: boolean = true; // Toggle for showing messages in overlay

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
      width: 420,
      height: 80,
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
      .message{background:rgba(0,0,0,.85);color:#00ff88;font:600 14px/1.4 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:8px 12px;border-radius:6px;border:1px solid rgba(0,255,136,.3);max-width:400px;word-wrap:break-word;text-align:left}
    </style></head><body>
      <div class="wrap"><div id="message" class="message">--</div></div>
      <script>
        window.__setMessage = (text) => {
          const el = document.getElementById('message');
          if (el) el.textContent = (text || '--');
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

  /** Update message inside popup */
  public async showMessageInPopup(message: string): Promise<void> {
    await this.ensurePopup();
    if (!this.overlayWindow) return;

    if (this.isOverlayHidden) await this.showPopup();
    await this.overlayWindow.webContents.executeJavaScript(`window.__setMessage(${JSON.stringify(message)})`);

    // Auto-hide after showing message
    clearTimeout((this as any).__autoHideTimer);
    (this as any).__autoHideTimer = setTimeout(() => {
      this.hidePopup().catch(() => {});
    }, 3000); // Show longer for chat messages
  }

  /** Set room connection info and connect WebSocket */
  public setRoomConnection(info: { code: string; userId: string; roomServer: string } | null): void {
    // Disconnect existing connection
    if (this.roomWs) {
      this.roomWs.close();
      this.roomWs = null;
    }

    this.currentRoomInfo = info;

    if (!info) {
      return;
    }

    // Connect to room WebSocket
    try {
      const wsBase = new URL(info.roomServer);
      wsBase.protocol = wsBase.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${wsBase.origin}/ws?code=${info.code}&userId=${info.userId}`;
      
      console.log("MCQHelper connecting to room:", wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        console.log("MCQHelper WebSocket opened, joining room");
        try {
          ws.send(JSON.stringify({ type: "join", code: info.code, userId: info.userId }));
          console.log("Join message sent to room");
        } catch (e) {
          console.error("Error sending join message:", e);
        }
      });

      ws.on("message", (data) => {
        try {
          const payload = JSON.parse(data.toString());
          console.log("MCQHelper received message:", payload.type);
          if (payload.type === "chat" && payload.message && this.messagesEnabled) {
            // Show chat message in overlay only if messages are enabled
            this.showMessageInPopup(payload.message).catch(console.error);
          } else if (payload.type === "system" && payload.message && this.messagesEnabled) {
            // Show system messages too, only if messages are enabled
            this.showMessageInPopup(payload.message).catch(console.error);
          } else if (payload.type === "joined") {
            console.log("MCQHelper successfully joined room:", payload.code);
          } else if (payload.type === "error") {
            console.error("MCQHelper received error:", payload.message);
          }
        } catch (e) {
          console.error("Error parsing room message:", e);
        }
      });

      ws.on("error", (error) => {
        console.error("Room WebSocket error:", error);
        console.error("Failed to connect to:", wsUrl);
      });

      ws.on("close", (code, reason) => {
        console.log(`Room WebSocket closed (code: ${code}, reason: ${reason?.toString() || 'none'})`);
        if (this.roomWs === ws) {
          this.roomWs = null;
        }
        // Don't clear currentRoomInfo on close - we might want to reconnect
      });

      this.roomWs = ws;
      console.log("WebSocket instance created, waiting for connection...");
    } catch (error) {
      console.error("Error creating WebSocket connection:", error);
      console.error("Room info was:", info);
    }
  }

  /** Send screenshot to room */
  public async sendScreenshotToRoom(imageData: string): Promise<void> {
    if (!this.currentRoomInfo) {
      console.log("Cannot send screenshot: no room info");
      return;
    }
    
    if (!this.roomWs) {
      console.log("Cannot send screenshot: no WebSocket connection, attempting to reconnect...");
      // Try to reconnect
      this.setRoomConnection(this.currentRoomInfo);
      // Wait a bit for connection
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (!this.roomWs || this.roomWs.readyState !== WebSocket.OPEN) {
      console.log(`Cannot send screenshot: WebSocket not open (state: ${this.roomWs?.readyState || 'null'})`);
      console.log("Current room info:", this.currentRoomInfo);
      return;
    }

    try {
      this.roomWs.send(JSON.stringify({
        type: "image",
        code: this.currentRoomInfo.code,
        userId: this.currentRoomInfo.userId,
        image: imageData,
        ts: Date.now()
      }));
      console.log("Screenshot sent to room");
    } catch (error) {
      console.error("Error sending screenshot to room:", error);
    }
  }

  /**
   * Toggle message visibility in overlay
   */
  public toggleMessages(): void {
    this.messagesEnabled = !this.messagesEnabled;
    console.log(`MCQHelper: Messages ${this.messagesEnabled ? 'enabled' : 'disabled'}`);
    // Show status briefly
    this.showMessageInPopup(`Messages ${this.messagesEnabled ? 'ON' : 'OFF'}`).catch(console.error);
  }

  /**
   * Capture screen and send to room (Ctrl+.)
   */
  public async captureAndSendToRoom(): Promise<void> {
    try {
      console.log("Starting screenshot capture for room...");
      
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

      // Convert screenshot to base64
      const fs = require('fs');
      const screenshotData = fs.readFileSync(screenshotPath).toString('base64');
      const dataUrl = `data:image/png;base64,${screenshotData}`;

      // Send to room
      await this.sendScreenshotToRoom(dataUrl);

      if (wasMainWindowVisible && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }

    } catch (error) {
      console.error("Error in screenshot capture and send:", error);
    }
  }


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
    if (this.roomWs) {
      this.roomWs.close();
      this.roomWs = null;
    }
    this.currentRoomInfo = null;
  }
}
