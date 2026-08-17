"use strict";

const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const tests = readdirSync(join(process.cwd(), "tests"))
  .filter((name) => name.endsWith(".mjs"))
  .sort()
  .map((name) => join("tests", name));

const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
process.exit(typeof result.status === "number" ? result.status : 1);
