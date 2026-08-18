"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS runtime shim */

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const command = process.argv[2];
if (!new Set(["dev", "build", "start"]).has(command)) {
  console.error("Usage: node scripts/run-vinext.cjs <dev|build|start>");
  process.exit(2);
}

const cli = path.resolve(__dirname, "..", "node_modules", "vinext", "dist", "cli.js");
const result = spawnSync(process.execPath, [cli, command], {
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
