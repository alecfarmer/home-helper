const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const execAsync = util.promisify(exec);

// IP assigned to this device when the Home VPN tunnel is active
const VPN_TUNNEL_IP = '10.6.4.10';

// Common Homebrew install locations (Apple Silicon + Intel)
const BREW_WG_PATHS = [
  '/opt/homebrew/bin/wg-quick',
  '/usr/local/bin/wg-quick',
];

// Get path to the bundled WireGuard config
function getVpnConfigPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'home-vpn.conf');
  }
  return path.join(__dirname, '../assets/home-vpn.conf');
}

// Find wg-quick binary — returns null if not installed
async function findWgQuick() {
  // Try known Homebrew paths first
  for (const p of BREW_WG_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  // Fall back to PATH
  try {
    const { stdout } = await execAsync('which wg-quick');
    const found = stdout.trim();
    if (found) return found;
  } catch { /* not in PATH */ }
  return null;
}

// Check if Homebrew is available
async function findBrew() {
  const brewPaths = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
  for (const p of brewPaths) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const { stdout } = await execAsync('which brew');
    const found = stdout.trim();
    if (found) return found;
  } catch { /* not in PATH */ }
  return null;
}

// Check status by seeing if the VPN tunnel IP is active on any interface
async function getHomeVpnStatus() {
  try {
    const wgQuick = await findWgQuick();
    if (!wgQuick) {
      return { configured: false, connected: false, status: 'not_installed' };
    }

    // Check if the tunnel IP is assigned to any network interface
    const { stdout } = await execAsync('ifconfig');
    const connected = stdout.includes(`inet ${VPN_TUNNEL_IP} `);

    return {
      configured: true,
      connected,
      connecting: false,
      status: connected ? 'connected' : 'disconnected',
    };
  } catch {
    return { configured: false, connected: false, status: 'error' };
  }
}

// Connect: run wg-quick up via osascript (shows native macOS auth dialog)
async function connectHomeVpn() {
  try {
    const wgQuick = await findWgQuick();
    if (!wgQuick) {
      return { success: false, error: 'wireguard-tools not installed. Use the Set Up button first.' };
    }

    const configPath = getVpnConfigPath();
    if (!fs.existsSync(configPath)) {
      return { success: false, error: 'VPN config not found in app bundle. Please reinstall.' };
    }

    const cmd = `${wgQuick} up "${configPath}"`;
    const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await execAsync(`osascript -e "do shell script \\"${escaped}\\" with administrator privileges"`);

    // Wait up to 10s for the tunnel IP to appear
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const { stdout } = await execAsync('ifconfig');
      if (stdout.includes(`inet ${VPN_TUNNEL_IP} `)) {
        return { success: true };
      }
    }
    return { success: false, error: 'VPN started but tunnel IP not detected. Check your connection.' };
  } catch (e) {
    // osascript exits with code 1 when user cancels the auth dialog
    if (e.message.includes('-128') || e.message.includes('cancelled') || e.message.includes('canceled')) {
      return { success: false, error: 'Authentication cancelled.' };
    }
    return { success: false, error: e.message };
  }
}

// Disconnect: run wg-quick down via osascript
async function disconnectHomeVpn() {
  try {
    const wgQuick = await findWgQuick();
    if (!wgQuick) {
      return { success: false, error: 'wireguard-tools not installed.' };
    }

    const configPath = getVpnConfigPath();
    const cmd = `${wgQuick} down "${configPath}"`;
    const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await execAsync(`osascript -e "do shell script \\"${escaped}\\" with administrator privileges"`);
    return { success: true };
  } catch (e) {
    if (e.message.includes('-128') || e.message.includes('cancelled') || e.message.includes('canceled')) {
      return { success: false, error: 'Authentication cancelled.' };
    }
    return { success: false, error: e.message };
  }
}

// One-time setup: install wireguard-tools via Homebrew
// Returns { success, needsBrew, error }
async function installHomeVpnConfig() {
  const brew = await findBrew();

  if (!brew) {
    return {
      success: false,
      needsBrew: true,
      error: 'Homebrew is required. Open Terminal and run:\n/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\nThen reopen this app.',
    };
  }

  try {
    // brew install wireguard-tools — this can take a minute; run with osascript elevation
    const cmd = `${brew} install wireguard-tools`;
    const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await execAsync(`osascript -e "do shell script \\"${escaped}\\" with administrator privileges"`, {
      timeout: 120000, // 2 minutes
    });

    // Verify it landed
    const wgQuick = await findWgQuick();
    if (!wgQuick) {
      return { success: false, error: 'Installation finished but wg-quick was not found. Try restarting the app.' };
    }

    return { success: true };
  } catch (e) {
    if (e.message.includes('-128') || e.message.includes('cancelled') || e.message.includes('canceled')) {
      return { success: false, error: 'Authentication cancelled.' };
    }
    return { success: false, error: `Install failed: ${e.message}` };
  }
}

module.exports = {
  getHomeVpnStatus,
  connectHomeVpn,
  disconnectHomeVpn,
  installHomeVpnConfig,
};
