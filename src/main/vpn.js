const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');
const execAsync = util.promisify(exec);

const HOME_VPN_NAME = 'Home-VPN-app';

// Get path to the bundled WireGuard config
function getVpnConfigPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'home-vpn.conf');
  }
  // Development: config is in src/assets/ (gitignored)
  return path.join(__dirname, '../assets/home-vpn.conf');
}

// Check if the Home VPN is configured in macOS Network Settings and its status
async function getHomeVpnStatus() {
  try {
    const { stdout } = await execAsync('scutil --nc list');
    const lines = stdout.split('\n');
    const vpnLine = lines.find(l => l.includes(HOME_VPN_NAME));
    if (!vpnLine) return { configured: false, connected: false, status: 'not_installed' };
    const connected = vpnLine.includes('(Connected)');
    const connecting = vpnLine.includes('(Connecting)');
    return {
      configured: true,
      connected,
      connecting,
      status: connected ? 'connected' : connecting ? 'connecting' : 'disconnected',
    };
  } catch {
    return { configured: false, connected: false, status: 'error' };
  }
}

// Connect the Home VPN via scutil; wait up to 15s
async function connectHomeVpn() {
  try {
    await execAsync(`scutil --nc start "${HOME_VPN_NAME}"`);
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const s = await getHomeVpnStatus();
      if (s.connected) return { success: true };
      if (!s.configured) return { success: false, error: 'VPN not configured on this Mac' };
    }
    return { success: false, error: 'Connection timed out — check your internet connection' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Disconnect the Home VPN
async function disconnectHomeVpn() {
  try {
    await execAsync(`scutil --nc stop "${HOME_VPN_NAME}"`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Install the bundled WireGuard config by opening it in WireGuard.app
// The user confirms the import inside WireGuard; after that scutil can control it
async function installHomeVpnConfig() {
  const configPath = getVpnConfigPath();
  if (!fs.existsSync(configPath)) {
    return { success: false, error: 'VPN config not found in app bundle. Please reinstall the app.' };
  }

  // Copy to tmp with the correct filename (WireGuard uses filename as the tunnel name)
  const tmpPath = path.join(os.tmpdir(), `${HOME_VPN_NAME}.conf`);
  fs.copyFileSync(configPath, tmpPath);

  return new Promise(resolve => {
    exec(`open -a WireGuard "${tmpPath}"`, err => {
      if (err) {
        resolve({
          success: false,
          needsWireGuard: true,
          error: 'WireGuard is not installed. Please install it from the Mac App Store, then tap "Set Up Home VPN" again.',
        });
      } else {
        resolve({
          success: true,
          note: 'WireGuard opened. Import the tunnel if prompted, then come back and hit Connect.',
        });
      }
    });
  });
}

module.exports = {
  getHomeVpnStatus,
  connectHomeVpn,
  disconnectHomeVpn,
  installHomeVpnConfig,
};
