import { BrowserContext, Page, chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getDatabase } from '../storage/database';
import { encrypt, decrypt } from '../storage/api-keys';

export interface BrowserSessionState {
  cookies: any[];
  localStorage: Record<string, string>;
}

export class BrowserPool {
  private contexts: Map<string, BrowserContext> = new Map();
  private busyModels: Set<string> = new Set();
  private userDataDir: string;

  constructor() {
    this.userDataDir = path.join(app.getPath('userData'), 'browser-profiles');
    fs.mkdirSync(this.userDataDir, { recursive: true });
  }

  async getContext(modelId: string): Promise<BrowserContext> {
    if (this.contexts.has(modelId)) {
      const context = this.contexts.get(modelId)!;
      // Check if context is still valid
      try {
        // Simple health check
        return context;
      } catch {
        // Context is broken, remove it
        this.contexts.delete(modelId);
      }
    }

    // Create new context for this model
    const profileDir = path.join(this.userDataDir, modelId);
    fs.mkdirSync(profileDir, { recursive: true });

    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });

    // Apply stealth
    await this.applyStealth(context);

    this.contexts.set(modelId, context);
    return context;
  }

  private async applyStealth(context: BrowserContext): Promise<void> {
    // Apply playwright-stealth techniques
    await context.addInitScript(() => {
      // Pass the User-Agent Test
      const userAgent = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', {
        get: () => userAgent.replace(/HeadlessChrome/, 'Chrome')
      });

      // Pass the Plugins Test
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });

      // Pass the Languages Test
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });

      // Override the navigator.webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });

      // Mock permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = ((parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters)) as typeof navigator.permissions.query;
    });
  }

  async getPage(modelId: string, baseUrl: string): Promise<Page> {
    const context = await this.getContext(modelId);
    const pages = context.pages();
    
    let page: Page;
    if (pages.length > 0) {
      page = pages[0];
      // Navigate to base URL if needed
      if (page.url() !== baseUrl && !page.url().startsWith(baseUrl)) {
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
      }
    } else {
      page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
    }

    return page;
  }

  async markBusy(modelId: string): Promise<void> {
    this.busyModels.add(modelId);
  }

  async markFree(modelId: string): Promise<void> {
    this.busyModels.delete(modelId);
  }

  isBusy(modelId: string): boolean {
    return this.busyModels.has(modelId);
  }

  async saveSessionState(modelId: string): Promise<void> {
    const context = this.contexts.get(modelId);
    if (!context) return;

    const pages = context.pages();
    if (pages.length === 0) return;

    const page = pages[0];
    
    // Get cookies
    const cookies = await context.cookies();
    
    // Get localStorage (need to evaluate in page context)
    const localStorageData = await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          data[key] = localStorage.getItem(key) || '';
        }
      }
      return data;
    });

    const state: BrowserSessionState = {
      cookies,
      localStorage: localStorageData
    };

    // Encrypt and save to database
    const db = getDatabase();
    const encrypted = encrypt(JSON.stringify(state));
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO accounts (id, model_name, type, state_encrypted, last_used_at, available)
      VALUES (?, ?, 'web', ?, ?, 1)
    `);
    
    stmt.run(modelId, modelId, JSON.stringify(encrypted), Date.now());
  }

  async loadSessionState(modelId: string): Promise<boolean> {
    const db = getDatabase();
    const stmt = db.prepare('SELECT state_encrypted FROM accounts WHERE model_name = ? AND type = "web" AND available = 1');
    const result = stmt.get(modelId) as { state_encrypted: string } | undefined;

    if (!result) {
      return false;
    }

    try {
      const encrypted = JSON.parse(result.state_encrypted);
      const decrypted = decrypt(encrypted.encrypted, encrypted.iv, encrypted.authTag);
      const state: BrowserSessionState = JSON.parse(decrypted);

      const context = await this.getContext(modelId);
      
      // Restore cookies
      await context.addCookies(state.cookies);

      // Restore localStorage will happen when page is created
      
      return true;
    } catch (error) {
      console.error('Failed to restore session state:', error);
      return false;
    }
  }

  async closeContext(modelId: string): Promise<void> {
    const context = this.contexts.get(modelId);
    if (context) {
      await context.close();
      this.contexts.delete(modelId);
      this.busyModels.delete(modelId);
    }
  }

  async closeAll(): Promise<void> {
    for (const [modelId, context] of this.contexts.entries()) {
      await context.close();
    }
    this.contexts.clear();
    this.busyModels.clear();
  }
}
