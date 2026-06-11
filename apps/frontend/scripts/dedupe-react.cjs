#!/usr/bin/env node
/**
 * pnpm with `node-linker=hoisted` + `inject-workspace-packages=true` produces
 * duplicate copies of `react` / `react-dom` (one in the workspace root and one
 * nested inside packages such as `next` and `styled-jsx`). Multiple React
 * copies break Next.js production prerendering (useContext returns null).
 *
 * This script removes the nested duplicates so everything resolves to the
 * single hoisted copy at the workspace root.
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const targets = [
  ["apps", "frontend", "node_modules", "react"],
  ["apps", "frontend", "node_modules", "react-dom"],
  ["apps", "frontend", "node_modules", "scheduler"],
  ["node_modules", "next", "node_modules", "react"],
  ["node_modules", "next", "node_modules", "react-dom"],
  ["node_modules", "next", "node_modules", "scheduler"],
  ["node_modules", "styled-jsx", "node_modules", "react"],
  ["node_modules", "styled-jsx", "node_modules", "react-dom"],
];

for (const segments of targets) {
  const target = path.join(repoRoot, ...segments);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    // eslint-disable-next-line no-console
    console.log(`[dedupe-react] removed ${path.relative(repoRoot, target)}`);
  }
}
