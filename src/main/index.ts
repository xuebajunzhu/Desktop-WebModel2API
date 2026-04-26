import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import path from 'path';
import { startApiServer, stopApiServer } from './api-server';
import { initDatabase } from './storage/database';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let apiServerRunning = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../../build/icon.png'),
    show: true
  });

  // Load the React app in development or production
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow?.hide();
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../../build/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Web2API',
      click: () => {
        mainWindow?.show();
      }
    },
    {
      label: 'Toggle API Server',
      click: async () => {
        await toggleApiServer();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Web2API - LLM Web to API Gateway');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
  });
}

async function toggleApiServer() {
  if (apiServerRunning) {
    await stopApiServer();
    apiServerRunning = false;
    updateTrayStatus('inactive');
  } else {
    await startApiServer();
    apiServerRunning = true;
    updateTrayStatus('active');
  }
  mainWindow?.webContents.send('api-server-toggled', apiServerRunning);
}

function updateTrayStatus(status: 'active' | 'busy' | 'error') {
  // Update tray icon based on status
  const colors = { active: 'green', busy: 'orange', error: 'red' };
  // Implementation for dynamic tray icon
}

app.whenReady().then(async () => {
  await initDatabase();
  createWindow();
  createTray();
  
  // Start API server by default
  await startApiServer();
  apiServerRunning = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit, just hide to tray
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  await stopApiServer();
});

// IPC handlers
ipcMain.handle('get-api-status', () => apiServerRunning);
ipcMain.handle('toggle-api-server', toggleApiServer);
