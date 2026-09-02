#!/usr/bin/env node
// Copies the plain HTML/JS bootstrap-setup UI (not compiled by tsc) into
// dist-electron/ alongside the compiled main/preload/setup-preload files.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(projectRoot, 'electron', 'setup');
const destDir = path.join(projectRoot, 'dist-electron', 'setup');

mkdirSync(destDir, { recursive: true });

for (const file of ['index.html', 'renderer.js']) {
  const src = path.join(srcDir, file);
  if (!existsSync(src)) {
    console.error(`Missing expected static file: ${src}`);
    process.exitCode = 1;
    continue;
  }
  copyFileSync(src, path.join(destDir, file));
}

console.log('Copied Electron setup UI static assets.');
