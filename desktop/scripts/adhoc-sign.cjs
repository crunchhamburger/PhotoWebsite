// electron-builder afterPack hook: ad-hoc signs the app.
// There's no Apple Developer ID here, so the app isn't notarized; but Apple Silicon Macs refuse to
// run code with no signature at all ("damaged"), so it gets an ad-hoc one. Friends open it once
// via System Settings > Privacy & Security > Open Anyway (see build/How to open Planner.txt).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${path.basename(app)}`);
};
