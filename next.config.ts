import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone — a minimal, self-contained server bundle
  // (only the deps actually used, no full node_modules) alongside the
  // normal .next build output. The web deployment is unaffected (`next
  // start` still works exactly as before); the Electron desktop shell
  // spawns .next/standalone/server.js directly instead of bundling the
  // full project + node_modules into the installer.
  output: "standalone",
};

export default nextConfig;
