const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = process.env.PORT || 3000;

async function startServer() {
  process.env.PORT = String(PORT);
  let serverFile = path.join(__dirname, '..', 'server.js');
  if (app.isPackaged && serverFile.includes('app.asar')) {
    serverFile = serverFile.replace('app.asar', 'app.asar.unpacked');
  }
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
    // Allow OAuth popups (Spotify / Google) to open inside a child window so window.opener postMessage works
    if (url.includes('spotify.com') || url.includes('google.com') || url.includes('callback.html')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 700,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (err) {
    console.log('Server initialization message:', err.message);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
