const { autoUpdater } = require('electron-updater');
const { dialog, BrowserWindow } = require('electron');

function initUpdater(mainWindow) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', info => {
    mainWindow.webContents.send('update-status', {
      type: 'available',
      version: info.version,
      message: `Version ${info.version} is downloading in the background...`,
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow.webContents.send('update-status', {
      type: 'current',
      message: 'You have the latest version.',
    });
  });

  autoUpdater.on('download-progress', progress => {
    mainWindow.webContents.send('update-status', {
      type: 'progress',
      percent: Math.round(progress.percent),
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
      detail: 'Click "Restart Now" to apply the update, or it will install automatically next time you open the app.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', err => {
    mainWindow.webContents.send('update-status', {
      type: 'error',
      message: 'Update check failed — check your internet connection.',
    });
    console.error('Auto-updater error:', err);
  });

  // Check on launch, then every 4 hours
  setTimeout(() => autoUpdater.checkForUpdates(), 5000);
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
}

async function checkNow() {
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { initUpdater, checkNow };
