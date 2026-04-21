/**
 * afterSign.js — runs after electron-builder's signing step.
 *
 * Does ad-hoc codesigning ("sign -") so macOS shows
 * "unidentified developer" instead of "app is damaged".
 *
 * Users only need to right-click → Open once on first launch.
 * After that the app opens normally and auto-updates work fine.
 */

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterSign(context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`\n[afterSign] Ad-hoc signing: ${appPath}`);

  try {
    // Sign all nested executables first (helpers, frameworks)
    execSync(
      `find "${appPath}" -type f -name "*.dylib" -o -type f -perm +111 | ` +
      `xargs -I{} codesign --force --sign - "{}" 2>/dev/null || true`,
      { stdio: 'inherit' }
    );

    // Then sign the outer .app bundle
    execSync(
      `codesign --force --deep --sign - "${appPath}"`,
      { stdio: 'inherit' }
    );

    console.log('[afterSign] Ad-hoc signing complete ✓\n');
  } catch (e) {
    // Non-fatal — build still succeeds, app just shows "damaged" warning
    console.warn('[afterSign] Warning: signing step failed:', e.message);
  }
};
