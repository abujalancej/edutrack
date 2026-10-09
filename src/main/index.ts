import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'node:path';
import { AppDatabase } from './database/database';
import { registerIpc } from './ipc/register';

let database: AppDatabase | undefined;
const appIconPath = join(__dirname, '../../build/icon.png');

function createWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1040, minHeight: 680,
    backgroundColor: '#f4f5f1', title: 'EduTrack', icon: appIconPath,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(join(__dirname, '../../dist/index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (process.platform === 'darwin') app.dock?.setIcon(appIconPath);
  database = new AppDatabase(join(app.getPath('userData'), 'edutrack.sqlite'));
  registerIpc(database);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => database?.close());
