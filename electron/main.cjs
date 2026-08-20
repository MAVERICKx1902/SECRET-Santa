const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = process.env.PORT || 3000;

async function startServer() {
  process.env.PORT = String(PORT);
  const serverFile = path.join(__dirname, '..', 'server.js');
  await import(pathToFileURL(serverFile).href);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#000000',
    title: 'mpv-web',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(`http://127.0.0.1:${PORT}/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
