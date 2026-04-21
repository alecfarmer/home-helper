/* ── State ─────────────────────────────────────────────── */
const state = {
  currentScreen: 'home',
  diagRunning: false,
  currentWifi: null,
  vpnConfigs: [],     // configs stored in app
  alecEmail: localStorage.getItem('alecEmail') || '',
  ubiquitiConfig: JSON.parse(localStorage.getItem('ubiquitiConfig') || 'null'),
};

/* ── Helpers ───────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const show = (...ids) => ids.forEach(id => $( id )?.classList.remove('hidden'));
const hide = (...ids) => ids.forEach(id => $( id )?.classList.add('hidden'));

function setScreen(name) {
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const screen = $(`screen-${name}`);
  if (screen) { screen.classList.remove('hidden'); screen.classList.add('active'); }
  const nav = document.querySelector(`[data-screen="${name}"]`);
  if (nav) nav.classList.add('active');
  state.currentScreen = name;
}

function toast(msg, type = 'info') {
  // Simple inline toast via wifi badge
  const badge = $('wifi-badge');
  badge.textContent = msg;
  badge.style.color = type === 'error' ? '#F87171' : type === 'success' ? '#4ADE80' : '#94A3B8';
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success'));
}

function buildContactMessage(failureReason, steps) {
  const time = new Date().toLocaleString();
  const stepSummary = steps.map(s => `  ${s.status === 'success' ? '✓' : s.status === 'fail' ? '✗' : '○'} ${s.label}: ${s.detail || ''}`).join('\n');
  return `Home Helper Diagnostic Report
Time: ${time}
Issue: ${failureReason}

Steps completed:
${stepSummary}`;
}

/* ── Navigation ────────────────────────────────────────── */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const screen = item.dataset.screen;
    setScreen(screen);
    if (screen === 'vpn') loadVpnScreen();
    if (screen === 'ubiquiti') initUbiquitiScreen();
    if (screen === 'settings') loadSettings();
  });
});

/* ── Wi-Fi Status Badge ────────────────────────────────── */
async function refreshWifiStatus() {
  try {
    const wifi = await window.api.getCurrentWifi();
    state.currentWifi = wifi;
    const badge = $('wifi-badge');
    if (wifi) {
      badge.textContent = `📶 ${wifi}`;
      badge.style.color = '#4ADE80';
    } else {
      badge.textContent = '📵 No Wi-Fi';
      badge.style.color = '#F87171';
    }

    const chip = $('home-current-wifi');
    if (chip) {
      chip.textContent = wifi ? `Connected to: ${wifi}` : 'Not connected to Wi-Fi';
      chip.className = `status-chip ${wifi ? 'connected' : 'disconnected'}`;
    }
  } catch {
    $('wifi-badge').textContent = '📵 No Wi-Fi';
  }
}

setInterval(refreshWifiStatus, 15000);
refreshWifiStatus();

/* ── HOME SCREEN ───────────────────────────────────────── */
let diagSteps = [];
let diagCancelled = false;

$('btn-fix').addEventListener('click', startDiagnostic);
$('btn-fix-again').addEventListener('click', resetHome);
$('btn-try-again').addEventListener('click', resetHome);
$('btn-cancel').addEventListener('click', () => { diagCancelled = true; resetHome(); });
$('btn-copy-details').addEventListener('click', () => {
  copyToClipboard($('contact-details').textContent);
});
$('btn-email-alec').addEventListener('click', emailAlec);

function resetHome() {
  diagCancelled = false;
  diagSteps = [];
  $('steps-list').innerHTML = '';
  show('home-idle');
  hide('home-running', 'home-success', 'home-failure');
  refreshWifiStatus();
}

async function startDiagnostic() {
  if (state.diagRunning) return;
  state.diagRunning = true;
  diagSteps = [];
  diagCancelled = false;

  hide('home-idle', 'home-success', 'home-failure');
  show('home-running');
  $('steps-list').innerHTML = '';

  // Listen for streaming steps from main process
  window.api.on('diagnostic-step', onDiagStep);

  try {
    const result = await window.api.runFullDiagnostic();
    window.api.off('diagnostic-step');

    if (diagCancelled) { resetHome(); return; }

    state.diagRunning = false;
    hide('home-running');

    if (result.overallSuccess) {
      show('home-success');
    } else {
      showFailure(result.failureReason, result.steps);
    }
  } catch (err) {
    state.diagRunning = false;
    window.api.off('diagnostic-step');
    showFailure('unexpected_error', diagSteps);
  }

  refreshWifiStatus();
}

function onDiagStep(step) {
  if (diagCancelled) return;

  // Update existing step or add new one
  const existing = diagSteps.find(s => s.id === step.id);
  if (existing) {
    Object.assign(existing, step);
    updateStepDOM(step);
  } else {
    diagSteps.push(step);
    appendStepDOM(step);
  }
}

function stepIcon(status) {
  if (status === 'running') return '<div class="spinner"></div>';
  if (status === 'success') return '✅';
  if (status === 'fail') return '❌';
  if (status === 'skipped' || status === 'skip') return '⏭️';
  if (status === 'warn') return '⚠️';
  return '○';
}

function appendStepDOM(step) {
  const list = $('steps-list');
  const el = document.createElement('div');
  el.className = `step-item ${step.status}`;
  el.id = `step-${step.id}`;
  el.innerHTML = `
    <div class="step-icon">${stepIcon(step.status)}</div>
    <div class="step-left">
      <div class="step-label">${step.label}</div>
      ${step.detail ? `<div class="step-detail">${step.detail}</div>` : ''}
    </div>`;
  list.appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateStepDOM(step) {
  const el = $(`step-${step.id}`);
  if (!el) { appendStepDOM(step); return; }
  el.className = `step-item ${step.status}`;
  el.querySelector('.step-icon').innerHTML = stepIcon(step.status);
  el.querySelector('.step-label').textContent = step.label;
  const detailEl = el.querySelector('.step-detail');
  if (step.detail) {
    if (detailEl) detailEl.textContent = step.detail;
    else el.querySelector('.step-left').insertAdjacentHTML('beforeend', `<div class="step-detail">${step.detail}</div>`);
  }
}

function showFailure(reason, steps) {
  show('home-failure');
  const messages = {
    no_network: "I couldn't find any of your usual Wi-Fi networks nearby. The Wi-Fi router might be off.",
    router_unreachable: "I connected to Wi-Fi but your router isn't responding. Try unplugging it for 30 seconds and plugging it back in.",
    no_internet: "Your router is working, but there's no internet signal coming into the house. Your internet provider might be having an outage.",
    unexpected_error: "Something unexpected went wrong while checking your connection.",
  };

  $('failure-message').textContent = messages[reason] || "I wasn't able to fix the problem automatically.";

  const report = buildContactMessage(reason, steps || diagSteps);
  $('contact-details').textContent = report;
}

function emailAlec() {
  const email = state.alecEmail || 'alec@example.com';
  const subject = encodeURIComponent('Internet Problem — Home Helper Report');
  const body = encodeURIComponent($('contact-details').textContent || $('modal-details').textContent);
  window.open(`mailto:${email}?subject=${subject}&body=${body}`);
}

/* ── TOOLS SCREEN ──────────────────────────────────────── */
$('btn-ping').addEventListener('click', runPing);
$('ping-input').addEventListener('keydown', e => { if (e.key === 'Enter') runPing(); });
$('btn-scan-wifi').addEventListener('click', scanWifi);
$('btn-refresh-saved').addEventListener('click', loadSavedNetworks);

async function runPing() {
  const host = $('ping-input').value.trim();
  if (!host) return;

  $('btn-ping').textContent = 'Pinging…';
  $('btn-ping').disabled = true;
  show('ping-result');
  $('ping-result').textContent = `Pinging ${host}…`;

  try {
    const result = await window.api.ping(host, 4);
    $('ping-result').textContent = result.success
      ? `✅ ${host} is reachable\nAvg response: ${result.avgMs?.toFixed(1) ?? '?'} ms\nPacket loss: ${result.packetLoss}%\n\n${result.output}`
      : `❌ ${host} is not reachable\n\n${result.output}`;
  } catch (e) {
    $('ping-result').textContent = `Error: ${e.message}`;
  }

  $('btn-ping').textContent = 'Ping';
  $('btn-ping').disabled = false;
}

async function scanWifi() {
  const list = $('wifi-list');
  list.innerHTML = '<div class="list-item">Scanning… this may take a few seconds</div>';
  $('btn-scan-wifi').disabled = true;

  const [available, saved] = await Promise.all([
    window.api.scanNetworks(),
    window.api.getSavedNetworks(),
  ]);
  const savedSet = new Set(saved);

  list.innerHTML = '';
  if (!available.length) {
    list.innerHTML = '<div class="list-item">No networks found.</div>';
  } else {
    available.forEach(net => {
      const isSaved = savedSet.has(net.ssid);
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `
        <div class="list-item-left">
          <div class="list-item-name">${isSaved ? '⭐ ' : ''}${net.ssid}</div>
          <div class="list-item-sub">${isSaved ? 'Saved network' : 'Unknown network'}${net.signal ? ` · Signal: ${net.signal}` : ''}</div>
        </div>
        ${isSaved ? `<button class="btn-secondary" onclick="connectToWifi('${net.ssid.replace(/'/g, "\\'")}')">Connect</button>` : ''}`;
      list.appendChild(item);
    });
  }
  $('btn-scan-wifi').disabled = false;
}

async function loadSavedNetworks() {
  const list = $('wifi-list');
  list.innerHTML = '<div class="list-item">Loading saved networks…</div>';
  const saved = await window.api.getSavedNetworks();
  list.innerHTML = '';
  if (!saved.length) {
    list.innerHTML = '<div class="list-item">No saved networks found.</div>';
    return;
  }
  saved.forEach(ssid => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="list-item-left">
        <div class="list-item-name">⭐ ${ssid}</div>
        <div class="list-item-sub">Saved network</div>
      </div>
      <button class="btn-secondary" onclick="connectToWifi('${ssid.replace(/'/g, "\\'")}')">Connect</button>`;
    list.appendChild(item);
  });
}

window.connectToWifi = async function(ssid) {
  toast(`Connecting to ${ssid}…`);
  const result = await window.api.connectToNetwork(ssid);
  if (result.success) {
    toast(`Connected to ${ssid}!`, 'success');
    refreshWifiStatus();
  } else {
    toast(`Failed to connect to ${ssid}`, 'error');
  }
};

// Quick test buttons
document.querySelectorAll('.btn-test').forEach(btn => {
  btn.addEventListener('click', async () => {
    const host = btn.dataset.host;
    btn.textContent = `⏳ ${btn.dataset.label}`;
    btn.disabled = true;

    const result = await window.api.ping(host, 3);
    btn.className = `btn-test ${result.success ? 'pass' : 'fail'}`;
    btn.textContent = `${result.success ? '✅' : '❌'} ${btn.dataset.label}${result.avgMs ? ` (${result.avgMs.toFixed(0)}ms)` : ''}`;
    btn.disabled = false;
  });
});

/* ── VPN SCREEN ────────────────────────────────────────── */
$('btn-add-vpn').addEventListener('click', () => {
  show('vpn-form');
  $('btn-add-vpn').classList.add('hidden');
});

$('btn-cancel-vpn').addEventListener('click', () => {
  hide('vpn-form');
  show('btn-add-vpn');
});

$('vpn-type').addEventListener('change', () => {
  const isL2TP = $('vpn-type').value === 'L2TP';
  $('vpn-secret-row').style.display = isL2TP ? 'block' : 'none';
});

$('btn-save-vpn').addEventListener('click', async () => {
  const config = {
    name: $('vpn-name').value.trim(),
    server: $('vpn-server').value.trim(),
    username: $('vpn-user').value.trim(),
    password: $('vpn-pass').value.trim(),
    type: $('vpn-type').value,
    sharedSecret: $('vpn-secret').value.trim(),
  };

  if (!config.name || !config.server || !config.username) {
    toast('Please fill in Name, Server, and Username.', 'error');
    return;
  }

  state.vpnConfigs.push(config);
  await window.api.saveVpnConfigs(state.vpnConfigs);

  const result = await window.api.installVpnConfig(config);
  toast(result.note || 'VPN saved! Follow the System Settings prompt.', 'success');

  // Clear form
  ['vpn-name','vpn-server','vpn-user','vpn-pass','vpn-secret'].forEach(id => $( id ).value = '');
  hide('vpn-form');
  show('btn-add-vpn');
  loadVpnScreen();
});

async function loadVpnScreen() {
  state.vpnConfigs = await window.api.loadVpnConfigs() || [];
  const systemVpns = await window.api.listSystemVpns();
  const list = $('vpn-list');
  list.innerHTML = '';

  if (!state.vpnConfigs.length && !systemVpns.length) {
    list.innerHTML = '<div class="card"><p class="card-desc">No VPN connections saved yet. Click "+ Add VPN" to get started.</p></div>';
    return;
  }

  // Show system VPNs (can connect/disconnect)
  for (const vpnItem of systemVpns) {
    const status = await window.api.getVpnStatus(vpnItem.name);
    const connected = status === 'Connected';
    const card = document.createElement('div');
    card.className = 'vpn-card';
    card.id = `vpn-card-${vpnItem.uuid}`;
    card.innerHTML = `
      <div>
        <div class="vpn-card-name">${vpnItem.name}</div>
        <div class="vpn-card-meta">${connected ? '🟢 Connected' : '⚪ Disconnected'}</div>
      </div>
      <div class="vpn-card-actions">
        <button class="btn-${connected ? 'ghost' : 'primary'}" onclick="toggleVpn('${vpnItem.name}', ${connected})">
          ${connected ? 'Disconnect' : 'Connect'}
        </button>
        <button class="btn-ghost" onclick="removeVpnFromSystem('${vpnItem.name}')">Remove from Mac</button>
      </div>`;
    list.appendChild(card);
  }
}

window.toggleVpn = async function(name, isConnected) {
  toast(`${isConnected ? 'Disconnecting' : 'Connecting'} ${name}…`);
  if (isConnected) {
    await window.api.disconnectVpn(name);
    toast(`Disconnected from ${name}`, 'success');
  } else {
    const result = await window.api.connectVpn(name);
    toast(result.success ? `Connected to ${name}!` : `Failed: ${result.error}`, result.success ? 'success' : 'error');
  }
  loadVpnScreen();
};

window.removeVpnFromSystem = async function(name) {
  if (!confirm(`Remove "${name}" from macOS Network Settings?\n\nCredentials will stay saved in Home Helper so you can reinstall it later.`)) return;
  const result = await window.api.removeVpnFromSystem(name);
  toast(result.success ? 'Removed from macOS. Credentials still saved in app.' : `Error: ${result.error}`,
    result.success ? 'success' : 'error');
  loadVpnScreen();
};

/* ── UBIQUITI SCREEN ───────────────────────────────────── */
function initUbiquitiScreen() {
  if (state.ubiquitiConfig) {
    $('ub-host').value = state.ubiquitiConfig.host || '';
    $('ub-user').value = state.ubiquitiConfig.username || '';
  }
}

$('btn-ub-connect').addEventListener('click', async () => {
  const host = $('ub-host').value.trim();
  const username = $('ub-user').value.trim();
  const password = $('ub-pass').value.trim();

  if (!host || !username || !password) {
    showUbiquitiStatus('Please fill in all fields.', 'error');
    return;
  }

  $('btn-ub-connect').textContent = 'Connecting…';
  $('btn-ub-connect').disabled = true;

  const config = { host, username, https: true };
  state.ubiquitiConfig = { host, username };
  localStorage.setItem('ubiquitiConfig', JSON.stringify(state.ubiquitiConfig));

  await window.api.ubiquiti.setConfig(config);
  const loginResult = await window.api.ubiquiti.login(username, password);

  if (loginResult.success) {
    showUbiquitiStatus('Connected to UniFi controller!', 'success');
    show('ubiquiti-dashboard');
    loadUbiquitiData();
  } else {
    showUbiquitiStatus(`Connection failed: ${loginResult.error || 'Wrong username or password'}`, 'error');
  }

  $('btn-ub-connect').textContent = 'Connect';
  $('btn-ub-connect').disabled = false;
});

$('btn-ub-refresh')?.addEventListener('click', loadUbiquitiData);

function showUbiquitiStatus(msg, type) {
  const el = $('ub-status');
  el.textContent = msg;
  el.className = `status-line ${type}`;
  show('ub-status');
}

async function loadUbiquitiData() {
  try {
    const [clients, networks] = await Promise.all([
      window.api.ubiquiti.getClients(),
      window.api.ubiquiti.getNetworks(),
    ]);

    $('stat-clients').querySelector('.stat-num').textContent = clients.length;
    $('stat-networks').querySelector('.stat-num').textContent = networks.length;

    const list = $('client-list');
    list.innerHTML = '';
    clients.sort((a, b) => a.name.localeCompare(b.name)).forEach(c => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `
        <div class="list-item-left">
          <div class="list-item-name">📱 ${c.name}</div>
          <div class="list-item-sub">${c.ip || ''}${c.ssid ? ` · ${c.ssid}` : ''}${c.signal ? ` · Signal: ${c.signal} dBm` : ''}</div>
        </div>`;
      list.appendChild(item);
    });
  } catch (e) {
    showUbiquitiStatus(`Error loading data: ${e.message}`, 'error');
  }
}

/* ── SETTINGS SCREEN ───────────────────────────────────── */
function loadSettings() {
  $('alec-email').value = state.alecEmail;
  window.api.getAppVersion().then(v => { $('app-version').textContent = `v${v}`; });
}

$('btn-save-email').addEventListener('click', () => {
  state.alecEmail = $('alec-email').value.trim();
  localStorage.setItem('alecEmail', state.alecEmail);
  toast('Email saved!', 'success');
});

$('btn-check-updates').addEventListener('click', async () => {
  $('btn-check-updates').textContent = 'Checking…';
  $('btn-check-updates').disabled = true;
  await window.api.checkForUpdates();
  setTimeout(() => {
    $('btn-check-updates').textContent = 'Check for Updates Now';
    $('btn-check-updates').disabled = false;
  }, 3000);
});

window.api.on('update-status', info => {
  const el = $('update-status-line');
  if (!el) return;
  el.textContent = info.message || '';
  el.className = `status-line ${info.type === 'downloaded' || info.type === 'current' ? 'success' : info.type === 'error' ? 'error' : ''}`;
  if (info.type !== 'current') show('update-status-line');
});

/* ── MODAL ─────────────────────────────────────────────── */
$('modal-close').addEventListener('click', () => hide('modal-overlay'));
$('modal-copy').addEventListener('click', () => copyToClipboard($('modal-details').textContent));
$('modal-email').addEventListener('click', emailAlec);

/* ── Init ──────────────────────────────────────────────── */
(async () => {
  // Load initial state
  const version = await window.api.getAppVersion();
  $('app-version').textContent = `v${version}`;
  refreshWifiStatus();
})();
