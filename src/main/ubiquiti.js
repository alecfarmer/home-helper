const https = require('https');
const http = require('http');

// Ubiquiti UniFi Controller API client
// Handles self-signed certs (common in home setups)

let sessionCookie = null;
let controllerConfig = null;

function setConfig(config) {
  controllerConfig = config;
  sessionCookie = null;
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!controllerConfig) return reject(new Error('Ubiquiti controller not configured'));
    const { host, port, https: useHttps } = controllerConfig;
    const protocol = useHttps !== false ? https : http;
    const postData = body ? JSON.stringify(body) : null;

    const options = {
      hostname: host,
      port: port || (useHttps !== false ? 443 : 80),
      path,
      method,
      rejectUnauthorized: false, // Accept self-signed certs (common for home UniFi)
      headers: {
        'Content-Type': 'application/json',
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    };

    const req = protocol.request(options, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        // Capture session cookie on login
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
          const token = setCookie.find(c => c.startsWith('TOKEN=') || c.startsWith('unifises='));
          if (token) sessionCookie = token.split(';')[0];
        }
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Connection timed out')); });
    if (postData) req.write(postData);
    req.end();
  });
}

async function login(username, password) {
  sessionCookie = null;
  try {
    const res = await request('POST', '/api/auth/login', { username, password });
    if (res.status === 200) return { success: true };
    // Try legacy login endpoint
    const res2 = await request('POST', '/api/login', { username, password });
    return { success: res2.status === 200 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getClients() {
  const res = await request('GET', '/proxy/network/api/s/default/stat/sta');
  if (res.status !== 200) throw new Error('Failed to get clients');
  return (res.data.data || []).map(c => ({
    name: c.hostname || c.name || 'Unknown Device',
    mac: c.mac,
    ip: c.ip,
    ssid: c.essid,
    signal: c.signal,
    connected: true,
  }));
}

async function getNetworks() {
  const res = await request('GET', '/proxy/network/api/s/default/rest/wlanconf');
  if (res.status !== 200) throw new Error('Failed to get networks');
  return (res.data.data || []).map(n => ({
    name: n.name,
    enabled: n.enabled,
    security: n.security,
    vlan: n.vlanid,
  }));
}

async function getSystemInfo() {
  const res = await request('GET', '/proxy/network/api/s/default/stat/health');
  if (res.status !== 200) throw new Error('Failed to get system info');
  return res.data.data || [];
}

async function testConnection() {
  if (!controllerConfig) return { connected: false, error: 'Not configured' };
  try {
    const res = await request('GET', '/api/self');
    return { connected: res.status === 200 || res.status === 401 };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

module.exports = { setConfig, login, getClients, getNetworks, getSystemInfo, testConnection };
