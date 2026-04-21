const { exec, spawn } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const AIRPORT = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport';
const PING_TARGETS = [
  { host: '1.1.1.1', label: 'Cloudflare DNS' },
  { host: '8.8.8.8', label: 'Google DNS' },
  { host: 'google.com', label: 'Google (internet)' },
];

async function getWifiInterface() {
  try {
    const { stdout } = await execAsync('networksetup -listallhardwareports');
    const match = stdout.match(/Hardware Port: Wi-Fi[\s\S]*?Device: (en\d+)/);
    return match ? match[1] : 'en0';
  } catch {
    return 'en0';
  }
}

async function getEthernetInterface() {
  try {
    const { stdout } = await execAsync('networksetup -listallhardwareports');
    const match = stdout.match(/Hardware Port: Ethernet[\s\S]*?Device: (en\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function getCurrentWifi() {
  try {
    const iface = await getWifiInterface();
    const { stdout } = await execAsync(`networksetup -getairportnetwork ${iface}`);
    const match = stdout.match(/Current Wi-Fi Network: (.+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

async function getSavedNetworks() {
  try {
    const iface = await getWifiInterface();
    const { stdout } = await execAsync(`networksetup -listpreferredwirelessnetworks ${iface}`);
    return stdout
      .split('\n')
      .slice(1)
      .map(l => l.trim())
      .filter(l => l.length > 0);
  } catch {
    return [];
  }
}

async function scanAvailableNetworks() {
  // Try airport CLI first (works pre-Sonoma 14.4)
  try {
    const { stdout } = await execAsync(`${AIRPORT} -s`, { timeout: 10000 });
    if (stdout.trim().length > 0) {
      return parseAirportOutput(stdout);
    }
  } catch { /* fall through */ }

  // Fall back to system_profiler (slower but works on Sonoma)
  try {
    const { stdout } = await execAsync('system_profiler SPAirPortDataType', { timeout: 15000 });
    return parseSystemProfiler(stdout);
  } catch {
    return [];
  }
}

function parseAirportOutput(stdout) {
  const lines = stdout.split('\n').slice(1);
  return lines
    .map(line => {
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length < 2) return null;
      return { ssid: parts[0], signal: parts[2] || '' };
    })
    .filter(Boolean);
}

function parseSystemProfiler(stdout) {
  const networks = [];
  const matches = stdout.matchAll(/^\s{12}(.+):$/gm);
  for (const match of matches) {
    const ssid = match[1].trim();
    if (ssid && !ssid.includes(':')) networks.push({ ssid, signal: '' });
  }
  return networks;
}

async function connectToSavedNetwork(ssid) {
  // Sanitize SSID to prevent command injection
  const safe = ssid.replace(/['"\\]/g, '');
  const iface = await getWifiInterface();
  try {
    await execAsync(`networksetup -setairportnetwork ${iface} "${safe}"`);
    // Wait a moment for connection to establish
    await new Promise(r => setTimeout(r, 3000));
    const current = await getCurrentWifi();
    return { success: current === ssid, current };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function checkEthernetActive() {
  const iface = await getEthernetInterface();
  if (!iface) return false;
  try {
    const { stdout } = await execAsync(`ifconfig ${iface}`);
    return stdout.includes('status: active');
  } catch {
    return false;
  }
}

async function getDefaultGateway() {
  try {
    const { stdout } = await execAsync('route -n get default');
    const match = stdout.match(/gateway: ([0-9.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function ping(host, count = 4) {
  return new Promise(resolve => {
    const proc = spawn('ping', ['-c', String(count), '-W', '2000', host]);
    let output = '';

    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { output += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ success: false, output: 'Request timed out', packetLoss: 100, host });
    }, 12000);

    proc.on('close', code => {
      clearTimeout(timer);
      const lossMatch = output.match(/(\d+\.?\d*)% packet loss/);
      const packetLoss = lossMatch ? parseFloat(lossMatch[1]) : (code === 0 ? 0 : 100);
      const rttMatch = output.match(/min\/avg\/max.*?= [\d.]+\/([\d.]+)/);
      resolve({
        success: code === 0,
        output,
        packetLoss,
        avgMs: rttMatch ? parseFloat(rttMatch[1]) : null,
        host,
      });
    });
  });
}

async function runFullDiagnostic(onStep) {
  const results = { steps: [], overallSuccess: false, failureReason: null };

  const step = (id, label, status, detail) => {
    const s = { id, label, status, detail };
    results.steps.push(s);
    onStep?.(s);
    return s;
  };

  // 1. Check Ethernet
  onStep?.({ id: 'ethernet', label: 'Checking ethernet cable...', status: 'running' });
  const ethernetActive = await checkEthernetActive();
  if (ethernetActive) {
    step('ethernet', 'Ethernet cable', 'success', 'Ethernet is plugged in');
  } else {
    step('ethernet', 'Ethernet cable', 'skipped', 'No ethernet — checking Wi-Fi');
  }

  // 2. Check/connect Wi-Fi (only if no ethernet)
  let wifiConnected = false;
  if (!ethernetActive) {
    onStep?.({ id: 'wifi', label: 'Looking for known Wi-Fi networks...', status: 'running' });
    const currentWifi = await getCurrentWifi();
    if (currentWifi) {
      wifiConnected = true;
      step('wifi', 'Wi-Fi network', 'success', `Already connected to "${currentWifi}"`);
    } else {
      // Try to connect to a saved network
      const saved = await getSavedNetworks();
      const available = await scanAvailableNetworks();
      const availableSSIDs = new Set(available.map(n => n.ssid));
      const candidate = saved.find(s => availableSSIDs.has(s));

      if (candidate) {
        onStep?.({ id: 'wifi', label: `Connecting to "${candidate}"...`, status: 'running' });
        const conn = await connectToSavedNetwork(candidate);
        wifiConnected = conn.success;
        step('wifi', 'Wi-Fi network', conn.success ? 'success' : 'fail',
          conn.success ? `Connected to "${candidate}"` : `Could not connect to "${candidate}"`);
      } else {
        step('wifi', 'Wi-Fi network', 'fail', 'No known Wi-Fi networks found nearby');
        results.failureReason = 'no_network';
        return results;
      }
    }
  }

  // 3. Ping gateway
  onStep?.({ id: 'gateway', label: 'Testing your router...', status: 'running' });
  const gateway = await getDefaultGateway();
  if (gateway) {
    const gatewayPing = await ping(gateway, 3);
    step('gateway', 'Your router', gatewayPing.success ? 'success' : 'fail',
      gatewayPing.success
        ? `Router is responding (${gatewayPing.avgMs?.toFixed(0) ?? '?'}ms)`
        : 'Router is not responding — try restarting it');
    if (!gatewayPing.success) {
      results.failureReason = 'router_unreachable';
      return results;
    }
  } else {
    step('gateway', 'Your router', 'skip', 'Could not determine router address');
  }

  // 4. Ping internet targets
  let internetSuccess = false;
  for (const target of PING_TARGETS) {
    onStep?.({ id: 'internet', label: `Testing ${target.label}...`, status: 'running' });
    const result = await ping(target.host, 3);
    step('internet-' + target.host, target.label, result.success ? 'success' : 'fail',
      result.success
        ? `${target.label} reachable (${result.avgMs?.toFixed(0) ?? '?'}ms)`
        : `Can't reach ${target.label}`);
    if (result.success) { internetSuccess = true; break; }
  }

  if (!internetSuccess) {
    results.failureReason = 'no_internet';
    return results;
  }

  // 5. DNS check
  onStep?.({ id: 'dns', label: 'Testing that websites load...', status: 'running' });
  const dnsResult = await ping('google.com', 2);
  step('dns', 'Website names (DNS)', dnsResult.success ? 'success' : 'warn',
    dnsResult.success ? 'Websites should load normally' : 'DNS may be slow — pages might load slowly');

  results.overallSuccess = true;
  return results;
}

module.exports = {
  getCurrentWifi, getSavedNetworks, scanAvailableNetworks,
  connectToSavedNetwork, checkEthernetActive, getDefaultGateway,
  ping, runFullDiagnostic, PING_TARGETS,
};
