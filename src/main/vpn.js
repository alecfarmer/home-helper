const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');
const execAsync = util.promisify(exec);

function getCredentialsPath() {
  return path.join(app.getPath('userData'), 'vpn-credentials.enc');
}

function saveCredentials(configs) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available on this system');
  }
  const json = JSON.stringify(configs);
  const encrypted = safeStorage.encryptString(json);
  fs.writeFileSync(getCredentialsPath(), encrypted);
}

function loadCredentials() {
  const credPath = getCredentialsPath();
  if (!fs.existsSync(credPath)) return [];
  try {
    const encrypted = fs.readFileSync(credPath);
    const json = safeStorage.decryptString(encrypted);
    return JSON.parse(json);
  } catch {
    return [];
  }
}

// List VPN services currently in macOS Network Settings
async function listSystemVpns() {
  try {
    const { stdout } = await execAsync('scutil --nc list');
    const vpns = [];
    const lines = stdout.split('\n');
    for (const line of lines) {
      const m = line.match(/\*\s+\((\w+)\).*?\(([^)]+)\)\s+\{([^}]+)\}/);
      if (m) {
        vpns.push({ name: m[2].trim(), status: m[1], uuid: m[3].trim() });
      }
    }
    return vpns;
  } catch {
    return [];
  }
}

async function getVpnStatus(name) {
  const safe = name.replace(/['"\\]/g, '');
  try {
    const { stdout } = await execAsync(`scutil --nc status "${safe}"`);
    if (stdout.includes('Connected')) return 'Connected';
    if (stdout.includes('Connecting')) return 'Connecting';
    if (stdout.includes('Disconnecting')) return 'Disconnecting';
    return 'Disconnected';
  } catch {
    return 'Unknown';
  }
}

async function connectVpn(name) {
  const safe = name.replace(/['"\\]/g, '');
  await execAsync(`scutil --nc start "${safe}"`);
  // Wait for connection
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const status = await getVpnStatus(name);
    if (status === 'Connected') return { success: true };
    if (status === 'Disconnected') return { success: false, error: 'Connection refused' };
  }
  return { success: false, error: 'Timed out waiting for VPN' };
}

async function disconnectVpn(name) {
  const safe = name.replace(/['"\\]/g, '');
  await execAsync(`scutil --nc stop "${safe}"`);
  return { success: true };
}

// Remove VPN from macOS Network Settings (credentials stay in app)
async function removeVpnFromSystem(name) {
  const safe = name.replace(/['"\\]/g, '');
  try {
    await execAsync(`networksetup -removeNetworkService "${safe}"`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Create a .mobileconfig and install it to add a VPN to macOS
// This opens the System Settings installer which handles the actual provisioning
const { shell } = require('electron');
const os = require('os');

async function installVpnConfig(config) {
  const { name, server, username, password, type, sharedSecret } = config;
  const tmpFile = path.join(os.tmpdir(), `homehelper-vpn-${Date.now()}.mobileconfig`);

  const vpnType = type === 'L2TP' ? 'L2TP' : 'IKEv2';
  const plistContent = buildMobileConfig(name, server, username, password, vpnType, sharedSecret);
  fs.writeFileSync(tmpFile, plistContent);

  // Open the mobileconfig — macOS will prompt the user to install it
  shell.openPath(tmpFile);
  return { success: true, note: 'Follow the System Settings prompt to finish installing.' };
}

function buildMobileConfig(name, server, username, password, type, sharedSecret) {
  const uuid1 = generateUUID();
  const uuid2 = generateUUID();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadDisplayName</key><string>${escapeXml(name)}</string>
      <key>PayloadIdentifier</key><string>com.alec.homehelper.vpn.${uuid1}</string>
      <key>PayloadType</key><string>com.apple.vpn.managed</string>
      <key>PayloadUUID</key><string>${uuid1}</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>UserDefinedName</key><string>${escapeXml(name)}</string>
      <key>VPNType</key><string>${type === 'IKEv2' ? 'IKEv2' : 'L2TP'}</string>
      ${type === 'IKEv2' ? buildIKEv2(server, username, password) : buildL2TP(server, username, password, sharedSecret)}
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>${escapeXml(name)} VPN</string>
  <key>PayloadIdentifier</key><string>com.alec.homehelper.profile.${uuid2}</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid2}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>`;
}

function buildIKEv2(server, username, password) {
  return `
      <key>IKEv2</key>
      <dict>
        <key>AuthenticationMethod</key><string>None</string>
        <key>ChildSecurityAssociationParameters</key>
        <dict>
          <key>EncryptionAlgorithm</key><string>AES-256</string>
          <key>IntegrityAlgorithm</key><string>SHA2-256</string>
        </dict>
        <key>DeadPeerDetectionRate</key><string>Medium</string>
        <key>DisableMOBIKE</key><integer>0</integer>
        <key>DisableRedirect</key><integer>0</integer>
        <key>EnableCertificateRevocationCheck</key><integer>0</integer>
        <key>EnablePFS</key><integer>0</integer>
        <key>ExtendedAuthEnabled</key><integer>1</integer>
        <key>IKESecurityAssociationParameters</key>
        <dict>
          <key>EncryptionAlgorithm</key><string>AES-256</string>
          <key>IntegrityAlgorithm</key><string>SHA2-256</string>
        </dict>
        <key>OnDemandEnabled</key><integer>0</integer>
        <key>RemoteAddress</key><string>${escapeXml(server)}</string>
        <key>RemoteIdentifier</key><string>${escapeXml(server)}</string>
        <key>UseConfigurationAttributeInternalIPSubnet</key><integer>0</integer>
        <key>AuthName</key><string>${escapeXml(username)}</string>
        <key>AuthPassword</key><string>${escapeXml(password)}</string>
      </dict>`;
}

function buildL2TP(server, username, password, sharedSecret) {
  return `
      <key>PPP</key>
      <dict>
        <key>AuthName</key><string>${escapeXml(username)}</string>
        <key>AuthPassword</key><string>${escapeXml(password)}</string>
        <key>CommRemoteAddress</key><string>${escapeXml(server)}</string>
      </dict>
      <key>IPSec</key>
      <dict>
        <key>AuthenticationMethod</key><string>SharedSecret</string>
        <key>SharedSecret</key><string>${escapeXml(sharedSecret || '')}</string>
      </dict>`;
}

function escapeXml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16).toUpperCase();
  });
}

module.exports = {
  saveCredentials, loadCredentials, listSystemVpns, getVpnStatus,
  connectVpn, disconnectVpn, removeVpnFromSystem, installVpnConfig,
};
