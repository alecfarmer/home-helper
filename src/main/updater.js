const { autoUpdater } = require('electron-updater');
const { dialog, app } = require('electron');

function initUpdater(mainWindow) {
  // Allow update checks in dev mode (uses dev-app-update.yml)
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Suppress noisy console logs from electron-updater
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send('update-status', {
      type: 'checking',
      message: 'Checking for updates...',
    });
  });

  autoUpdater.on('update-available', info => {
    mainWindow.webContents.send('update-status', {
      type: 'available',
      version: info.version,
      message: `Version ${info.version} is downloading in the background...`,
    });
  });

  autoUpdater.on('update-not-available', info => {
    mainWindow.webContents.send('update-status', {
      type: 'current',
      message: `You have the latest version (${info.version}).`,
    });
  });

  autoUpdater.on('download-progress', progress => {
    mainWindow.webContents.send('update-status', {
      type: 'progress',
      percent: Math.round(progress.percent),
      message: `Downloading update... ${Math.round(progress.percent)}%`,
    });
  });

  autoUpdater.on('update-downloaded', info => {
    mainWindow.webContents.send('update-status', {
      type: 'downloaded',
      version: info.version,
      message: `Version ${info.version} ready — will install when you quit.`,
    });

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Home Helper ${info.version} is ready to install.`,
      detail: 'Click "Restart Now" to apply the update, or it will install next time you open the app.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', err => {
    // Translate technical errors into plain messages
    let message = `Update check failed: ${err.message}`;
    if (err.message?.includes('net::') || err.message?.includes('ENOTFOUND') || err.message?.includes('ECONNREFUSED')) {
      message = 'Cannot reach update server — check your internet connection.';
    } else if (err.message?.includes('404') || err.message?.includes('not found')) {
      message = 'No update available at this time.';
    } else if (err.message?.includes('ENOENT') || err.message?.includes('No such file')) {
      message = 'Update config missing — rebuild the app.';
    }

    mainWindow.webContents.send('update-status', { type: 'error', message });
    console.error('[updater] error:', err.message);
  });

  // Check on launch after 5s, then every 4 hours
  setTimeout(() => safeCheck(), 5000);
  setInterval(() => safeCheck(), 4 * 60 * 60 * 1000);
}

function safeCheck() {
  autoUpdater.checkForUpdates().catch(err => {
    console.error('[updater] background check failed:', err.message);
  });
}

async function checkNow(mainWindow) {
  try {
    mainWindow?.webContents.send('update-status', {
      type: 'checking',
      message: 'Checking for updates...',
    });
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (e) {
    const msg = e.message || 'Unknown error';
    mainWindow?.webContents.send('update-status', {
      type: 'error',
      message: `Update check failed: ${msg}`,
    });
    return { success: false, error: msg };
  }
}

module.exports = { initUpdater, checkNow };
