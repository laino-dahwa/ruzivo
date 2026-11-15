#!/usr/bin/env node
// Regenerates the app's default branding icons.
//
// Run this whenever public/branding/logo/logo.png or
// public/branding/desktop/icon.png changes:
//   node scripts/generate-branding-icons.mjs
//
// Produces:
//   - app/favicon.ico            (web favicon, from logo.png)
//   - public/branding/logo/logo.ico   (the Electron window icon, from the desktop icon)
//   - build/icon.ico              (baked into the installed .exe by electron-builder,
//                                  from the desktop icon)
//
// The desktop icon has its own source (public/branding/desktop/icon.png): it
// is the app's mark in the taskbar and on the .exe, while logo.png stays the
// brand shown inside the app. That source is already cropped tight around its
// wordmark, so the text fills the icon instead of a thin band across it.
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
const sourceDesktopIcon = path.join(projectRoot, 'public', 'branding', 'desktop', 'icon.png');

// Mirrors lib/client/logo-renditions.ts: scale to fit within a transparent
// square, centered, rather than stretching a non-square source to fit.
async function renderSquarePng(source, size) {
  return sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function renderSizes(source, sizes) {
  const pngsBySize = new Map();
  for (const size of sizes) {
    pngsBySize.set(size, await renderSquarePng(source, size));
  }
  return (wanted) => wanted.map((size) => ({ size, png: pngsBySize.get(size) }));
}

async function main() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const logoSources = await renderSizes(sourceLogo, sizes);
  const desktopSources = await renderSizes(sourceDesktopIcon, sizes);

  // Windows favicons conventionally ship 16/32/48; 256 covers high-DPI tabs.
  const faviconIco = buildIco(logoSources([16, 32, 48, 256]));
  const faviconPath = path.join(projectRoot, 'app', 'favicon.ico');
  writeFileSync(faviconPath, faviconIco);
  console.log(`Wrote ${path.relative(projectRoot, faviconPath)}`);

  // Full Windows icon size set, for both the packaged .exe and the Electron
  // window icon shown in dev.
  const fullIco = buildIco(desktopSources(sizes));

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
