#!/usr/bin/env node
// Regenerates the app's favicon.
//
// Run this whenever public/favicon.png changes:
//   node scripts/generate-branding-icons.mjs
//
// public/favicon.png is the single source for every app icon. This produces
// public/favicon.ico from it, which is used as:
//   - the web favicon (served at /favicon.ico, linked from app/layout.tsx)
//   - the Electron window/taskbar icon (electron/window.ts)
//   - the icon baked into the installed .exe (electron-builder.yml `icon:`)
//
// Uses `sharp` (already present via Next.js's own dependency tree) purely as a
// build-time tool — nothing in the shipped app depends on it at runtime, which
// keeps the desktop build's no-native-runtime-deps policy intact (see
// lib/images/ico.ts).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildIco } from '../lib/images/ico.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(projectRoot, 'public', 'favicon.png');
const output = path.join(projectRoot, 'public', 'favicon.ico');

// Mirrors lib/client/logo-renditions.ts: scale to fit within a transparent
// square, centered, rather than stretching a non-square source to fit.
async function renderSquarePng(size) {
  return sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    // ICO readers (Next.js's image pipeline, Windows) expect RGBA PNG frames;
    // a JPG-derived source has no alpha channel, so add one.
    .ensureAlpha()
    .png()
    .toBuffer();
}

async function main() {
  // Full Windows icon size set: 16/32/48 for tabs and small icons, up to 256
  // for the .exe and high-DPI displays.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    images.push({ size, png: await renderSquarePng(size) });
  }
  writeFileSync(output, buildIco(images));
  console.log(`Wrote ${path.relative(projectRoot, output)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
