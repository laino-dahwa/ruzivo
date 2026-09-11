#!/usr/bin/env node
// Regenerates the app's default branding assets from a single source logo.
//
// Run this whenever public/branding/logo/logo.png changes:
//   node scripts/generate-branding-icons.mjs
//
// Produces:
//   - app/favicon.ico            (web favicon, replaces the app's default)
//   - public/branding/logo/logo.ico   (used for the Electron window icon)
//   - build/icon.ico              (baked into the installed .exe by electron-builder)
//
// Uses `sharp` (already present via Next.js's own dependency tree) purely as a
// build-time tool — nothing in the shipped app depends on it at runtime, which
// keeps the desktop build's no-native-runtime-deps policy intact (see
// lib/images/ico.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildIco } from '../lib/images/ico.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceLogo = path.join(projectRoot, 'public', 'branding', 'logo', 'logo.png');

// Mirrors lib/client/logo-renditions.ts: scale to fit within a transparent
// square, centered, rather than stretching a non-square source to fit.
async function renderSquarePng(size) {
  return sharp(sourceLogo)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function main() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngsBySize = new Map();
  for (const size of sizes) {
    pngsBySize.set(size, await renderSquarePng(size));
  }

  const icoSources = (wanted) => wanted.map((size) => ({ size, png: pngsBySize.get(size) }));

  // Windows favicons conventionally ship 16/32/48; 256 covers high-DPI tabs.
  const faviconIco = buildIco(icoSources([16, 32, 48, 256]));
  const faviconPath = path.join(projectRoot, 'app', 'favicon.ico');
  writeFileSync(faviconPath, faviconIco);
  console.log(`Wrote ${path.relative(projectRoot, faviconPath)}`);

  // Full Windows icon size set, for both the packaged .exe and the Electron
  // window icon shown in dev.
  const fullIco = buildIco(icoSources(sizes));

  const windowIconPath = path.join(projectRoot, 'public', 'branding', 'logo', 'logo.ico');
  writeFileSync(windowIconPath, fullIco);
  console.log(`Wrote ${path.relative(projectRoot, windowIconPath)}`);

  const buildIconDir = path.join(projectRoot, 'build');
  mkdirSync(buildIconDir, { recursive: true });
  const builderIconPath = path.join(buildIconDir, 'icon.ico');
  writeFileSync(builderIconPath, fullIco);
  console.log(`Wrote ${path.relative(projectRoot, builderIconPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
