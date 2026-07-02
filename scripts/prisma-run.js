import { spawnSync } from "child_process";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const args = process.argv.slice(2);
const result = spawnSync(process.execPath, ["scripts/prisma-cli.js", ...args], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
