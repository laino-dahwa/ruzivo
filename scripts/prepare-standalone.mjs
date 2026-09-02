#!/usr/bin/env node
// `output: 'standalone'` doesn't copy .next/static or public/ into the
// standalone bundle (a well-documented Next.js gotcha) — without this step
// the spawned server runs but serves no CSS/JS/images. Run after `next
// build`, before packaging or launching the Electron production flow.
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standaloneDir = path.join(projectRoot, '.next', 'standalone');

if (!existsSync(standaloneDir)) {
  console.error('.next/standalone not found — run `next build` first (next.config.ts must set output: "standalone").');
  process.exit(1);
}

cpSync(path.join(projectRoot, '.next', 'static'), path.join(standaloneDir, '.next', 'static'), { recursive: true });
console.log('Copied .next/static -> .next/standalone/.next/static');

const publicDir = path.join(projectRoot, 'public');
if (existsSync(publicDir)) {
  cpSync(publicDir, path.join(standaloneDir, 'public'), { recursive: true });
  console.log('Copied public/ -> .next/standalone/public');
}
