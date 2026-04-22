/* ── State ─────────────────────────────────────────────── */
const state = {
  currentScreen: 'home',
  diagRunning: false,
  currentWifi: null,
  vpnConfigs: [],     // configs stored in app
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
    if (screen === 'settings') loadSettings();
  });
});

/* ── Connection Status Badge ───────────────────────────── */
async function refreshWifiStatus() {
  try {
    // Check both Wi-Fi and Ethernet in parallel
    const [wifi, hasEthernet] = await Promise.all([
      window.api.getCurrentWifi(),
      window.api.checkEthernet(),
    ]);
    state.currentWifi = wifi;

    const badge = $('wifi-badge');
    const chip = $('home-current-wifi');

    if (wifi) {
      badge.textContent = `📶 ${wifi}`;
      badge.style.color = '#4ADE80';
      if (chip) {
        chip.textContent = `Wi-Fi: ${wifi}`;
        chip.className = 'status-chip connected';
      }
    } else if (hasEthernet) {
      badge.textContent = '🔌 Ethernet';
      badge.style.color = '#4ADE80';
      if (chip) {
        chip.textContent = 'Connected via Ethernet cable';
        chip.className = 'status-chip connected';
      }
    } else {
      badge.textContent = '📵 No Connection';
      badge.style.color = '#F87171';
      if (chip) {
        chip.textContent = 'Not connected to internet';
        chip.className = 'status-chip disconnected';
      }
    }
  } catch {
    const badge = $('wifi-badge');
    if (badge) { badge.textContent = '📵 No Connection'; badge.style.color = '#F87171'; }
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
    acac_dns_fail: "Your internet is working, but I can't find the ACAC server (vm.acac.com). The server name isn't resolving — this could be a DNS issue or the server is offline.",
    acac_unreachable: "Your internet is working, but the ACAC server (vm.acac.com) isn't responding. The server may be down or blocked.",
    unexpected_error: "Something unexpected went wrong while checking your connection.",
  };

  $('failure-message').textContent = messages[reason] || "I wasn't able to fix the problem automatically.";

  // Show UID Enterprise launch button for ACAC-specific failures
  const isAcacFailure = reason === 'acac_dns_fail' || reason === 'acac_unreachable';
  let uidBtn = $('btn-open-uid');

  if (isAcacFailure) {
    if (!uidBtn) {
      uidBtn = document.createElement('button');
      uidBtn.id = 'btn-open-uid';
      uidBtn.className = 'btn-uid-enterprise';
      uidBtn.innerHTML = '🔐 Open UID Enterprise';
      uidBtn.addEventListener('click', () => {
        window.api.launchApp('UID Enterprise');
        uidBtn.textContent = '✅ UID Enterprise opening...';
        uidBtn.disabled = true;
        setTimeout(() => {
          uidBtn.innerHTML = '🔐 Open UID Enterprise';
          uidBtn.disabled = false;
        }, 3000);
      });
      // Insert before the contact box
      const contactBox = $('contact-alec-box');
      contactBox.parentNode.insertBefore(uidBtn, contactBox);
    }
    uidBtn.style.display = 'flex';
  } else if (uidBtn) {
    uidBtn.style.display = 'none';
  }

  const report = buildContactMessage(reason, steps || diagSteps);
  $('contact-details').textContent = report;
}

async function emailAlec() {
  const email = await window.api.getAlecEmail().catch(() => 'realalecfarmer@gmail.com');
  const subject = encodeURIComponent('Internet Problem — Home Helper Report');
  const body = encodeURIComponent($('contact-details').textContent || $('modal-details').textContent || '');
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
      const isSaved = !net.hidden && savedSet.has(net.ssid);
      const item = document.createElement('div');
      item.className = 'list-item';
      const subLabel = isSaved ? 'Saved network' : (net.hidden ? 'Privacy-hidden network' : 'Nearby network');
      const displayName = net.ssid || '—';
      item.innerHTML = `
        <div class="list-item-left">
          <div class="list-item-name">${isSaved ? '⭐ ' : ''}${displayName}</div>
          <div class="list-item-sub">${subLabel}${net.signal ? ` · ${net.signal}` : ''}</div>
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

/* ── PERSISTENT STATUS BAR ─────────────────────────────── */
async function updateStatusBar() {
  const hosts = [
    { id: 'cloudflare', host: '1.1.1.1', label: 'Cloudflare' },
    { id: 'ubiquiti',   host: 'ping.ubnt.com', label: 'Ubiquiti' },
  ];

  for (const { id, host } of hosts) {
    const dotEl = $(`sb-${id}-dot`);
    const msEl  = $(`sb-${id}-ms`);
    if (!dotEl || !msEl) continue;

    try {
      const result = await window.api.ping(host, 1);
      dotEl.className = `sb-dot ${result.success ? 'up' : 'down'}`;
      msEl.textContent = result.success && result.avgMs != null ? `${Math.round(result.avgMs)}ms` : '✗';
    } catch {
      dotEl.className = 'sb-dot down';
      msEl.textContent = '✗';
    }
  }
}

updateStatusBar();
setInterval(updateStatusBar, 60000);

/* ── SETTINGS SCREEN ───────────────────────────────────── */
function loadSettings() {
  window.api.getAppVersion().then(v => { $('app-version').textContent = `v${v}`; });
}

$('btn-check-updates').addEventListener('click', async () => {
  const btn = $('btn-check-updates');
  btn.textContent = 'Checking…';
  btn.disabled = true;

  const statusEl = $('update-status-line');
  statusEl.textContent = 'Checking for updates...';
  statusEl.className = 'status-line';
  statusEl.classList.remove('hidden');

  await window.api.checkForUpdates();

  // Re-enable after 8s in case no IPC event fires
  setTimeout(() => {
    btn.textContent = 'Check for Updates Now';
    btn.disabled = false;
  }, 8000);
});

window.api.on('update-status', info => {
  const el = $('update-status-line');
  if (!el) return;

  const text = info.type === 'progress'
    ? `Downloading update... ${info.percent ?? ''}%`
    : (info.message || '');

  el.textContent = text;
  el.className = 'status-line';
  if (info.type === 'current' || info.type === 'downloaded') el.classList.add('success');
  if (info.type === 'error') el.classList.add('error');
  el.classList.remove('hidden');

  // Re-enable the check button once we get a real result
  if (['current', 'available', 'downloaded', 'error'].includes(info.type)) {
    const btn = $('btn-check-updates');
    if (btn) { btn.textContent = 'Check for Updates Now'; btn.disabled = false; }
  }
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
