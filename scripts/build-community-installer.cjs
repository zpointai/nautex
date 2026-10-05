// Copyright (c) 2026 Zlatin Gorov. SPDX-License-Identifier: AGPL-3.0-only
// Point this process at isolated templates while retaining electron-builder's
// normal two-pass uninstaller generation. No installed package is modified.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const version = require('app-builder-lib/package.json').version;
if (version !== '26.15.3') throw Error('Review NSIS template integration for app-builder-lib ' + version);
execFileSync(process.execPath, ['scripts/prepare-community-nsis.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
const nsis = require('app-builder-lib/out/targets/nsis/nsisUtil');
if (!nsis.nsisTemplatesDir.endsWith(path.join('templates', 'nsis'))) throw Error('Unexpected NSIS template API');
nsis.nsisTemplatesDir = path.join(root, '.desktop-build', 'nsis-templates');
const { build, Platform, Arch } = require('electron-builder');
build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never' })
  .catch(error => { console.error(error); process.exitCode = 1; });
