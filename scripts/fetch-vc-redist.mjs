// Downloads the Microsoft Visual C++ 2015-2022 x64 redistributable so the NSIS
// installer can chain it (see build/installer.nsh).
//
// Why this is needed: the bundled PostgreSQL binaries
// (@embedded-postgres/windows-x64) are built with MSVC and import
// VCRUNTIME140.dll. That DLL ships with the VC++ redistributable, NOT with
// Windows — the api-ms-win-crt-*.dll imports beside it are the UCRT, which IS
// part of Windows 10/11 and needs nothing. On a machine without the
// redistributable, initdb.exe fails to start and first-run provisioning dies.
//
// The binary is fetched at build time rather than committed: it is ~25MB and
// Microsoft updates it in place behind a permanent link.

import { createWriteStream } from 'node:fs';
import { mkdir, stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Microsoft's permanent link for the latest supported x64 redistributable.
const DOWNLOAD_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = path.join(projectRoot, 'build');
const targetFile = path.join(targetDir, 'vc_redist.x64.exe');

// Sanity bounds — the real redistributable is ~25MB. Anything far outside this
// is a redirect/error page, not an installer.
const MIN_BYTES = 10 * 1024 * 1024;
const MAX_BYTES = 60 * 1024 * 1024;

async function alreadyDownloaded() {
  try {
    const info = await stat(targetFile);
    return info.size >= MIN_BYTES && info.size <= MAX_BYTES;
  } catch {
    return false;
  }
}

/** Rejects anything that isn't a real Windows executable served by Microsoft. */
function assertTrustedSource(response) {
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:') {
    throw new Error(`Refusing a non-HTTPS download URL: ${response.url}`);
  }
  const host = finalUrl.hostname;
  const trusted = host === 'microsoft.com' || host.endsWith('.microsoft.com');
  if (!trusted) {
    throw new Error(`Refusing a download from an unexpected host: ${host}`);
  }
}

async function assertWindowsExecutable(file) {
  const info = await stat(file);
  if (info.size < MIN_BYTES || info.size > MAX_BYTES) {
    throw new Error(`Downloaded file is ${info.size} bytes, which is outside the expected range for vc_redist.x64.exe.`);
  }

  const handle = await readFile(file, { flag: 'r' });
  // Every Windows PE executable starts with "MZ".
  if (handle[0] !== 0x4d || handle[1] !== 0x5a) {
    throw new Error('Downloaded file is not a Windows executable (missing MZ header).');
  }

  const sha256 = createHash('sha256').update(handle).digest('hex');
  return { size: info.size, sha256 };
}

async function main() {
  if (await alreadyDownloaded()) {
    const { size, sha256 } = await assertWindowsExecutable(targetFile);
    console.log(`vc_redist.x64.exe already present (${size} bytes, sha256 ${sha256}) — skipping download.`);
    return;
  }

  await mkdir(targetDir, { recursive: true });
  console.log(`Downloading the Visual C++ redistributable from ${DOWNLOAD_URL} …`);

  const response = await fetch(DOWNLOAD_URL, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status} ${response.statusText}`);
  }
  assertTrustedSource(response);

  await pipeline(Readable.fromWeb(response.body), createWriteStream(targetFile));

  const { size, sha256 } = await assertWindowsExecutable(targetFile);
  console.log(`Downloaded from ${response.url}`);
  console.log(`vc_redist.x64.exe ready (${size} bytes, sha256 ${sha256}).`);
}

main().catch((error) => {
  console.error('Could not obtain the Visual C++ redistributable:', error.message);
  process.exit(1);
});
