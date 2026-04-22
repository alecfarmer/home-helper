/* ── State ─────────────────────────────────────────────── */
const state = {
  currentScreen: 'home',
  diagRunning: false,
  currentWifi: null,
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
    acac_dns_fail: "Your internet is working but I can't reach the ACAC server (vm.acac.com). Try connecting the Home VPN on the VPN tab, then run Fix My Internet again.",
    acac_unreachable: "Your internet is working but the ACAC server (vm.acac.com) isn't responding. Make sure the Home VPN is connected, then try again.",
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
      uidBtn.className = 'btn-primary';
      uidBtn.innerHTML = '🔒 Connect Home VPN';
      uidBtn.addEventListener('click', () => {
        setScreen('vpn');
        loadVpnScreen();
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
async function loadVpnScreen() {
  await refreshHomeVpnStatus();
}

async function refreshHomeVpnStatus() {
  const metaEl   = $('vpn-home-meta');
  const toggleBtn = $('btn-vpn-toggle');
  const setupCard = $('vpn-setup-card');
  const statusLine = $('vpn-home-status');

  const s = await window.api.getHomeVpnStatus();

  if (!s.configured) {
    metaEl.textContent = 'Not set up on this Mac';
    toggleBtn.disabled = true;
    toggleBtn.textContent = 'Connect';
    toggleBtn.className = 'btn-primary';
    setupCard.classList.remove('hidden');
  } else {
    setupCard.classList.add('hidden');
    statusLine.classList.add('hidden');
    if (s.connected) {
      metaEl.textContent = '🟢 Connected';
      toggleBtn.textContent = 'Disconnect';
      toggleBtn.disabled = false;
      toggleBtn.className = 'btn-ghost';
    } else if (s.connecting) {
      metaEl.textContent = '🟡 Connecting…';
      toggleBtn.textContent = 'Connecting…';
      toggleBtn.disabled = true;
    } else {
      metaEl.textContent = '⚪ Disconnected';
      toggleBtn.textContent = 'Connect';
      toggleBtn.disabled = false;
      toggleBtn.className = 'btn-primary';
    }
  }
}

$('btn-vpn-toggle').addEventListener('click', async () => {
  const btn = $('btn-vpn-toggle');
  const statusLine = $('vpn-home-status');
  const isConnecting = btn.textContent.trim() === 'Connect';

  btn.disabled = true;
  btn.textContent = isConnecting ? 'Connecting…' : 'Disconnecting…';

  const result = isConnecting
    ? await window.api.connectHomeVpn()
    : await window.api.disconnectHomeVpn();

  statusLine.className = 'status-line';
  statusLine.classList.remove('hidden');

  if (result.success || !isConnecting) {
    statusLine.textContent = isConnecting ? 'Connected successfully.' : 'Disconnected.';
    statusLine.classList.add('success');
  } else {
    statusLine.textContent = result.error || 'Failed. Try again.';
    statusLine.classList.add('error');
  }

  await refreshHomeVpnStatus();
});

$('btn-vpn-install').addEventListener('click', async () => {
  const btn = $('btn-vpn-install');
  const statusLine = $('vpn-home-status');
  btn.disabled = true;
  btn.textContent = 'Installing… (may take a minute)';

  const result = await window.api.installHomeVpn();

  statusLine.className = 'status-line';
  statusLine.classList.remove('hidden');

  if (result.success) {
    statusLine.textContent = 'Setup complete! You can now connect.';
    statusLine.classList.add('success');
    await refreshHomeVpnStatus();
  } else {
    statusLine.textContent = result.error;
    statusLine.classList.add('error');
  }

  btn.textContent = 'Set Up Home VPN';
  btn.disabled = false;
});

/* ── OMNESSA HORIZON ───────────────────────────────────── */
$('btn-check-horizon').addEventListener('click', async () => {
  const statusEl  = $('horizon-status');
  const launchBtn = $('btn-launch-horizon');
  const checkBtn  = $('btn-check-horizon');

  statusEl.className = 'status-line';
  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Checking VPN and server connection…';
  checkBtn.disabled = true;
  launchBtn.classList.add('hidden');

  // Step 1: VPN must be connected
  const vpnState = await window.api.getHomeVpnStatus();
  if (!vpnState.connected) {
    statusEl.textContent = 'Home VPN is not connected. Connect it above, then check again.';
    statusEl.classList.add('error');
    checkBtn.disabled = false;
    return;
  }

  // Step 2: Ping vm.acac.com
  statusEl.textContent = 'VPN connected — reaching out to vm.acac.com…';
  const ping = await window.api.ping('vm.acac.com', 3);

  if (ping.success) {
    statusEl.textContent = `✓ vm.acac.com reachable (${Math.round(ping.avgMs ?? 0)}ms) — ready to connect.`;
    statusEl.classList.add('success');
    launchBtn.classList.remove('hidden');
  } else {
    statusEl.textContent = 'Cannot reach vm.acac.com. The server may be down or the VPN is not routing correctly.';
    statusEl.classList.add('error');
  }
  checkBtn.disabled = false;
});

$('btn-launch-horizon').addEventListener('click', () => {
  // Try all known names for Omnessa/VMware Horizon Client on macOS
  ['Omnissa Horizon Client', 'Horizon Client', 'VMware Horizon Client'].forEach(name => {
    window.api.launchApp(name);
  });
});

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
