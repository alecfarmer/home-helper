const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Network
  getCurrentWifi: () => ipcRenderer.invoke('net:current-wifi'),
  getSavedNetworks: () => ipcRenderer.invoke('net:saved-networks'),
  scanNetworks: () => ipcRenderer.invoke('net:scan'),
  connectToNetwork: ssid => ipcRenderer.invoke('net:connect', ssid),
  ping: (host, count) => ipcRenderer.invoke('net:ping', host, count),
  checkEthernet: () => ipcRenderer.invoke('net:check-ethernet'),
  getGateway: () => ipcRenderer.invoke('net:gateway'),
  runFullDiagnostic: () => ipcRenderer.invoke('net:full-diagnostic'),

  // Home VPN (WireGuard, pre-configured)
  getHomeVpnStatus: () => ipcRenderer.invoke('vpn:home-status'),
  connectHomeVpn: () => ipcRenderer.invoke('vpn:home-connect'),
  disconnectHomeVpn: () => ipcRenderer.invoke('vpn:home-disconnect'),
  installHomeVpn: () => ipcRenderer.invoke('vpn:home-install'),

  // Ubiquiti
  ubiquiti: {
    setConfig: config => ipcRenderer.invoke('ubiquiti:set-config', config),
    login: (user, pass) => ipcRenderer.invoke('ubiquiti:login', user, pass),
    getClients: () => ipcRenderer.invoke('ubiquiti:clients'),
    getNetworks: () => ipcRenderer.invoke('ubiquiti:networks'),
    getSystemInfo: () => ipcRenderer.invoke('ubiquiti:system-info'),
    testConnection: () => ipcRenderer.invoke('ubiquiti:test'),
  },

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('updater:check-now'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getAlecEmail: () => ipcRenderer.invoke('app:alec-email'),
  launchApp: name => ipcRenderer.invoke('app:launch', name),

  // Event listeners
  on: (channel, cb) => {
    const allowed = ['diagnostic-step', 'update-status'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, ...args) => cb(...args));
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel),
});
