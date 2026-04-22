const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const network = require('./network');
const vpn = require('./vpn');
const ubiquiti = require('./ubiquiti');
const { initUpdater, checkNow } = require('./updater');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#F1F5F9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required to run system commands via main process
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in dev mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  initUpdater(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Network IPC ──────────────────────────────────────────────────────────────

ipcMain.handle('net:current-wifi', () => network.getCurrentWifi());
ipcMain.handle('net:saved-networks', () => network.getSavedNetworks());
ipcMain.handle('net:scan', () => network.scanAvailableNetworks());
ipcMain.handle('net:connect', (_, ssid) => network.connectToSavedNetwork(ssid));
ipcMain.handle('net:ping', (_, host, count) => network.ping(host, count));
ipcMain.handle('net:check-ethernet', () => network.checkEthernetActive());
ipcMain.handle('net:gateway', () => network.getDefaultGateway());

ipcMain.handle('net:full-diagnostic', async event => {
  return network.runFullDiagnostic(step => {
    // Stream each step to the renderer as it happens
    event.sender.send('diagnostic-step', step);
  });
});

// ── VPN IPC ──────────────────────────────────────────────────────────────────

ipcMain.handle('vpn:load', () => vpn.loadCredentials());
ipcMain.handle('vpn:save', (_, configs) => { vpn.saveCredentials(configs); return true; });
ipcMain.handle('vpn:list-system', () => vpn.listSystemVpns());
ipcMain.handle('vpn:connect', (_, name) => vpn.connectVpn(name));
ipcMain.handle('vpn:disconnect', (_, name) => vpn.disconnectVpn(name));
ipcMain.handle('vpn:status', (_, name) => vpn.getVpnStatus(name));
ipcMain.handle('vpn:install', (_, config) => vpn.installVpnConfig(config));
ipcMain.handle('vpn:remove-system', (_, name) => vpn.removeVpnFromSystem(name));

// ── Ubiquiti IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('ubiquiti:set-config', (_, config) => { ubiquiti.setConfig(config); return true; });
ipcMain.handle('ubiquiti:login', (_, user, pass) => ubiquiti.login(user, pass));
ipcMain.handle('ubiquiti:clients', () => ubiquiti.getClients());
ipcMain.handle('ubiquiti:networks', () => ubiquiti.getNetworks());
ipcMain.handle('ubiquiti:system-info', () => ubiquiti.getSystemInfo());
ipcMain.handle('ubiquiti:test', () => ubiquiti.testConnection());

// ── App IPC ───────────────────────────────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('updater:check-now', () => checkNow(mainWindow));

// Launch a named macOS application (e.g. "UID Enterprise")
ipcMain.handle('app:launch', (_, appName) => {
  const { exec } = require('child_process');
  const safe = appName.replace(/[";|&$`\\]/g, '');
  exec(`open -a "${safe}"`, err => {
    if (err) console.warn(`Could not open ${safe}:`, err.message);
  });
  return true;
});
