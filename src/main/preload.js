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

  // VPN
  loadVpnConfigs: () => ipcRenderer.invoke('vpn:load'),
  saveVpnConfigs: configs => ipcRenderer.invoke('vpn:save', configs),
  listSystemVpns: () => ipcRenderer.invoke('vpn:list-system'),
  connectVpn: name => ipcRenderer.invoke('vpn:connect', name),
  disconnectVpn: name => ipcRenderer.invoke('vpn:disconnect', name),
  getVpnStatus: name => ipcRenderer.invoke('vpn:status', name),
  installVpnConfig: config => ipcRenderer.invoke('vpn:install', config),
  removeVpnFromSystem: name => ipcRenderer.invoke('vpn:remove-system', name),

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
  launchApp: name => ipcRenderer.invoke('app:launch', name),

  // Event listeners
  on: (channel, cb) => {
    const allowed = ['diagnostic-step', 'update-status'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, ...args) => cb(...args));
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel),
});
