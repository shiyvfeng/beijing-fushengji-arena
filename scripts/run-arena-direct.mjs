#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const processArgs = process.argv.slice(2);
const runnerArgs = processArgs[0] === "--" ? processArgs.slice(1) : processArgs;
const buildEnvironment = { ...process.env };
for (const credentialName of [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
  "MOONSHOT_API_KEY",
  "ARENA_AGENT_A_API_KEY",
  "ARENA_AGENT_B_API_KEY",
  "ARENA_AGENT_C_API_KEY",
  "ARENA_AGENT_D_API_KEY",
  "ARENA_AGENT_E_API_KEY",
]) {
  delete buildEnvironment[credentialName];
}

const build = spawnSync("npm", ["run", "build:engine"], {
  cwd: root,
  env: buildEnvironment,
  stdio: "inherit",
});
if (build.error) throw build.error;
if (build.status !== 0) {
  process.exitCode = build.status ?? 1;
} else {
  const runner = spawnSync(
    process.execPath,
    // The separator prevents newer Node runtimes from consuming the Runner's
    // own `--env-file` option before the CLI can enforce its allowlist.
    [join(root, "dist", "arena-direct-cli.js"), "--", ...runnerArgs],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    },
  );
  if (runner.error) throw runner.error;
  process.exitCode = runner.status ?? 1;
}
