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

module.exports = async function afterPack(context) {
  const projectRoot = path.join(__dirname, '..');
  const src = path.join(projectRoot, '.next', 'standalone', 'node_modules');
  const dest = path.join(context.appOutDir, 'resources', '.next', 'standalone', 'node_modules');

  if (!fs.existsSync(src)) {
    throw new Error(`[afterPack] Expected ${src} to exist — did "next build" run before packaging?`);
  }

  fs.cpSync(src, dest, { recursive: true });
  console.log(`[afterPack] Copied standalone node_modules -> ${dest}`);
};
