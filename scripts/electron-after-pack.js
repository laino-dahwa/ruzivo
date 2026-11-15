// electron-builder's extraResources copy silently drops any directory named
// `node_modules` regardless of an explicit `filter` override (verified: even
// with `filter: ['**/*']` set on the extraResources entry, .next/standalone's
// own node_modules never made it into the packaged app, while every other
// file in the same source tree did). node_modules gets special handling
// throughout electron-builder's pipeline (dependency-tree pruning for the
// app's own asar), and that appears to apply here too even though this is a
// pre-built, self-contained artifact that should just be copied verbatim.
//
// afterPack runs plain Node.js code with no such filtering, so the copy is
// done here directly instead of fighting electron-builder's config for it.
const fs = require('node:fs');
const path = require('node:path');

/**
 * The Microsoft Visual C++ runtime DLLs the bundled PostgreSQL binaries
 * import (found by reading their import tables - every one of initdb.exe,
 * postgres.exe, pg_ctl.exe and the ICU/OpenSSL DLLs needs vcruntime140.dll;
 * ICU also needs msvcp140.dll and vcruntime140_1.dll). They ship with the
 * VC++ redistributable, not with Windows, so a computer that has never had
 * that installed cannot start the built-in database.
 *
 * They are placed next to the binaries ("app-local" deployment, which
 * Microsoft allows for these files): Windows looks in a program's own folder
 * first, so the database starts on any computer, with nothing installed
 * system-wide and no administrator rights needed. This replaced chaining the
 * redistributable from the installer, which needs elevation and so failed on
 * the default "only for me" install of a clean computer.
 */
const VC_RUNTIME_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];

/** Where the build machine's own copies live (the build runs on 64-bit Windows). */
function vcRuntimeSourceDir() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return path.join(systemRoot, 'System32');
}

function isX64Dll(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt16LE(0) !== 0x5a4d) return false;
  const pe = b.readUInt32LE(0x3c);
  return b.readUInt32LE(pe) === 0x00004550 && b.readUInt16LE(pe + 4) === 0x8664;
}

function bundleVcRuntime(appOutDir) {
  const binDir = path.join(appOutDir, 'resources', 'app', 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
  if (!fs.existsSync(path.join(binDir, 'postgres.exe'))) {
    throw new Error(`[afterPack] Expected the bundled PostgreSQL binaries at ${binDir}`);
  }

  const sourceDir = vcRuntimeSourceDir();
  for (const dll of VC_RUNTIME_DLLS) {
    const src = path.join(sourceDir, dll);
    if (!fs.existsSync(src)) {
      throw new Error(`[afterPack] ${dll} is not installed on this build machine (${src}). Install the Microsoft Visual C++ 2015-2022 x64 redistributable here, then build again.`);
    }
    if (!isX64Dll(src)) {
      throw new Error(`[afterPack] ${src} is not a 64-bit DLL.`);
    }
    fs.copyFileSync(src, path.join(binDir, dll));
  }
  console.log(`[afterPack] Bundled ${VC_RUNTIME_DLLS.join(', ')} with the PostgreSQL binaries`);
}

module.exports = async function afterPack(context) {
  const projectRoot = path.join(__dirname, '..');
  const src = path.join(projectRoot, '.next', 'standalone', 'node_modules');
  const dest = path.join(context.appOutDir, 'resources', '.next', 'standalone', 'node_modules');

  if (!fs.existsSync(src)) {
    throw new Error(`[afterPack] Expected ${src} to exist — did "next build" run before packaging?`);
  }

  fs.cpSync(src, dest, { recursive: true });
  console.log(`[afterPack] Copied standalone node_modules -> ${dest}`);

  bundleVcRuntime(context.appOutDir);
};
